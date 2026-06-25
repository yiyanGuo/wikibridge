# WikiBridge Desktop 源码构建

本版本只准备 `frpc` 和 `llm-wiki-server`。

## Windows

```powershell
cd desktop
npm ci
npm run sidecars:llm-wiki
```

把 `frpc.exe` 放到：

```text
desktop\src-tauri\binaries\frpc\windows-amd64\frpc.exe
```

启动开发版：

```powershell
npm run tauri:dev
```

构建安装包：

```powershell
npm run tauri:build
```

## Linux

```bash
cd desktop
npm ci
npm run sidecars:llm-wiki
```

把 `frpc` 放到对应平台目录：

```text
desktop/src-tauri/binaries/frpc/linux-amd64/frpc
desktop/src-tauri/binaries/frpc/linux-arm64/frpc
```

然后赋予可执行权限：

```bash
chmod +x src-tauri/binaries/frpc/linux-*/frpc
```

启动开发版：

```bash
npm run tauri:dev
```

构建安装包：

```bash
npm run tauri:build
```

## macOS

```bash
cd desktop
npm ci
npm run sidecars:llm-wiki
```

把 `frpc` 放到对应平台目录：

```text
desktop/src-tauri/binaries/frpc/darwin-arm64/frpc
desktop/src-tauri/binaries/frpc/darwin-amd64/frpc
```

然后赋予可执行权限：

```bash
chmod +x src-tauri/binaries/frpc/darwin-*/frpc
```

启动开发版：

```bash
npm run tauri:dev
```

构建安装包：

```bash
npm run tauri:build
```
