# WikiBridge Desktop 打包指南

本文档面向需要参与 WikiBridge Desktop 打包的项目成员。打包入口在 `desktop/`，不要在仓库根目录直接运行 Tauri 命令。

## 1. 打包内容

桌面包包含：

- Tauri 桌面壳和 React 前端。
- BearFRP 入口。
- OpenCode 入口。
- 本地 sidecar 二进制：
  - `frpc`
  - `opencode`
  - `llm-wiki-server`

桌面包不包含：

- BearFRP backend。
- `frps` 服务端。
- 用户的 API Key、LLM 配置、本地知识库数据。

## 2. 环境准备

每个平台建议在对应系统本机打包。不要默认跨平台打包，除非你已经单独配置好 Tauri/Rust 的交叉编译链路。

必需工具：

- Node.js 和 npm。
- Rust stable toolchain。
- Tauri CLI，项目内已通过 `@tauri-apps/cli` 提供。
- Bun，用于构建 OpenCode sidecar。
- 当前平台所需的 Tauri 系统依赖。

macOS 还需要 Xcode Command Line Tools。Linux/Windows 按 Tauri 官方运行环境安装系统依赖。

## 3. 安装依赖

从仓库根目录进入 desktop：

```bash
cd desktop
npm ci
```

## 4. 准备 sidecar 二进制

Tauri 配置会把这些目录打进安装包：

```text
desktop/src-tauri/binaries/
  frpc/<platform>/frpc
  opencode/<platform>/opencode
  llm-wiki-server/<platform>/llm-wiki-server
```

Windows 使用 `.exe` 后缀：

```text
frpc/windows-amd64/frpc.exe
opencode/windows-amd64/opencode.exe
llm-wiki-server/windows-amd64/llm-wiki-server.exe
```

支持的平台目录名：

- `darwin-arm64`
- `darwin-amd64`
- `linux-arm64`
- `linux-amd64`
- `windows-amd64`

### 自动准备 OpenCode 和 LLM Wiki

在 `desktop/` 下运行：

```bash
npm run sidecars
```

这个命令会：

- 构建 `llm_wiki/src-tauri` 的 `llm-wiki-server` release binary。
- 构建 OpenCode 的 single binary。
- 把两者复制到 `desktop/src-tauri/binaries/<name>/<platform>/`。

如果已经提前构建好，只想复制现有产物：

```bash
npm run sidecars -- --skip-build
```

也可以只准备其中一个：

```bash
npm run sidecars:llm-wiki
npm run sidecars:opencode
```

### 手动准备 frpc

`npm run sidecars` 不会准备 `frpc`。打包前必须手动放入当前平台的 `frpc`：

```text
desktop/src-tauri/binaries/frpc/<platform>/frpc
```

macOS/Linux 需要可执行权限：

```bash
chmod +x desktop/src-tauri/binaries/frpc/<platform>/frpc
```

如果缺少 `frpc`，应用仍可能完成打包，但 BearFRP 访问连接启动会失败。

## 5. 打包前检查

在 `desktop/` 下运行：

```bash
npm run build
```

在 `desktop/src-tauri/` 下运行：

```bash
cargo test
```

确认当前平台的 sidecar 文件存在：

```bash
find src-tauri/binaries -maxdepth 3 -type f | sort
```

至少应看到当前平台对应的：

```text
src-tauri/binaries/frpc/<platform>/frpc
src-tauri/binaries/opencode/<platform>/opencode
src-tauri/binaries/llm-wiki-server/<platform>/llm-wiki-server
```

## 6. 本地开发验证

启动桌面开发版：

```bash
npm run tauri:dev
```

如果提示 `Port 1420 is already in use`，说明已有 Vite dev server 占用端口。先停止旧进程，或确认不是另一个正在测试的桌面实例。

## 7. 正式打包

在 `desktop/` 下运行：

```bash
npm run tauri:build
```

构建产物通常在：

```text
desktop/src-tauri/target/release/bundle/
```

不同平台输出不同：

- macOS：`.app`、`.dmg`
- Windows：`.msi`、`.exe`
- Linux：`.deb`、`.rpm`、`.AppImage`

实际输出以 Tauri CLI 打印为准。

## 8. 验包清单

安装或直接运行打出的包后，至少检查：

- 应用能启动到 WikiBridge Desktop 首页。
- BearFRP 页面可以保存 backend URL。
- 本地知识库可以创建，真实目录应为 `<保存位置>/<项目名称>/`。
- 进入知识库后可以看到 `wiki/` 文档树。
- `Add 文件` 会把文件复制到 `<项目>/raw/sources/`。
- `构建` 会写入 `<项目>/.llm-wiki/ingest-queue.json`。
- 没有 LLM API Key 时，不应期待自动生成 `wiki/*.md`。
- OpenCode 入口能启动 `llm-wiki-server` 和 `opencode` sidecar。
- BearFRP 访问连接能找到并启动 `frpc`。

## 9. 常见问题

### 打包成功但 OpenCode 启动失败

检查：

```text
desktop/src-tauri/binaries/opencode/<platform>/opencode
desktop/src-tauri/binaries/llm-wiki-server/<platform>/llm-wiki-server
```

macOS/Linux 同时确认可执行权限。

### BearFRP 访问连接启动失败

检查：

```text
desktop/src-tauri/binaries/frpc/<platform>/frpc
```

`frpc` 不由 `npm run sidecars` 自动生成，需要打包人员单独准备。

### 创建项目后目录不符合预期

当前正确行为是：

```text
选择保存位置：/Users/me/Documents
项目名称：知识库
真实项目目录：/Users/me/Documents/知识库
```

如果看到结构直接创建在保存位置本身，说明运行的是旧版本应用，需要重启或重新安装新包。

### Add 后没有生成 Wiki 页面

`Add` 只复制 source 并入队。真正生成 `wiki/*.md` 需要 LLM Wiki ingest runner 和有效 LLM 配置/API Key。

### macOS 提示应用无法打开

未签名或未公证的包可能触发 Gatekeeper。内部测试包可以临时绕过，正式发布应使用团队证书签名并完成 notarization。

## 10. 发布前记录

发布前在 release note 或构建记录里写明：

- Git commit。
- 打包平台和架构。
- `desktop/package.json` 版本。
- 是否包含 `frpc`。
- `opencode` 和 `llm-wiki-server` 的构建来源。
- 是否签名/公证。
