# 知识库模式剩余工作调查报告

## 结论

当前项目尚未完全满足 `doc/req.md` 的当前阶段完成定义。

后端基础权限守卫和部分 Tool / Server 拦截已经实现，能够覆盖 private / wiki / 其他路径的核心访问判断；但 Web UI 隐藏危险入口、部分 Server API 拦截、已有或配置型本地命令能力、以及 UI 文件编辑能力仍存在缺口。

## 已完成内容

1. 本地数据目录与初始化脚本

   - 已存在 `scripts/init-kb-data.sh`。
   - 已存在 `data/wiki/README.md`、`data/wiki/docs/example.md`。
   - 已存在 `data/users/default|alice|bob/README.md`。
   - 已存在 `data/state/default|alice|bob`。

2. 知识库模式环境变量

   - `packages/opencode/src/kb/guard.ts` 已支持 `OPENCODE_KB_MODE`。
   - 已支持 `OPENCODE_KB_DATA_DIR`，默认 `./data`。
   - 已支持 `OPENCODE_KB_USER`，默认 `default`。
   - 非法用户 ID 会回退到 `default`。

3. 路径权限守卫

   - `packages/opencode/src/kb/guard.ts` 实现了 `Kb.deny(...)` 和 `Kb.assert(...)`。
   - 对目标路径、private root、wiki root 做 realpath 解析。
   - 支持不存在文件的父目录 realpath 判断。
   - 已覆盖路径穿越、系统路径访问、其他用户目录、wiki 只读、symlink escape 等基础场景。

4. Tool 层文件访问限制

   - `read` 已调用 `Kb.assert(filepath, "read")`。
   - `write`、`edit`、`apply_patch` 已调用 `Kb.assert(..., "write")`。
   - `grep`、`glob` 已调用 `Kb.assert(..., "read")`。
   - `tool/registry.ts` 在 KB 模式下隐藏内置 `shell` 工具。
   - `permission/index.ts` 在 KB 模式下拒绝 `bash`、`shell`、`terminal`、`pty`、`command`、`execute` 权限。

5. Server 层部分危险 API 拦截

   - `POST /session/:id/shell` 已通过 `kbForbidden()` 拦截。
   - `PATCH /config` 已通过 `kbForbidden()` 拦截。
   - `POST /mcp` 已通过 `kbForbidden()` 拦截。
   - `GET /pty/shells` 和 `POST /pty` 已通过 `kbForbidden()` 拦截。

6. Web UI 部分知识库化

   - 文件树顶层在 KB 模式下改为“我的知识库”和“公开 Wiki”。
   - Wiki 文件打开时显示“公开 Wiki，只读”。
   - 用户 private 文件打开时显示“我的知识库”。
   - 命令面板中 `terminal.new` 和 MCP 命令在 KB 模式下被隐藏。

## 未完成或存在风险的内容

