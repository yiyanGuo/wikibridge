# 知识库模式（Knowledge Base Mode）实现说明

本文件记录 `doc/req.md` 的实现情况：如何启用、各层如何拦截、以及验收方式。

## 1. 启用方式

```bash
# 初始化本地数据目录（幂等，可重复运行）
bash scripts/init-kb-data.sh

# 以知识库模式启动 Web 端
OPENCODE_KB_MODE=1 \
OPENCODE_KB_DATA_DIR=./data \
OPENCODE_KB_USER=default \
OPENCODE_SERVER_PASSWORD=dev \
opencode web --port 4096
```

## 2. 环境变量

| 变量 | 含义 | 默认 |
| --- | --- | --- |
| `OPENCODE_KB_MODE` | `1/true/yes/on` 启用知识库模式；其余或未设置为原始行为 | 关闭 |
| `OPENCODE_KB_DATA_DIR` | 知识库数据根目录（相对路径按**进程 CWD** 解析；生产建议用绝对路径以与实例目录解耦） | `./data` |
| `OPENCODE_KB_USER` | 当前用户 ID（含 `/`、`.`、`..` 等非法值时回退为 `default`） | `default` |

预留（尚未接入登录）：HTTP 头 `x-opencode-kb-user` 用于后续从反向代理/会话获取用户。

## 3. 目录与权限

```
data/users/<currentUserId>/   私有：read / write / edit / delete / grep / glob
data/wiki/                    公开：read / grep / glob（只读）
其它任意路径                  全部拒绝
```

## 4. 实现位置（三层拦截）

核心守卫模块：`packages/opencode/src/kb/guard.ts`（`Kb`）。
所有路径先经 `fs.realpathSync` 解析（对尚不存在的文件解析其最深存在祖先），再做包含判断，
因此可防 `../` 穿越、绝对路径越权与软链接逃逸。

### Tool / Permission 层
- 文件工具在解析出绝对路径后调用 `Kb.assert(path, "read"|"write")`：
  `read.ts`、`write.ts`、`edit.ts`、`apply_patch.ts`、`glob.ts`、`grep.ts`。
- `permission/index.ts` 的 `Permission.ask` 对 `bash/shell/terminal/pty/command/execute`
  权限直接返回 `DeniedError`。
- `tool/registry.ts` 在知识库模式下从工具列表移除 `bash`(shell) 工具，模型根本看不到它。
- KB 模式下，`glob`/`grep` 不带 `path` 时默认搜索当前用户私有目录。

### Server / API 层（绕过前端直连 API 也会被拒绝，返回 403 `ForbiddenError`）
- `POST /session/:id/shell` → `handlers/session.ts`
- `PATCH /config` → `handlers/config.ts`
- `POST /mcp`（add）→ `handlers/mcp.ts`
- PTY/终端：`POST /pty`(create)、`GET /pty/shells` → `handlers/pty.ts`
  （create 被拒后其余 pty 接口自然无目标）
- 文件读取 API `handlers/file.ts`：`list`/`content` 仅放行 KB 路径，
  `find`/`findText`（全工程搜索）在 KB 模式下直接返回空，避免泄露源码。

### Web UI 层
- 文件树根节点替换为「我的知识库」「公开 Wiki」两个虚拟根（后端 `file.ts` 的 `kbRoots`），
  不暴露真实工程根目录。
- 公开 Wiki 只读：`/file` API 不提供任何写入端点，Web 端写文件只能经模型工具，
  而工具层守卫已拒绝对 wiki 的写操作，故 wiki 在数据层即为只读。
- 服务端把知识库标志注入 SPA 的 HTML（`server/shared/ui.ts#injectKbMeta`）：
  `<meta name="opencode-kb-mode|user|private|wiki">`（对内嵌包与反代上游 HTML 均生效）。
- 前端 `packages/app/src/context/kb.ts` 读取上述 meta：
  - `use-session-commands.tsx` 在 KB 模式下隐藏 terminal / mcp 命令面板项；
  - `file-tabs.tsx` 对 wiki 文件显示「公开 Wiki，只读」横幅，对私有文件显示「我的知识库」。

> 注意：`opencode web` 默认把界面**反代自 app.opencode.ai**（仅当执行过发布构建生成
> `opencode-web-ui.gen.ts` 内嵌包时才用本地 `packages/app`）。因此上面这些**前端美化**
> 只有在使用本地构建/内嵌包时才可见；而所有**安全与文件树两根**行为由服务端强制，
> 与前端是内嵌还是反代无关，始终生效。

## 5. 验收

```bash
# 单元测试（路径穿越/软链接/越权/只读/用户隔离）
cd packages/opencode && bun test test/kb/guard.test.ts
```

手工（启动后）：
- 可读写 `data/users/default/**`；可读但不可写 `data/wiki/**`。
- 读取 `package.json`、`.env`、`../package.json`、其它用户目录 → 拒绝。
- 直连 `POST /session/:id/shell`、`PATCH /config`、`POST /mcp`、`POST /pty` → 403。

## 6. 已验证

- 单元：`test/kb/guard.test.ts`（11，穿越/软链接/越权/只读/用户隔离）+ `injectKbMeta`（2）全过；
  工具回归 read/edit/glob/grep/apply_patch/registry 共 100+ 用例通过；两个包 `tsgo` 0 错误。
- 实机（`serve` 启动 + curl）：UI HTML 注入了 kb meta；`PATCH /config`、`POST /pty`、
  `GET /pty/shells` 返回 403；`GET /file?path=`（根）返回「我的知识库 / 公开 Wiki」两节点；
  列工程子目录返回 `[]`；读 `package.json` 被拒。

## 7. 后续（生产化预留，本阶段不实现）

- 从登录会话 / 反向代理头 `x-opencode-kb-user` 取 `userId`；每用户独立 state/容器；
  wiki 改为系统层只读挂载；审计日志；管理员维护 wiki。
- 可选：用 `kb://private` / `kb://wiki` 虚拟路径彻底替换前端可见的真实相对路径。
