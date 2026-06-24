# OpenCode 知识库模式魔改项目现有状态与记忆

本文件记录了 OpenCode 知识库模式魔改任务（根据 `doc/req.md` 和 `doc/analyze.md`）的现有状态与实现情况，以便后续的开发和运维模型能够快速理解本项目当前的进度。

---

## 1. 项目现有状态与进度

截至目前，本项目关于**知识库模式（Knowledge Base Mode）**的魔改开发工作已成功推进并完成了 **Phase 1 至 Phase 4** 的全部开发和测试。

| 阶段 | 任务目标 | 状态 | 说明 |
| :--- | :--- | :---: | :--- |
| **Phase 1** | 本地数据目录与权限守卫 | **已完成** | 目录结构创建、安全路径守卫 `kbAccessGuard` 与工具权限拦截已全量通过测试。 |
| **Phase 2** | Server API 拦截 | **已完成** | Terminal/PTY、Shell 命令、Config 变更及 MCP 注册等高危 API 接口已实现后端强制 403 拦截。 |
| **Phase 3** | Web UI 知识库化 | **已完成** | 文件树虚拟根展示、Wiki 只读状态标示、高危命令隐藏、后端 KB Meta 数据注入注入已全部实现。 |
| **Phase 4** | 多用户本地测试与隔离 | ****已完成**** | 支持多用户（如 `alice`、`bob`）切换环境，完美隔离彼此目录，共享只读 Wiki。单元测试全过。 |
| **Phase 5** | 生产化预留 | *已预留* | 属于后续规划，当前本地开发阶段暂不实现，但已为 JWT userId、多容器隔离等预留接口。 |

---

## 2. 核心架构与模块实现细节

