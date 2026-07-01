# WikiBridge 测试分析报告

## 封面信息

| 项目 | 内容 |
| --- | --- |
| 文档编号 | WikiBridge-TAR-1.0 |
| 项目名称 | WikiBridge 零代码本地知识库 API 分享与 OpenCode/MCP 消费平台 |
| 文档类型 | 测试分析报告 |
| 参考模板 | 测试分析报告（GB8567-88） |
| 文档版本 | V1.0 |
| 编写日期 | 2026 年 6 月 26 日 |
| 编写单位 | WikiBridge 项目组（武汉大学软件工程课程设计项目组） |
| 被测版本 | 当前 `/root/SE/wikibridge` 工作区版本 |
| 测试阶段 | 组装测试、确认测试、回归测试 |

## 文档变更历史记录

| 序号 | 日期 | 版本 | 变更人员 | 变更内容 |
| --- | --- | --- | --- | --- |
| 1 | 2026-06-01 | V0.1 | 项目组 | 启动测试准备工作，明确测试对象、测试环境和课程项目验收关注点。 |
| 2 | 2026-06-18 | V0.2 | 项目组 | 根据阶段性实现整理 T-01 至 T-09 测试任务、黑盒/白盒测试范围和自动化测试入口。 |
| 3 | 2026-06-25 | V0.9 | 项目组 | 根据 MCP 架构调整同步测试重点：B 端只发布 LLM-Wiki API，C 端本地 OpenCode + MCP 消费远程知识库，并强化 KB 模式和 MCP 白名单测试。 |
| 4 | 2026-06-26 | V1.0 | 项目组 | 根据 `测试文档.pdf`、测试命令输出和 Playwright 截图说明整理测试分析报告，补充 Node 22 环境下 T-02、T-09 补跑结果，形成正式测试分析结论。 |

## 1 引言

### 1.1 编写目的

本文档用于汇总 WikiBridge 软件系统的测试执行情况、测试结果、功能结论、遗留问题、改进建议和资源消耗。本文档参考 GB8567-88《测试分析报告》模板编写，作为课程设计验收、项目组质量评价和后续回归测试的依据。

本文档重点回答两个问题：

1. `/root/SE/doc/软件测试报告/测试文档.pdf` 中规划的 T-01 至 T-09 测试任务是否已经执行并形成证据。
2. 当前版本是否满足 WikiBridge 课程设计演示和验收所需的核心质量要求。

### 1.2 背景

被测软件系统为 WikiBridge。系统当前架构基线为：B 端仅发布 LLM-Wiki API，S 端提供 BearFRP/frps 控制面与公网转发，C 端本地运行 OpenCode 并通过 llm-wiki MCP server 消费远程知识库。

测试对象包括：

- LLM-Wiki API 与 MCP server。
- OpenCode KB 模式及权限边界。
- BearFRP 用户、代理和 frps 插件。
- 自动发布 sidecar。
- Docker Compose 集成栈。
- WikiBridge Desktop 桌面端系统测试和 Tauri/Rust 合同测试。
- 端到端浏览器 UI 与截图证据。

### 1.3 定义

| 术语 | 定义 |
| --- | --- |
| T-01 至 T-09 | `测试文档.pdf` 中定义的九类测试任务。 |
| LLM-Wiki | 本地知识库编译与 API 服务，提供健康检查、项目、文件、搜索和图谱能力。 |
| OpenCode KB 模式 | OpenCode 的知识库模式，用于限制文件访问、终端、PTY、MCP 和配置变更等能力。 |
| BearFRP | 本项目中的 frp 控制面，负责用户、代理、端口/子域名和脚本生成。 |
| frpc/frps | frp 客户端和服务端。 |
| MCP | Model Context Protocol，用于将 LLM-Wiki API 注册为 OpenCode 可调用工具。 |
| real-ui | Playwright 通过真实浏览器页面断言并截图。 |
| version-gated | 受 Node 或工具链版本限制而跳过的测试路径。 |

### 1.4 参考资料

