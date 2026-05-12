# 玄神

一个基于 Electron 构建的 AI 桌面宠物应用。它常驻桌面、支持透明点击穿透、托盘驻留、AI 对话、动作资源导入、技能注入和定时发言。

## 功能

- 透明无边框桌宠窗口，常驻桌面顶部
- 透明区域点击穿透，可与桌面正常交互
- 托盘菜单控制显示、隐藏和退出
- 支持多家 AI 服务商切换
- 支持自定义系统提示词，调整宠物性格和说话风格
- 支持导入不同情绪动作资源
- 支持本地歌单导入
- 支持技能库管理，可导入 Markdown 或文本技能文档
- 技能内容会自动注入 AI 系统提示词
- 支持定时任务，让宠物按间隔自动发言
- 定时气泡按队列显示，避免多个气泡冲突

## 当前支持的 AI 提供商

- OpenAI
- Anthropic
- MiniMax
- DeepSeek
- 智谱 AI

## 技术栈

- Electron 28
- electron-vite
- TypeScript
- Vanilla JavaScript + HTML + CSS
- electron-store
- marked
- pnpm workspace

## 项目结构

```text
.
├── apps/
│   └── desktop/
│       ├── src/
│       │   ├── main/        # Electron 主进程
│       │   ├── preload/     # 预加载桥接 API
│       │   └── renderer/    # 渲染进程界面
│       └── package.json
├── packages/
│   └── shared/
│       └── src/             # 共享类型与常量
├── package.json
└── pnpm-workspace.yaml
```

## 开发环境要求

- Node.js 18 及以上
- pnpm

建议先启用 Corepack：

```bash
corepack enable
```

## 安装依赖

```bash
pnpm install
```

## 本地开发

```bash
pnpm dev
```

开发模式会启动 Electron 应用。

## 构建

```bash
pnpm build
```

构建输出位于应用包内部的 `dist` 目录中，主要用于后续打包。

## 打包

根目录已提供统一脚本：

```bash
# 生成目录形式的包
pnpm pack

# 按 apps/desktop/package.json 中的 build 配置打包
pnpm dist

# 仅打包 macOS
pnpm dist:mac

# 仅打包 Windows
pnpm dist:win

# 同时打包 macOS 和 Windows
pnpm dist:all
```

当前打包配置：

- macOS: `dmg`
- Windows: `zip`
- Linux: `AppImage`

打包产物输出到：

```text
apps/desktop/release/
```

## Windows 说明

项目已做过基础 Windows 兼容处理，包括：

- 托盘点击行为适配
- 文件路径处理适配
- 置顶窗口层级适配

当前 Windows 默认输出为 `zip` 便携包。如果你需要安装式 `.exe`，通常要依赖 `electron-builder` 的 Windows 打包链路以及额外环境支持；在 macOS 上跨平台打包该格式时，稳定性会受 Wine 和相关依赖影响。

## 首次使用

建议按下面顺序配置：

1. 打开设置面板
2. 选择 AI 提供商
3. 填写对应 API Key
4. 按需修改模型名称和系统提示词
5. 保存设置
6. 测试聊天是否正常返回

## 主要能力说明

### 1. 聊天

在聊天面板中直接输入内容，主进程会读取当前提供商配置并发起请求。

### 2. 技能库

可以创建或导入技能文档，支持 `.md` 和 `.txt`。技能内容会被自动追加到系统提示词中，作为宠物的能力背景。

### 3. 定时说话

可以配置任务提示词和执行间隔。任务启用后会按固定间隔调用 AI，并通过气泡展示结果。若当前已有气泡，新气泡会进入队列，等待上一个气泡关闭或消失后再展示。

### 4. 动作资源

可以为不同情绪导入图片或动画资源，目前支持的情绪包括：

- happy
- idle
- move
- drag
- sing
- angry
- sad
- surprise
- scared
- sleep

### 5. 歌单

支持导入本地音频文件作为歌单资源。

## 数据存储

应用使用 `electron-store` 持久化设置，包含：

- 当前 AI 提供商
- API Key 与模型配置
- 系统提示词
- 宠物大小与透明度
- 技能列表
- 定时任务列表

API Key 保存在主进程侧，不会暴露到渲染进程代码中。

## 关键文件

- `apps/desktop/src/main/index.ts`：窗口创建、托盘、协议注册
- `apps/desktop/src/main/ipc.ts`：IPC、聊天、技能、定时任务、资源管理
- `apps/desktop/src/main/ai.ts`：AI 请求封装
- `apps/desktop/src/main/store.ts`：本地设置存储
- `apps/desktop/src/preload/index.ts`：渲染进程可调用 API
- `apps/desktop/src/renderer/`：界面与交互逻辑
- `packages/shared/src/index.ts`：共享类型、默认提供商、常量

## 已知事项

- 当前未配置应用图标，打包时会使用 Electron 默认图标
- 当前未配置 macOS 签名，生成的包可用于本地分发和测试
- Windows 默认采用 `zip` 输出而不是安装包
- 透明窗口在不同平台上的渲染表现可能略有差异

## 后续可扩展方向

- 接入 Live2D 作为桌宠渲染层
- 增加流式对话输出
- 增加更多互动动作和状态机
- 为技能增加分类、启停和优先级
- 增加自动启动、开机启动与系统通知