### 2.1 目录结构与初始化
- **初始化脚本**：[scripts/init-kb-data.sh](file:///root/repo/opencode/scripts/init-kb-data.sh)
  - 职责：幂等性初始化 `data/` 数据目录，包括 `wiki/docs/example.md` 以及 `users/default`、`alice`、`bob` 的个人空间与 `state/` 状态文件夹。
- **物理路径映射**：
  - 公开 Wiki 目录：`data/wiki/`（全局只读）
  - 用户私有目录：`data/users/<currentUserId>/`（可读写，默认 `currentUserId` 为 `default`）
  - 用户运行状态：`data/state/<currentUserId>/`

### 2.2 后端安全守卫 (`kbAccessGuard`)
- **关键文件**：[packages/opencode/src/kb/guard.ts](file:///root/repo/opencode/packages/opencode/src/kb/guard.ts)
  - 核心逻辑：利用 `fs.realpathSync` 物理路径解析，对不存在的新建文件解析其最深存在的祖先，防止 `../` 路径穿越、绝对路径越权与通过软链接（Symlink）逃逸到 `data/` 目录外部。
  - 权限矩阵：
    - `privateRoot` 内：允许 `read`、`write`。
    - `wikiRoot` 内：仅允许 `read`，拒绝所有写入、修改、删除（`write`）。
    - 其它任意路径（如源码目录）：全部拒绝。

### 2.3 工具与权限层（Tool / Permission）
- **核心文件**：[packages/opencode/src/permission/index.ts](file:///root/repo/opencode/packages/opencode/src/permission/index.ts)
  - 逻辑：在 `Permission.ask` 中直接拦截 `bash`、`shell`、`terminal`、`pty`、`command`、`execute` 权限，不再弹出授权对话框，一律返回 `DeniedError`。
- **文件工具适配**：
  - `read.ts`, `write.ts`, `edit.ts`, `glob.ts`, `grep.ts`, `apply_patch.ts` 会在物理路径解析后直接调用 `Kb.assert(path, "read"|"write")`。
  - `tool/registry.ts` 在启用知识库模式时直接将 `bash` (shell) 从注册工具列表中移除，模型甚至无法感知该工具的存在。

### 2.4 Server API 接口硬拦截
- **高危路由 403 拦截**：在 [kb-mode.ts](file:///root/repo/opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/kb-mode.ts) 定义了 `kbForbidden`，对以下接口直接拒绝并返回 403：
  - Terminal/PTY：`POST /pty` (创建)、`GET /pty/shells` (系统 shell 列表)
  - Session Shell：`POST /session/:id/shell`
  - 配置修改：`PATCH /config`
  - MCP 添加：`POST /mcp` (添加 MCP server)
- **文件与搜索接口限制**：
  - `findText` / `findFile` 在 KB 模式下直接返回空（`[]`），彻底防止泄露源码项目结构和内容。
  - `list` 接口拦截非法越权路径，且在根路径请求时返回虚拟双根节点（“我的知识库”、“公开 Wiki”），隐藏底层物理目录。

### 2.5 Web UI 层适配与前端美化
- **Meta 标记注入**：在 [server/shared/ui.ts](file:///root/repo/opencode/packages/opencode/src/server/shared/ui.ts) 内，服务端会在下发的 HTML 中动态注入带有 `opencode-kb-mode`、`opencode-kb-user`、`opencode-kb-private` 和 `opencode-kb-wiki` 的 `<meta>` 标签。
- **前端感知**：[packages/app/src/context/kb.ts](file:///root/repo/opencode/packages/app/src/context/kb.ts) 解析上述 `<meta>` 标签。
  - `use-session-commands.tsx` 会对 KB 模式隐藏终端与 MCP 相关的命令面板。
  - `file-tabs.tsx` 会在编辑器顶部对 Wiki 文件显示“公开 Wiki，只读”横幅，对私有文件显示“我的知识库”。

---

## 3. 测试与验证状态

### 3.1 单元测试
测试用例已全部覆盖关键安全边界（包括路径穿越、软链接逃逸、只读保护、用户隔离和异常 User ID 处理等）。
- **测试文件**：[packages/opencode/test/kb/guard.test.ts](file:///root/repo/opencode/packages/opencode/test/kb/guard.test.ts)
- **运行命令**：
  ```bash
  # 必须在 packages/opencode 目录下执行
  bun test test/kb/guard.test.ts
  ```
- **测试结果**：11 pass, 0 fail (100% 通过)。

### 3.2 实机测试
已通过 `curl` 与实际运行验证：
1. 请求 `GET /file?path=` 返回虚拟根。
2. 请求 `PATCH /config` 和 `POST /pty` 返回 403。
3. 读写 `data/users/default/` 成功，而读取 `package.json` 被拒绝。

### 3.3 2026-06-24 Web UI 新建会话修复与部署
已修复知识库模式 Web 首页无法新建对话的问题，并部署到 `opencode-dev` 的 `4096` 端口。

- 问题根因：新布局首页在 lazy route/provider 初始化顺序下会触发 `Settings context must be used within a context provider` 或 `ServerSync context must be used within a context provider`，导致错误边界覆盖新建入口。
- 额外修复：当浏览器本地 opened-project 状态为空但后端已有当前项目时，首页会回退使用当前后端项目，因此 fresh profile 打开根路径也能显示 `New session`。
- 关键改动文件：`packages/app/src/app.tsx`、`packages/app/src/context/settings.tsx`、`packages/app/src/pages/home.tsx`、`packages/app/src/components/directory-picker.tsx`。
- 验证结果：`packages/app` 下 `bun typecheck` 通过；`packages/opencode` 下 `bun run build --single --skip-install` 通过，构建版本 `0.0.0-dev-202606241243`。
- 部署验证：`POST /session` 返回 200 且版本为 `0.0.0-dev-202606241243`；Playwright fresh context 打开根路径无错误边界，存在 `home-new-session` 按钮，点击后进入 `/new-session?draftId=...`，composer 与 `Send` 按钮正常渲染且无 browser runtime errors。

---

## 4. 后续工作（Phase 5 生产化预留建议）

如果需要将系统投入生产环境，需要考虑以下设计和开发：
1. **多用户身份鉴权**：将 `OPENCODE_KB_USER` 从临时环境变量改为从 JWT、登录 Cookie 或反向代理 Header (`x-opencode-kb-user`) 中动态解析。
2. **只读挂载**：在容器或宿主机上对 `data/wiki/` 目录进行系统级别的只读挂载，提供强物理安全保障。
3. **多实例隔离**：实现每个用户独立运行专属的 opencode server 容器，并在 `data/state/<userId>` 中隔离配置和会话历史。
4. **虚拟路径规范化**：考虑引入并彻底普及 `kb://private/...` 和 `kb://wiki/...` 虚拟协议路径，从而彻底阻断任何绝对/相对路径的前端暴露。
