# 🐾 玄参 Xuan-Pet — AI 桌面宠物

<p align="center">
  <strong>一只会说话、唱歌、卖萌的 AI 桌面宠物 / An AI desktop pet that talks, sings, and acts cute</strong>
</p>

<p align="center">
  <a href="#功能特色">功能</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#语音-tts">语音</a> •
  <a href="#导出导入">导出/导入</a> •
  <a href="#打包">打包</a> •
  <a href="#features">English</a> •
  <a href="#请作者喝杯咖啡">赞赏</a>
</p>

---

## 功能特色

| 功能 | 说明 |
|------|------|
| 💬 AI 聊天 | 支持 OpenAI 兼容接口，可接入任意大模型 |
| 🗣️ 语音 TTS | Edge-TTS（在线）+ Qwen3-TTS（本地克隆音色） |
| ⏰ 定时说话 | 按间隔自动调用 AI，配合语音播报 |
| 🎵 歌单 | 导入本地音乐，宠物随歌起舞 |
| 📚 技能库 | 导入 `.md` / `.txt` 作为宠物知识 |
| 🎭 多情绪动作 | happy / idle / move / drag / sing / angry / sad / surprise / scared / sleep |
| 🚶 自由漫游 | 宠物在屏幕上自由走动 |
| 📦 导出/导入 | `.xpet` 格式一键备份和恢复全部配置 |
| 🖥️ 跨平台 | macOS (DMG) / Windows (zip) / Linux (AppImage) |

---

## 快速开始

### 环境要求

- Node.js ≥ 18
- pnpm（建议通过 `corepack enable` 启用）
- Python 3.10+（如需语音功能）

### 开发模式

```bash
# macOS / Linux
./start.sh

# Windows
start.bat

# 或手动执行
pnpm install
pnpm dev
```

`start.sh` / `start.bat` 会自动创建 Python 虚拟环境、安装语音依赖并启动开发服务。

### 首次使用

1. 右键托盘图标 → 打开设置
2. 选择 AI 提供商，填写 API Key
3. 按需修改模型名称和系统提示词
4. 保存 → 测试聊天

---

## 语音 TTS

支持两种 TTS 引擎：

| 引擎 | 特点 | 要求 |
|------|------|------|
| **Edge-TTS** | 微软在线语音，多语种多音色 | 联网 |
| **Qwen3-TTS** | 阿里本地模型，支持音色克隆 | Python + ~2GB 显存/内存 |

- 应用首次启动语音功能时会自动在 `~/.xuanshen/.venv` 创建虚拟环境并安装依赖
- 打包后的应用同样支持语音（自动管理 Python 环境）
- 定时说话开启语音后，气泡会等待语音合成完毕再弹出

---

## 导出/导入

通过菜单「导出配置」「导入配置」可将宠物全部数据打包为 `.xpet` 文件：

**包含内容：**
- 所有设置（AI配置、提示词、宠物参数）
- 技能文档
- 动作资源（图片/GIF）
- 歌单音频
- 语音配置与自定义音频

可用于备份、迁移至其他电脑、或分享给朋友。

---

## 项目结构

```
xuanshen/
├── apps/desktop/          # Electron 主应用
│   ├── src/main/          # 主进程（窗口、IPC、AI、语音）
│   ├── src/preload/       # 预加载脚本
│   ├── src/renderer/      # 渲染进程（UI）
│   └── python/            # Python 语音服务
├── packages/shared/       # 共享类型与常量
├── start.sh               # macOS/Linux 一键启动
├── start.bat              # Windows 一键启动
└── pnpm-workspace.yaml
```

---

## 打包

```bash
pnpm dist:mac    # macOS DMG
pnpm dist:win    # Windows zip
pnpm dist:all    # 全平台
```

产物输出到 `apps/desktop/release/`。

---

## 数据存储

- 使用 `electron-store` 持久化设置
- API Key 仅保存在主进程侧，不暴露到渲染进程
- 语音数据存储在 `~/.xuanshen/voice_data/`
- Python 虚拟环境位于 `~/.xuanshen/.venv/`

---

## 已知事项

- macOS 未签名，首次打开需右键选择「打开」
- Windows 为 zip 便携包，解压即用
- 透明窗口在不同平台渲染表现可能略有差异

---

## 后续规划

- 接入 Live2D 作为桌宠渲染层
- 流式对话输出
- 更多互动动作和状态机
- 技能分类、启停和优先级

---

---

# English

## Features

| Feature | Description |
|---------|-------------|
| 💬 AI Chat | OpenAI-compatible API, works with any LLM |
| 🗣️ Voice TTS | Edge-TTS (online) + Qwen3-TTS (local voice cloning) |
| ⏰ Scheduled Talk | Auto AI calls at intervals with voice playback |
| 🎵 Playlist | Import local music, pet dances along |
| 📚 Skills | Import `.md` / `.txt` as pet knowledge |
| 🎭 Emotions | 10 emotion states with custom animations |
| 🚶 Roaming | Pet roams freely on screen |
| 📦 Export/Import | `.xpet` format for full config backup |
| 🖥️ Cross-platform | macOS / Windows / Linux |

## Quick Start

```bash
# macOS / Linux
./start.sh

# Windows
start.bat
```

The scripts auto-create a Python venv at `~/.xuanshen/.venv` and install TTS dependencies.

## Development

```bash
pnpm install
pnpm dev
```

## Build & Package

```bash
pnpm dist:mac    # macOS DMG
pnpm dist:win    # Windows zip
pnpm dist:all    # All platforms
```

---

## 请作者喝杯咖啡

如果觉得玄参有趣，欢迎请作者喝杯咖啡 ☕

If you find Xuan-Pet fun, buy the author a coffee ☕

<p align="center">
  <img src="docs/images/donate.png" width="300" alt="赞赏码" />
</p>

---

## License

MIT
