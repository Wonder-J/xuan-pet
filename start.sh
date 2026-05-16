#!/usr/bin/env bash
# 玄神 - 一键启动脚本
# 自动创建 Python 虚拟环境、安装依赖、启动语音服务和 Electron

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON_DIR="$ROOT_DIR/apps/desktop/python"
VENV_DIR="$PYTHON_DIR/.venv"

# ============ 颜色 ============
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; }

# ============ 检查 Python ============
PYTHON_CMD=""
for cmd in python3 python; do
  if command -v "$cmd" &>/dev/null; then
    version=$("$cmd" --version 2>&1 | grep -oE '[0-9]+\.[0-9]+')
    major=$(echo "$version" | cut -d. -f1)
    minor=$(echo "$version" | cut -d. -f2)
    if [ "$major" -ge 3 ] && [ "$minor" -ge 9 ]; then
      PYTHON_CMD="$cmd"
      break
    fi
  fi
done

if [ -z "$PYTHON_CMD" ]; then
  error "未找到 Python 3.9+，请先安装 Python"
  exit 1
fi
info "使用 Python: $($PYTHON_CMD --version)"

# ============ 创建/检查虚拟环境 ============
if [ ! -d "$VENV_DIR" ]; then
  warn "创建虚拟环境: $VENV_DIR"
  "$PYTHON_CMD" -m venv "$VENV_DIR"
  info "虚拟环境已创建"
else
  info "虚拟环境已存在"
fi

# 激活虚拟环境
source "$VENV_DIR/bin/activate"
info "虚拟环境已激活: $(which python)"

# ============ 安装 Python 依赖 ============
if [ "$VENV_DIR/requirements.installed" -ot "$PYTHON_DIR/requirements.txt" ] 2>/dev/null || [ ! -f "$VENV_DIR/requirements.installed" ]; then
  warn "安装 Python 依赖..."
  pip install -r "$PYTHON_DIR/requirements.txt" --quiet
  touch "$VENV_DIR/requirements.installed"
  info "Python 依赖安装完成"
else
  info "Python 依赖已是最新"
fi

# ============ 检查 pnpm ============
if ! command -v pnpm &>/dev/null; then
  error "未找到 pnpm，请先安装: npm install -g pnpm"
  exit 1
fi

# ============ 安装 Node 依赖 ============
if [ ! -d "$ROOT_DIR/node_modules" ]; then
  warn "安装 Node 依赖..."
  cd "$ROOT_DIR" && pnpm install
  info "Node 依赖安装完成"
fi

# ============ 清理函数 ============
cleanup() {
  info "正在关闭..."
  [ -n "$VOICE_PID" ] && kill "$VOICE_PID" 2>/dev/null && info "语音服务已停止"
  # Kill the entire process group of electron
  [ -n "$ELECTRON_PID" ] && kill "$ELECTRON_PID" 2>/dev/null && info "Electron 已停止"
  # Ensure port is freed
  lsof -ti:17599 | xargs kill -9 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM

# ============ 清理残留进程 ============
if lsof -ti:17599 >/dev/null 2>&1; then
  warn "发现端口 17599 被占用，正在清理..."
  lsof -ti:17599 | xargs kill -9 2>/dev/null
  sleep 1
fi

# ============ 启动语音服务 ============
info "启动语音服务 (端口 17599)..."
cd "$PYTHON_DIR"
COQUI_TOS_AGREED=1 python voice_service.py --port 17599 &
VOICE_PID=$!
info "语音服务 PID: $VOICE_PID"

# 等待语音服务就绪
for i in $(seq 1 30); do
  if curl -s http://127.0.0.1:17599/health >/dev/null 2>&1; then
    info "语音服务已就绪"
    break
  fi
  if [ "$i" -eq 30 ]; then
    warn "语音服务启动较慢，继续等待中（模型首次加载可能需要时间）"
  fi
  sleep 1
done

# ============ 启动 Electron ============
info "启动 Electron 开发模式..."
cd "$ROOT_DIR"
VOICE_SERVICE_RUNNING=1 pnpm dev &
ELECTRON_PID=$!
info "Electron PID: $ELECTRON_PID"

echo ""
info "========================================="
info " 玄神已启动！"
info " 语音服务: http://127.0.0.1:17599"
info " 按 Ctrl+C 停止所有服务"
info "========================================="
echo ""

# 等待语音服务进程（它会一直运行直到被kill）
wait "$VOICE_PID"
