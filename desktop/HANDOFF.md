# WikiBridge Desktop 交接说明

## 当前架构

- B 端发布的是 `llm-wiki-server` 知识库 API，不再发布 OpenCode。
- C 端本地启动 OpenCode，并通过本地 MCP server 访问 B 端分享的 LLM Wiki API。
- 模型供应商、API Key、模型名只保存在 C 端。

## 本地开发启动

在仓库根目录执行：

```bash
cd desktop
PATH="/opt/node-v22.13.1-linux-x64/bin:$PATH" npm run tauri:dev
```

后台启动可用：

```bash
cd desktop
nohup setsid env PATH="/opt/node-v22.13.1-linux-x64/bin:$PATH" npm run tauri:dev >/tmp/wikibridge-tauri-dev.log 2>&1 </dev/null &
```

启动后前端地址是：

```text
http://127.0.0.1:1420/
```

查看日志：

```bash
tail -f /tmp/wikibridge-tauri-dev.log
```

## Sidecar 准备

开发机需要当前平台 sidecar：

```bash
cd desktop
npm run sidecars
```

如果已经有构建产物，只复制现有产物：

```bash
cd desktop
npm run sidecars -- --skip-build
```

检查 sidecar 是否齐全：

```bash
cd desktop
npm run sidecars:check
```

## 联调流程

1. B 端进入 BearFRP，创建知识库项目并构建 wiki。
2. 在“访问连接”里发布 API，得到公网 LLM Wiki API 地址。
3. C 端进入 OpenCode 页，先保存模型 API Key。
4. 在“添加远程知识库”中粘贴 B 端分享地址。
5. 点击远程知识库卡片“连接”，桌面端会启动本地 OpenCode 并注册 `llm-wiki-*` MCP。
6. 在右侧 OpenCode 对话里提问，例如：`读取知识库里的 overview.md，总结一下内容`。

## 常用验证

检查桌面前端：

```bash
curl -I http://127.0.0.1:1420/
```

检查本地 OpenCode：

```bash
curl http://127.0.0.1:4096/global/health
curl http://127.0.0.1:4096/mcp
```

检查 B 端分享 API：

```bash
curl <分享地址>/api/v1/health
curl <分享地址>/api/v1/projects
```

## 常见问题

- OpenCode 页面没有输入框：点击外层“新建对话”或重新点远程知识库“连接”。
- `/vcs` 返回 403：说明运行的是旧 OpenCode sidecar，重新执行 `npm run sidecars:opencode` 并重启桌面端。
- `cargo check` 报 `Text file busy`：有 sidecar 进程占用 `desktop/src-tauri/target/.../binaries`，先停掉对应 `frpc`、`opencode`、`llm-wiki-server` 进程。
- 知识库 API 401/403：远程 API 开了 token，C 端添加远程知识库时填写 token。

## 提交前检查

```bash
cd desktop
npm run build
cd ..
cargo check --manifest-path desktop/src-tauri/Cargo.toml
```