| 序号 | 文件或资料 | 路径 |
| --- | --- | --- |
| 1 | 测试任务原始文档 | `/root/SE/doc/软件测试报告/测试文档.pdf` |
| 2 | 测试命令与脚本输出整理 | `/root/SE/doc/软件测试报告/test-tasks-测试命令与输出.md` |
| 3 | Playwright 人工测试截图说明 | `/root/SE/doc/软件测试报告/playwright-人工测试截图说明.md` |
| 4 | 测试脚本说明 | `/root/SE/wikibridge/scripts/test-tasks.md` |
| 5 | 可执行测试脚本 | `/root/SE/wikibridge/scripts/test-tasks.mjs` |
| 6 | 截图采集脚本 | `/root/SE/wikibridge/scripts/capture-manual-ui-screenshots.mjs` |
| 7 | OpenCode KB 模式说明 | `/root/SE/wikibridge/opencode/doc/kb-mode.md` |
| 8 | LLM Wiki MCP server 说明 | `/root/SE/wikibridge/llm_wiki/mcp-server/README.md` |

## 2 测试概要

### 2.1 测试环境

| 项目 | 内容 |
| --- | --- |
| 测试目录 | `/root/SE/wikibridge` |
| 操作系统 | Linux 测试主机 |
| Docker | Docker version 29.4.3, build 055a478 |
| Docker Compose | Docker Compose version v5.1.3 |
| 默认 Node | v18.19.1 |
| 补跑 Node | v22.13.1，路径 `/opt/node-v22.13.1-linux-x64/bin` |
| npm | 9.2.0 / 10.9.2 |
| Python | 3.11.7 |
| Bun | 1.3.14 |
| Rust/Cargo | 已安装，Tauri/Rust 合同测试可执行 |
| 本地入口 | `http://127.0.0.1:18080` |
| BearFRP 控制面 | `http://127.0.0.1:8000` |
| BearFRP 发布入口 | `http://127.0.0.1:52600` |
| 截图目录 | `/root/SE/doc/软件测试报告/screen-shot` |

### 2.2 测试任务完成情况判断

结论：`测试文档.pdf` 中 T-01 至 T-09 的主体测试任务已经完成，并已形成命令输出或截图证据。当前版本满足课程设计演示和验收的核心闭环要求。

需要说明的是，2026-06-26 的一次全量汇总命令中，T-03 的两个黑盒断言曾失败：脚本预期 `/vcs` 和 `/vcs/diff` 在 KB 模式下返回 403，但当前 OpenCode 实现和源码测试要求这两个 VCS 读接口返回 HTTP 200 且内容为空对象或空数组，写入型 `/vcs/apply` 仍被 403 拒绝。现已将 `test-tasks.mjs` 的 T-03 黑盒断言同步为当前实现口径：`/vcs` 返回 `{}`、`/vcs/diff` 返回 `[]`、`/vcs/apply` 返回 403。同步后 T-03 白盒与黑盒检查均通过。

| 测试标识 | 测试名称 | 完成状态 | 主要证据 | 说明 |
| --- | --- | --- | --- | --- |
| T-01 | 部署与启动测试 | 完成 | `test-tasks.mjs --full --blackbox` | Compose 配置、nginx 入口、LLM-Wiki bridge health、BearFRP online API 均通过。 |
| T-02 | LLM Wiki API 测试 | 完成 | Node 22 补跑、T-02/T-07 黑盒输出 | LLM-Wiki mocked tests 1548 个用例通过；MCP 14 个用例通过；API 黑盒 health/projects/files/search/graph 通过。 |
| T-03 | OpenCode KB 权限测试 | 完成 | Bun KB guard/server 测试、T-03 截图、T-03 黑盒补跑 | 白盒 17 个用例通过；KB meta/UI 截图通过；VCS 读接口返回空结果、VCS apply 返回 403 的黑盒检查通过。 |
| T-04 | BearFRP 用户与代理测试 | 完成 | pytest 27 passed | 注册、登录、充值、代理创建、重复名称、非法输入等覆盖通过。 |
| T-05 | frps 插件鉴权测试 | 完成 | pytest 10 passed | token、子域名、Ping、CloseProxy 等插件鉴权路径通过。 |
| T-06 | 自动发布 sidecar 测试 | 完成 | `test-tasks-测试命令与输出.md` | Python 语法检查通过；`--full --docker` 下 sidecar image build 通过。 |
| T-07 | 端到端访问测试 | 完成 | 黑盒输出与 real-ui 截图 | 本地入口、BearFRP 发布入口、/llm-wiki 页面、文件、搜索、图谱均通过。 |
| T-08 | 异常与安全测试 | 完成 | pytest 37 passed、XSS 截图 | 未认证、未知路径、超大请求体、XSS dialog 监听等通过。 |
| T-09 | 桌面端知识库闭环测试 | 完成 | Node 22 Playwright、Rust 合同测试、T-09 截图 | Desktop Playwright 16 个用例通过；Rust 31 passed、1 ignored；四张桌面端截图通过。 |