1. Web UI 仍暴露终端入口

   - `terminal.toggle` 仍注册在命令面板中，包含 `/terminal` slash 和 `ctrl+`` keybind。
   - Session header 仍显示终端切换按钮。
   - `TerminalPanel` 在打开时会自动创建终端会话。
   - 相关位置：
     - `packages/app/src/pages/session/use-session-commands.tsx`
     - `packages/app/src/components/session/session-header.tsx`
     - `packages/app/src/pages/session/terminal-panel.tsx`

2. Web UI 仍暴露设置入口

   - 全局命令仍注册 `settings.open`。
   - Sidebar / Home 页面仍显示设置按钮。
   - 设置弹窗仍包含 servers、providers、models 等配置入口。
   - 相关位置：
     - `packages/app/src/pages/layout.tsx`
     - `packages/app/src/pages/home.tsx`
     - `packages/app/src/components/settings-v2/dialog-settings-v2.tsx`

3. PTY API 拦截不完整

   - 已拦截创建 PTY，但已有 PTY 的读取、更新、删除、连接 token、WebSocket attach 没有统一在 KB 模式下拒绝。
   - 如果 KB 模式启动前已有 PTY，或通过其他路径残留 PTY，仍可能被连接或操作。
   - 相关位置：`packages/opencode/src/server/routes/instance/httpapi/handlers/pty.ts`。

4. 配置型本地 MCP 仍可能启动本地进程

   - 动态 `POST /mcp` 已禁用，但配置中已有的 `type: "local"` MCP 仍会走 `StdioClientTransport` 启动本地命令。
   - 这不满足“任何可能间接启动本地进程的工具都需要检查”的要求。
   - 相关位置：`packages/opencode/src/mcp/index.ts`。

5. 项目级 API 未完全纳入 KB 守卫

   - `/path` 仍会返回真实 `home`、`state`、`config`、`worktree`、`directory`。
   - VCS diff / apply、worktree create / remove / reset 等接口仍可能读取或修改项目工作树。
   - 这些接口不属于知识库根目录，当前没有看到 KB 模式统一拒绝。
   - 相关位置：
     - `packages/opencode/src/server/routes/instance/httpapi/handlers/instance.ts`
     - `packages/opencode/src/server/routes/instance/httpapi/handlers/experimental.ts`

6. Web 文件搜索没有按 KB 范围正常工作

   - `findText` 和 `findFile` 在 KB 模式下直接返回空数组。
   - 这避免了泄露源码，但没有满足“其他非本地命令行工具尽量保持正常使用”和公开 wiki / private 可搜索的要求。
   - 相关位置：`packages/opencode/src/server/routes/instance/httpapi/handlers/file.ts`。

7. UI 文件编辑能力未实现

   - 文件 HTTP API 当前只声明 `find/list/content/status` 等读取类接口。
   - 没有发现 Web UI 对 private 目录提供保存、新建文件、新建目录、删除、重命名等入口。
   - 不满足 `doc/req.md` 中“用户目录可编辑”的 UI 验收要求。

8. 测试覆盖不足

   - 当前只发现 `packages/opencode/test/kb/guard.test.ts` 覆盖基础 guard。
   - 没有看到 Server API 拦截、Tool 集成、Web UI 隐藏入口、MCP local 禁用、PTY connect 禁用等测试。

## 阶段完成度判断

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| Phase 1：本地数据目录与权限守卫 | 基本完成 | 数据目录、初始化脚本、guard、文件工具基础限制已存在 |
| Phase 2：Server API 拦截 | 部分完成 | shell/config/mcp add/pty create 已拦截，但 PTY 连接、MCP local、项目级 API 仍有缺口 |
| Phase 3：Web UI 知识库化 | 部分完成 | 文件树和只读提示已做，但终端/设置入口未完整隐藏，private 文件编辑入口未实现 |
| Phase 4：多用户本地测试 | 部分完成 | `OPENCODE_KB_USER` 和 guard 测试已有，但缺少端到端/API/UI 测试 |
| Phase 5：生产化预留 | 未完成 | 需求中也标注当前阶段不实现 |

## 已验证命令

在 `packages/opencode` 下运行：

```bash
bun test test/kb/guard.test.ts
```

结果：

```text
11 pass
0 fail
```

该测试只证明 `kbAccessGuard` 基础路径判断通过，不代表 Server/API/UI 需求全部完成。

## 建议剩余工作优先级

1. 补齐 KB 模式下所有 PTY / terminal API 的 403 拦截，包括 connect token 和 WebSocket attach。
2. 禁用配置型 local MCP 的启动，或在 KB 模式下只允许 remote MCP / 完全禁用 MCP。
3. 隐藏前端所有 terminal、settings、server、config、MCP 动态入口。
4. 为 private 目录补齐 UI 文件编辑、新建、删除、重命名，并确保后端写接口走 `Kb.assert(..., "write")`。
5. 将 Web 文件搜索限制到 private/wiki，而不是直接返回空。
6. 审计并拦截 `/path`、VCS、worktree、experimental 等可能泄露或修改项目目录的 API。
7. 增加 Server API、Tool 集成和 UI 行为测试，覆盖 `doc/req.md` 的 15.1、15.2、15.3 验收标准。
