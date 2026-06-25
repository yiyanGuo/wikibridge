# WikiBridge Desktop 源码构建

本版本会准备当前平台的 `frpc`、`opencode` 和 `llm-wiki-server`。

## Windows

```powershell
cd desktop
npm ci
npm run sidecars
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
npm run sidecars
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
npm run sidecars
```

启动开发版：

```bash
npm run tauri:dev
```

构建安装包：

```bash
npm run tauri:build
```