### 2.3 执行命令摘要

| 测试范围 | 命令摘要 | 结果 |
| --- | --- | --- |
| 语法检查 | `node --check scripts/test-tasks.mjs` | 退出码 0。 |
| 空白检查 | `git diff --check -- scripts/test-tasks.mjs scripts/test-tasks.md` | 退出码 0。 |
| T-01/T-02/T-03/T-04/T-05/T-07/T-08/T-09 汇总 | `node scripts/test-tasks.mjs --full --blackbox --base-url http://127.0.0.1:18080 --bearfrp-url http://127.0.0.1:8000 --query WikiBridge` | 原汇总中 T-03 VCS 读接口断言口径不一致；已更新脚本并通过 T-03 定向补跑。 |
| T-02 补跑 | `PATH="/opt/node-v22.13.1-linux-x64/bin:$PATH" node scripts/test-tasks.mjs --full --task T-02` | 2 passed、0 skipped、0 failed。 |
| T-03 白盒补跑 | `node scripts/test-tasks.mjs --full --task T-03` | 1 passed、0 skipped、0 failed。 |
| T-06 Docker 构建 | `node scripts/test-tasks.mjs --full --docker --task T-06` | 2 passed、0 skipped、0 failed。 |
| T-09 补跑 | `PATH="/opt/node-v22.13.1-linux-x64/bin:$PATH" node scripts/test-tasks.mjs --full --task T-09` | 2 passed、0 skipped、0 failed。 |
| 截图采集 | `PATH="/opt/node-v22.13.1-linux-x64/bin:$PATH" node scripts/capture-manual-ui-screenshots.mjs` | T-03、T-07、T-08、T-09 共 12 张 real-ui 截图通过。 |

## 3 测试结果及发现

### 3.1 T-01 部署与启动测试

| 检查项 | 输入或命令 | 实际结果 | 判定 |
| --- | --- | --- | --- |
| Docker Compose 配置 | `docker compose config --quiet` | 配置解析通过。 | 通过 |
| nginx OpenCode entry | `GET http://127.0.0.1:18080/global/health` | HTTP 200，健康响应正常。 | 通过 |
| LLM-Wiki bridge health | `GET http://127.0.0.1:18080/instance/llm-wiki/health` | HTTP 200。 | 通过 |
| BearFRP online API | `GET http://127.0.0.1:8000/api/show/online` | HTTP 200，返回对象。 | 通过 |

发现：系统能够按 Compose 方式启动并形成 nginx 单入口。当前 `docker compose ps` 中 OpenCode 容器曾显示 `unhealthy`，但通过 nginx 的 `/global/health` 和真实页面访问均通过，说明容器级 healthcheck 与实际入口健康状态存在口径差异，建议后续修正 healthcheck 规则。

### 3.2 T-02 LLM Wiki API 测试

| 检查项 | 输入或命令 | 实际结果 | 判定 |
| --- | --- | --- | --- |
| mocked tests | `npm run test:mocks` | Node 22 环境下 105 个测试文件、1548 个测试用例通过。 | 通过 |
| MCP tests | `npm run mcp:test` | 14 个 MCP 测试全部通过。 | 通过 |
| health | `GET /api/v1/health` | HTTP 200。 | 通过 |
| projects | `GET /api/v1/projects` | HTTP 200，返回项目数组。 | 通过 |
| project files | `GET /projects/:id/files` | HTTP 200，返回文件数据。 | 通过 |
| search | `POST /projects/:id/search` | HTTP 200，返回搜索结果。 | 通过 |
| graph | `GET /projects/:id/graph` | HTTP 200，返回图谱数据。 | 通过 |

过程记录：最初在默认 Node 18.19.1 环境中，`llm_wiki mocked tests` 被脚本按 Node 版本门控跳过；切换到 Node 22.13.1 后首次执行因 npm optional dependency 缺少 `@rolldown/binding-linux-x64-gnu` 失败，执行 `npm install --include=optional` 后补跑通过。该问题属于本地依赖安装不完整，不是业务断言失败。

