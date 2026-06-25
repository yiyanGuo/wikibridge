# WikiBridge Desktop 源码构建

本版本准备 `frpc`、`opencode` 和 `llm-wiki-server`。

`npm ci` 会安装项目内的 `bun` 和 `protoc` devDependency，sidecar 构建脚本会优先
使用 `desktop/node_modules/.bin/` 下的本地工具。

## Windows

```powershell
cd desktop
npm ci
npm run sidecars
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
npm run sidecars
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

Linux 本机打包默认生成 `deb` 和 `rpm`，不默认生成 AppImage。

如果 `tauri build` 在启动阶段提示 `Too many open files`，但普通文件描述符上限
足够，通常是当前用户的 inotify 实例耗尽。可以关闭占用 watcher 的应用，或由
用户自行临时提高上限：

```bash
sudo sysctl fs.inotify.max_user_instances=1024
```

## macOS

```bash
cd desktop
npm ci
npm run sidecars
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
