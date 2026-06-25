# OpenCode 知识库模式魔改项目分析与设计

本项目基于 Mono-repo 结构，旨在将 OpenCode 的网页端魔改为一个本地测试用的知识库系统。本文档通过梳理项目的核心架构、关键代码文件和流程流向，提供一个快速理解和上手项目开发的分析报告。

---

## 1. 项目架构概述

OpenCode 的代码库采用多包（packages）结构进行模块化管理：

*   [packages/opencode](file:///root/repo/opencode/packages/opencode)：后端核心包，包含主要 CLI 命令、API Server 路由、服务逻辑、Agent 会话核心及 AI 工具注册与执行。
*   [packages/core](file:///root/repo/opencode/packages/core)：核心公共底层，包含基础文件系统工具、Vcs 逻辑、事件总线、数据模型等。
*   [packages/app](file:///root/repo/opencode/packages/app)：Vite 驱动的 SolidJS 网页端 Single Page Application (SPA)。
*   [packages/ui](file:///root/repo/opencode/packages/ui)：供网页端使用的公共 UI 组件库。
*   [packages/web](file:///root/repo/opencode/packages/web)：Astro 驱动的前端静态着陆页及宣传网站。

---

## 2. 核心运行流程及相关代码

### 2.1 CLI 启动与 Server 服务绑定
1.  **命令行入口**：用户在终端执行 `opencode web` 启动服务端。
    *   相关代码：[packages/opencode/src/cli/cmd/web.ts](file:///root/repo/opencode/packages/opencode/src/cli/cmd/web.ts#L38-L83) 的 `handler` 执行逻辑。
2.  **监听网络**：
    *   相关代码：[packages/opencode/src/server/server.ts](file:///root/repo/opencode/packages/opencode/src/server/server.ts#L72-L97) 的 `listen` 启动底层 http 及 websocket 服务。
3.  **路由注册**：服务端 API 路由由 Effect HttpApi 构建：
    *   相关代码：[packages/opencode/src/server/routes/instance/httpapi/server.ts](file:///root/repo/opencode/packages/opencode/src/server/routes/instance/httpapi/server.ts#L132-L172) 中定义了 `rootApiRoutes`, `instanceRoutes`, `serverRoutes` 等路由层。

### 2.2 API Server 关键处理模块
*   **文件操作接口**：网页端的文件浏览、内容读取及检索路径。
    *   路由定义：[packages/opencode/src/server/routes/instance/httpapi/groups/file.ts](file:///root/repo/opencode/packages/opencode/src/server/routes/instance/httpapi/groups/file.ts)
    *   业务逻辑：[packages/opencode/src/server/routes/instance/httpapi/handlers/file.ts](file:///root/repo/opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/file.ts)，处理 `list`（文件列表）、`content`（读取文件内容）、`findFile`（查找文件）等请求。
*   **PTY/Terminal 终端控制接口**：处理 Terminal 会话及 Websocket 连接。
    *   业务逻辑：[packages/opencode/src/server/routes/instance/httpapi/handlers/pty.ts](file:///root/repo/opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/pty.ts)，包含 `create`（创建 PTY）、`shells`（系统 Shell 列表）、`connectToken`（长连凭证）等。
*   **Session 与配置控制**：
    *   [packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts](file:///root/repo/opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts#L339-L345) 处理 `shell` 命令投递接口 (`POST /session/:sessionID/shell`)。
    *   [packages/opencode/src/server/routes/instance/httpapi/handlers/config.ts](file:///root/repo/opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/config.ts#L18-L22) 处理配置修改接口 (`PATCH /config`)。
    *   [packages/opencode/src/server/routes/instance/httpapi/handlers/mcp.ts](file:///root/repo/opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/mcp.ts#L16-L21) 处理 MCP 添加接口 (`POST /mcp`)。

### 2.3 工具 (Tools) 与权限检查流向
1.  AI 模型决策需要调用工具时，在会话中解析工具并为每次调用进行权限判断。
    *   相关代码：[packages/opencode/src/session/tools.ts](file:///root/repo/opencode/packages/opencode/src/session/tools.ts#L63-L71) 中的 `ask` 闭包包装了底层权限请求。
2.  工具向底层发起 `Permission.ask` 请求：
    *   相关代码：[packages/opencode/src/permission/index.ts](file:///root/repo/opencode/packages/opencode/src/permission/index.ts#L78-L118) 的 `ask` 函数。如果配置的 ruleset 中有对应权限项 of `deny` / `allow`，则直接拒绝或通过，否则向用户弹出授权对话框。
3.  工具的独立实现（如 `read`, `write`, `edit`, `glob`, `grep`, `bash` / `command`）：
    *   相关代码：[packages/opencode/src/tool/](file:///root/repo/opencode/packages/opencode/src/tool) 文件夹中。工具参数会被约束在 Cwd / Worktree 范围内（如 [packages/opencode/src/tool/read.ts](file:///root/repo/opencode/packages/opencode/src/tool/read.ts#L250-L260) 中的 `assertExternalDirectoryEffect`）。

### 2.4 前端渲染流向
1.  **文件树构建**：网页端在侧边栏显示文件。
    *   相关代码：[packages/app/src/components/file-tree.tsx](file:///root/repo/opencode/packages/app/src/components/file-tree.tsx#L193) 的 `FileTree` 组件，依赖 [packages/app/src/context/file.tsx](file:///root/repo/opencode/packages/app/src/context/file.tsx) 和 `createFileTreeStore` 来发起网络请求加载各级节点。
2.  **标签页编辑器与查看**：
    *   相关代码：[packages/app/src/pages/session/file-tabs.tsx](file:///root/repo/opencode/packages/app/src/pages/session/file-tabs.tsx) 负责显示已打开文件的多标签。
    *   相关代码：[packages/ui/src/components/file.tsx](file:///root/repo/opencode/packages/ui/src/components/file.tsx) 作为内容组件，负责代码高亮及内容呈现。

---

## 3. 知识库模式魔改设计

为完成 [doc/req.md](file:///root/repo/opencode/doc/req.md) 中设定的各阶段目标，将在项目中引入新的安全守卫并对前后端进行对应修改。

### 3.1 权限守卫模块 `kbAccessGuard` 的实现
*   **物理路径解析**：
    *   在启用 `OPENCODE_KB_MODE=1` 时，所有文件访问路径（无论是前端读取，还是模型调用 read/write 等工具）均需通过 `kbAccessGuard`。
    *   `kbAccessGuard` 利用绝对路径与 `fs.realpathSync` 转换目标目录和请求文件路径。对尚不存在的新文件，需要先 `realpath` 解析其父目录。
    *   解析后的物理路径必须被判定属于 `privateRoot` (指向 `data/users/<currentUserId>`) 或 `wikiRoot` (指向 `data/wiki`) 之一，否则立刻抛出越权错误，防止 `../` 或软链接逃逸到外部目录。
*   **动作校验表**：
    *   如果目标物理路径在 `privateRoot` 中，允许：`read`, `write`, `edit`, `delete`, `grep`, `glob`。
    *   如果目标物理路径在 `wikiRoot` 中，只允许：`read`, `grep`, `glob`；显式拒绝所有写入或删除操作。
    *   其他物理路径全部拒绝。

### 3.2 拦截后端 API (Phase 2)
在 [packages/opencode/src/server/routes/instance/httpapi/handlers](file:///root/repo/opencode/packages/opencode/src/server/routes/instance/httpapi/handlers) 中对以下接口加入对知识库模式的拦截，返回 `403 Forbidden`：
1.  **PTY/Terminal 接口**：在 [ptyHandlers.ts](file:///root/repo/opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/pty.ts) / [tui.ts](file:///root/repo/opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/tui.ts) 内，针对任何 `create`, `shells`, `list`, `connectToken`, `connect` 等路由，在进入业务逻辑前加入 KB 模式判断，直接拒绝。
2.  **Session Shell 接口**：拦截 [sessionHandlers.ts](file:///root/repo/opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts#L339) 的 `shell` 接口。
3.  **配置修改接口**：拦截 [configHandlers.ts](file:///root/repo/opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/config.ts#L18) 的 `update` 接口。
4.  **MCP 添加接口**：拦截 [mcpHandlers.ts](file:///root/repo/opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/mcp.ts#L16) 的 `add` 接口。

### 3.3 拦截工具调用 (Phase 1)
*   **全面禁用执行**：在 [packages/opencode/src/permission/index.ts](file:///root/repo/opencode/packages/opencode/src/permission/index.ts#L78) 的 `Permission.ask` 方法前置判断。若处于知识库模式下，且请求的 `permission` 为 `bash`、`shell`、`terminal` 或 `execute` 时，一律返回 `DeniedError`，使得 AI 无法执行任何命令行操作。
*   **工具访问限制**：将 `kbAccessGuard` 的路径安全检测逻辑整合进 `Permission.ask`。当模型尝试调用文件工具（如 `read`, `edit`, `write`, `glob`, `grep`, `apply_patch`）时，检测请求路径的物理真实地址，不满足知识库范围 of 路径直接返回拒绝，且不向用户弹出授权对话框，做到后端绝对安全。

### 3.4 Web UI 适配 (Phase 3)
1.  **文件树虚拟节点化**：
    *   在知识库模式下，前端文件树不再展示真实的项目目录，而是以“我的知识库”和“公开 Wiki”作为根节点呈现。
    *   可将路径做对应的前后端虚拟化映射：
        *   虚拟路径 `kb://private/xxx.md` 映射到 `data/users/<currentUserId>/xxx.md`
        *   虚拟路径 `kb://wiki/xxx.md` 映射到 `data/wiki/xxx.md`
    *   修改 [packages/app/src/components/file-tree.tsx](file:///root/repo/opencode/packages/app/src/components/file-tree.tsx) 加载时以这两个节点为顶级树展开。
2.  **隐藏高危 UI 入口**：
    *   在前端感知到启用知识库模式后，在界面上隐藏打开终端面板的按钮和选项卡（如 `terminal-panel.tsx`、设置中的 `shortcuts`/`servers` 页、运行命令输入框等）。
3.  **Wiki 文件只读标示与交互屏蔽**：
    *   打开属于公开 Wiki 目录的文件时，在顶部或侧边显示“公开 Wiki，只读”只读标示。
    *   关闭或禁用编辑器针对该文件的保存快捷键，并隐藏重命名、删除及编辑保存等操作入口。

---

## 4. 快速上手开发指南

1.  **数据初始化**：
    *   编写并运行脚本 `scripts/init-kb-data.sh`，在 `data/` 目录下初始化 `wiki/` 以及默认用户 `users/default/`、运行状态 `state/default/` 文件夹。
2.  **环境变量配置**：
    *   在启动时声明：
        ```bash
        OPENCODE_KB_MODE=1
        OPENCODE_KB_DATA_DIR=./data
        OPENCODE_KB_USER=default
        ```
3.  **开发顺序**：
    *   **Phase 1**：创建物理路径守卫 `kbAccessGuard` 模块，魔改 `Permission.ask` 拦截模型的高危动作与越权文件访问。
    *   **Phase 2**：在 HttpApi 服务端 Handlers (PTY/Session Shell/Config/MCP) 层面实现对这些越权与高危请求的安全拒绝 (403)。
    *   **Phase 3**：调整 SolidJS 网页端 UI 的展示逻辑，构建“我的知识库 / 公开 Wiki”文件展示树、隐藏 PTY 终端面板和 MCP 选项，并实现公开 Wiki 的只读文案提示。
    *   **Phase 4**：多用户隔离验证及边界穿越绕过性安全测试。