发现：LLM-Wiki API 和 MCP server 的主要接口、错误处理、Token 传递、搜索和图谱解析能力满足测试文档要求。

### 3.3 T-03 OpenCode KB 权限测试

| 检查项 | 输入或命令 | 实际结果 | 判定 |
| --- | --- | --- | --- |
| KB guard tests | `bun test test/kb/guard.test.ts test/kb/server.test.ts` | 17 pass，0 fail。 | 通过 |
| 私有目录读写 | 单元测试覆盖 | 私有目录可读写。 | 通过 |
| 公开 Wiki 只读 | 单元测试覆盖 | 公开 Wiki 可读，不可写。 | 通过 |
| 路径穿越 | 单元测试覆盖 | `../` 和项目外路径被拒绝。 | 通过 |
| 软链接逃逸 | 单元测试覆盖 | realpath 后拒绝。 | 通过 |
| Shell/PTY/MCP/Config | server tests 覆盖 | 禁用或返回拒绝。 | 通过 |
| KB meta/UI 截图 | `T-03-kb-mode-meta-and-ui.png` | 页面暴露 KB mode meta 并显示 KB UI。 | 通过 |
| VCS 读接口黑盒断言 | `/vcs`、`/vcs/diff` | 当前实现返回 HTTP 200 空对象/空数组，脚本已按该口径断言。 | 通过 |
| VCS 写接口黑盒断言 | `/vcs/apply` | KB 模式下返回 HTTP 403。 | 通过 |

发现：KB 模式的核心安全边界已经通过白盒测试、黑盒测试和真实 UI 证据。VCS 读接口的当前实现是“保留读接口但返回空结果”，源码测试 `httpapi-instance.test.ts` 对此有明确断言；测试脚本已同步为该口径，并额外检查 `/vcs/apply` 必须返回 403，以覆盖写入型 VCS 能力禁用要求。

### 3.4 T-04 BearFRP 用户与代理测试

| 检查项 | 输入或命令 | 实际结果 | 判定 |
| --- | --- | --- | --- |
| BearFRP API coverage | `python -m pytest -q tests/test_api.py` | 27 passed。 | 通过 |

发现：用户注册、登录、充值、代理创建、脚本生成、重复名称、非法输入和删除等控制面核心路径已通过当前 pytest 覆盖。旧版 `测试文档.pdf` 中提到的余额边界和删除列表一致性问题，在当前 pytest 结果中未再表现为失败。

### 3.5 T-05 frps 插件鉴权测试

| 检查项 | 输入或命令 | 实际结果 | 判定 |
| --- | --- | --- | --- |
| plugin and poller tests | `python -m pytest -q tests/test_plugin_and_poller.py` | 10 passed。 | 通过 |

发现：frps 插件能够正确处理 token、代理名、子域名、Ping 和 CloseProxy 等关键鉴权与状态同步场景。

### 3.6 T-06 自动发布 sidecar 测试

| 检查项 | 输入或命令 | 实际结果 | 判定 |
| --- | --- | --- | --- |
| sidecar Python syntax | `node scripts/test-tasks.mjs --task T-06` | Python AST 解析通过。 | 通过 |
| sidecar image build | `node scripts/test-tasks.mjs --full --docker --task T-06` | sidecar 镜像构建通过。 | 通过 |

发现：sidecar 能支持课程演示中的自动发布路径。默认轻量模式会跳过 Docker build，这是脚本配置行为；`--full --docker` 模式已实际构建成功。

### 3.7 T-07 端到端访问测试

| 检查项 | 输入或命令 | 实际结果 | 判定 |
| --- | --- | --- | --- |
| OpenCode page advertises KB mode | `GET http://127.0.0.1:18080/` | HTTP 200，包含 `opencode-kb-mode`。 | 通过 |
| bridge project list | `GET /instance/llm-wiki/projects` | HTTP 200，返回项目数组。 | 通过 |
| bridge project files | `GET /instance/llm-wiki/projects/:id/files` | HTTP 200，返回文件数据。 | 通过 |
| 本地入口截图 | `T-07-local-entry-opencode-kb-home.png` | real-ui 通过。 | 通过 |
| LLM-Wiki 知识库页面 | `T-07-llm-wiki-knowledge-base-page.png` | real-ui 通过。 | 通过 |
| 图谱视图 | `T-07-llm-wiki-graph-view.png` | real-ui 通过。 | 通过 |
| 文件内容 | `T-07-llm-wiki-file-content.png` | real-ui 通过。 | 通过 |
| 搜索结果 | `T-07-llm-wiki-search-results.png` | real-ui 通过。 | 通过 |
| BearFRP 发布入口 | `T-07-bearfrp-published-entry.png` | real-ui 通过。 | 通过 |

发现：本地入口、LLM-Wiki 页面、搜索、图谱和 BearFRP 发布入口均能形成可演示的端到端访问闭环。

### 3.8 T-08 异常与安全测试

| 检查项 | 输入或命令 | 实际结果 | 判定 |
| --- | --- | --- | --- |
| BearFRP security/error coverage | `python -m pytest -q tests/test_api.py tests/test_plugin_and_poller.py` | 37 passed。 | 通过 |
| unknown BearFRP path | `GET /__not_found__` | HTTP 404。 | 通过 |
| user endpoint requires auth | `GET /api/user/me` | HTTP 401。 | 通过 |
| LLM Wiki oversized body | 超大 search body | HTTP 503，符合脚本允许状态。 | 通过 |
| XSS dialog 监听 | `T-08-xss-no-alert-llm-wiki-content.png` | 未捕获浏览器弹窗。 | 通过 |

发现：错误 token、未认证访问、未知路径、超大请求体和基础 XSS 样例均按安全边界处理。公开部署前仍需替换默认密码、frps token、LLM_WIKI_TOKEN，并配置 HTTPS。

### 3.9 T-09 桌面端知识库闭环测试

| 检查项 | 输入或命令 | 实际结果 | 判定 |
| --- | --- | --- | --- |
| Desktop Playwright system tests | `npm run test:system` | Node 22 环境下 16 passed。 | 通过 |
| Desktop Rust contract tests | `npm run test:contracts` | 31 passed、1 ignored。 | 通过 |
| 项目仪表盘截图 | `T-09-desktop-project-dashboard.png` | real-ui 通过。 | 通过 |
| 编译准备状态截图 | `T-09-desktop-compile-ready.png` | real-ui 通过。 | 通过 |
| 访问连接状态截图 | `T-09-desktop-link-report-ready.png` | real-ui 通过。 | 通过 |
| 消费端远程知识库截图 | `T-09-desktop-local-wiki-reader.png` | real-ui 通过。 | 通过 |

过程记录：T-09 最初在 Node 18.19.1 环境中被 Playwright/Vite 版本门控跳过；切换至 Node 22.13.1 后，Desktop Playwright 系统测试和 Rust 合同测试均通过，截图脚本也补齐四张桌面端 real-ui 证据。

发现：桌面端已覆盖本地知识项目、远程知识库添加、发布连接和消费端入口等课程演示所需路径。

## 4 对软件功能的结论

### 4.1 功能 F-01：部署与统一入口

结论：通过。系统能够通过 Docker Compose 形成可访问的 nginx 单入口，并转发 OpenCode KB 页面和 LLM-Wiki bridge API。

限制：OpenCode 容器级 healthcheck 与真实入口健康状态存在口径差异，建议后续修正容器健康检查。

### 4.2 功能 F-02：LLM-Wiki 知识库服务

结论：通过。LLM-Wiki 的健康检查、项目、文件、搜索、图谱、mocked tests 和 MCP server 测试均通过。

限制：real-LLM 能力依赖外部模型服务和 API Key，本轮主要验证 mock、API、MCP 和黑盒项目级能力。

### 4.3 功能 F-03：OpenCode KB 权限隔离

结论：通过。KB Guard、server 权限、路径隔离、Shell/PTY/MCP/Config 禁用、VCS 读接口脱敏、VCS 写接口拒绝和 KB meta/UI 证据均通过。

限制：VCS 读接口采用“返回空结果”而非“直接 403”的安全口径，后续需求和测试文档需继续保持一致。

### 4.4 功能 F-04：BearFRP 发布控制面

结论：通过。BearFRP 用户、代理、frps 插件和安全错误路径 pytest 均通过，BearFRP 发布入口截图通过。

限制：对外部署仍依赖公网端口、防火墙、HTTP vhost、DNS 或 TCP 端口配置。

### 4.5 功能 F-05：自动发布 sidecar

结论：通过。sidecar 语法检查和 Docker 镜像构建通过，能够支撑课程演示的一键发布链路。

限制：首次运行可能依赖 frpc 下载或镜像缓存，离线环境需提前准备二进制或缓存。

### 4.6 功能 F-06：桌面端知识库闭环

结论：通过。Desktop Playwright 系统测试、Rust 合同测试和四张 real-ui 截图均通过。

限制：测试截图覆盖的是系统测试模式下的桌面前端入口；真实 Tauri 打包后的跨平台表现仍需后续按提交平台补测。

## 5 分析摘要

### 5.1 能力摘要

本轮测试证明 WikiBridge 当前版本具备以下能力：

1. 能以 Docker Compose 方式启动主要服务，并通过 nginx 单入口访问。
2. 能通过 LLM-Wiki API 提供项目、文件、搜索和图谱能力。
3. 能通过 llm-wiki MCP server 将远程知识库能力接入 OpenCode。
4. 能通过 OpenCode KB 模式限制危险文件访问、终端、PTY、MCP 和配置变更。
5. 能通过 BearFRP 控制面和 frps 插件创建、鉴权和管理发布代理。
6. 能通过 sidecar 自动发布演示入口。
7. 能通过浏览器真实 UI 展示知识库页面、图谱、文件内容、搜索结果和 XSS 不执行证据。
8. 能通过 Desktop 完成本地知识项目、发布连接和远程知识库消费端入口展示。

### 5.2 缺陷和限制

| 编号 | 缺陷或限制 | 严重性 | 影响 | 状态 |
| --- | --- | --- | --- | --- |
| L-01 | T-03 汇总黑盒脚本曾要求 VCS 读接口返回 403，但当前实现返回 200 空结果。 | 低 | 曾造成全量汇总脚本 2 个失败断言。 | 已更新测试脚本，定向补跑通过 |
| L-02 | 默认 Node 18.19.1 低于 Desktop Playwright/Vite 要求。 | 中 | 不切换 Node 时 T-09 系统测试和截图会被跳过。 | 已通过 Node 22 补跑 |
| L-03 | `llm_wiki/node_modules` 曾缺少 npm optional native binding。 | 中 | Node 22 下首次执行 mocked tests 失败。 | 已通过 `npm install --include=optional` 修复并补跑 |
| L-04 | OpenCode 容器级 healthcheck 曾显示 `unhealthy`，但入口健康检查通过。 | 低 | 可能影响部署状态判断。 | 待修正 healthcheck 口径 |
| L-05 | 对外部署前默认密码、frps token、LLM_WIKI_TOKEN 和 HTTPS 仍需按生产环境设置。 | 高 | 公开暴露时存在安全风险。 | 部署前必须处理 |
| L-06 | real-LLM、HTTP 子域名和公网访问依赖外部模型服务、DNS、防火墙和端口配置。 | 中 | 可能影响非本地演示环境稳定性。 | 按环境配置 |

### 5.3 建议

| 编号 | 建议 | 紧迫程度 | 预计工作量 |
| --- | --- | --- | --- |
| S-01 | 保持 `scripts/test-tasks.mjs` 中 T-03 VCS 黑盒断言与当前实现一致：`/vcs` 预期 `{}`、`/vcs/diff` 预期 `[]`、`/vcs/apply` 预期 403。 | 中 | 0.5 人日 |
| S-02 | 在提交或答辩环境统一使用 Node 22.13.1 或 Node 20.19+，避免 Desktop 测试被版本门控跳过。 | 高 | 0.5 人日 |
| S-03 | 将 `npm install --include=optional` 或等价依赖安装步骤写入测试准备说明。 | 中 | 0.5 人日 |
| S-04 | 修正 OpenCode 容器 healthcheck，使 Compose 状态与 `/global/health` 一致。 | 中 | 1 人日 |
| S-05 | 公开部署前强制修改 OpenCode 密码、BearFRP 管理员密码、frps token 和 LLM_WIKI_TOKEN，并配置 HTTPS。 | 高 | 0.5 人日 |
| S-06 | 保留 T-03/T-07/T-08/T-09 real-ui 截图作为最终验收证据，并在答辩前重新生成一轮。 | 中 | 0.5 人日 |

### 5.4 评价

从测试计划覆盖范围和当前执行结果看，WikiBridge 已完成 `测试文档.pdf` 中 T-01 至 T-09 的主体测试任务。系统可以用于课程设计演示和验收。

当前没有发现影响主链路的阻塞级缺陷。主链路包括：B 端构建并通过 LLM-Wiki API 暴露知识库，S 端通过 BearFRP/frps 发布入口，C 端本地 OpenCode + MCP 消费远程知识库。需要在最终提交前处理或说明的事项主要是 Node 版本要求、公开部署安全配置和容器 healthcheck 口径。

## 6 测试资源消耗

| 资源类型 | 数量或时间 | 说明 |
| --- | --- | --- |
| 测试人员 | 1-2 人 | 执行脚本、补跑环境、整理截图和报告。 |
| 开发协助 | 1 人 | 解释当前 OpenCode VCS 读接口和 KB 模式实现口径。 |
| 测试主机 | 1 台 | Linux + Docker Compose 环境。 |
| 浏览器 | Chromium / Playwright | 用于 real-ui 截图和 Desktop 系统测试。 |
| 命令行测试时间 | 约 1 小时 | 包括 T-02、T-03、T-09 补跑和全量汇总。 |
| 截图采集时间 | 约 10 分钟 | 生成 T-03、T-07、T-08、T-09 共 12 张截图。 |
| 报告整理时间 | 约 1.5 小时 | 对照 `测试文档.pdf`、命令输出和截图说明编写。 |

## 附录 A 截图证据清单

| 测试项 | 截图文件 | 结果 |
| --- | --- | --- |
| T-03 | `screen-shot/T-03-kb-mode-meta-and-ui.png` | PASS |
| T-07 | `screen-shot/T-07-local-entry-opencode-kb-home.png` | PASS |
| T-07 | `screen-shot/T-07-llm-wiki-knowledge-base-page.png` | PASS |
| T-07 | `screen-shot/T-07-llm-wiki-graph-view.png` | PASS |
| T-07 | `screen-shot/T-07-llm-wiki-file-content.png` | PASS |
| T-07 | `screen-shot/T-07-llm-wiki-search-results.png` | PASS |
| T-07 | `screen-shot/T-07-bearfrp-published-entry.png` | PASS |
| T-08 | `screen-shot/T-08-xss-no-alert-llm-wiki-content.png` | PASS |
| T-09 | `screen-shot/T-09-desktop-project-dashboard.png` | PASS |
| T-09 | `screen-shot/T-09-desktop-compile-ready.png` | PASS |
| T-09 | `screen-shot/T-09-desktop-link-report-ready.png` | PASS |
| T-09 | `screen-shot/T-09-desktop-local-wiki-reader.png` | PASS |

## 附录 B 重点回归用例清单

| 编号 | 回归用例 | 预期结果 |
| --- | --- | --- |
| REG-01 | Compose 配置解析和 nginx 健康检查 | 配置有效，入口 HTTP 200。 |
| REG-02 | LLM-Wiki health/projects/files/search/graph | 均返回 HTTP 200 和预期 JSON 结构。 |
| REG-03 | LLM-Wiki mocked tests | Node 20.19+ 或 Node 22 下全部通过。 |
| REG-04 | LLM-Wiki MCP tests | 14 个 MCP 测试全部通过。 |
| REG-05 | KB 模式路径穿越、软链接、其它用户目录 | 均被拒绝。 |
| REG-06 | KB 模式 Shell/PTY/MCP/Config | 禁用或返回拒绝。 |
| REG-07 | KB 模式 VCS 读接口 | `/vcs` 返回 200 `{}`，`/vcs/diff` 返回 200 `[]`。 |
| REG-08 | KB 模式 VCS apply | 返回 403。 |
| REG-09 | BearFRP 用户和代理 pytest | 27 passed。 |
| REG-10 | frps 插件 pytest | 10 passed。 |
| REG-11 | sidecar 语法和镜像构建 | 均通过。 |
| REG-12 | 本地入口和 BearFRP 发布入口 | 均可访问并展示 KB shell。 |
| REG-13 | /llm-wiki 文件、搜索、图谱 UI | real-ui 断言通过并生成截图。 |
| REG-14 | XSS fixture | 页面显示脚本文本但不触发浏览器弹窗。 |
| REG-15 | Desktop Playwright system tests | 16 passed。 |
| REG-16 | Desktop Rust contract tests | 31 passed、1 ignored。 |
