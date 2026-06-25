# opencode 知识库模式魔改任务文档

## 1. 目标

将 opencode 的网页端魔改为一个本地测试用的知识库系统。

系统需要支持：

1. 每个用户拥有自己的专属知识库目录，可读写。
2. 所有用户共享一个公开 Wiki 目录，只能读取，不能修改。
3. 禁止使用 bash、shell、本地命令行、终端相关能力。
4. 其他非本地命令行工具尽量保持正常使用，例如 read、edit、grep、glob、webfetch、websearch 等。
5. 当前阶段先在 opencode 项目目录内开发和测试，使用项目根目录下的 `data` 目录存放用户目录和公开 Wiki。

---

## 2. 本地测试目录结构

在 opencode 项目根目录创建：

```text
data/
  wiki/
    README.md
    docs/
      example.md

  users/
    default/
      README.md

    alice/
      README.md

    bob/
      README.md

  state/
    default/
    alice/
    bob/
```

目录含义：

```text
data/wiki/
  公开 Wiki 目录。
  所有用户可读。
  所有用户不可写。

data/users/<userId>/
  用户专属目录。
  当前用户可读写。
  其他用户不可访问。

data/state/<userId>/
  用户运行状态目录。
  用于后续隔离会话、缓存、配置、历史记录等。
```

当前测试阶段默认用户可以先使用：

```text
default
```

即：

```text
data/users/default/
data/state/default/
```

---

## 3. 知识库访问规则

### 3.1 当前用户私有目录

当前用户只能访问自己的私有目录。

例如当前用户为：

```text
alice
```

则允许访问：

```text
data/users/alice/**
```

允许操作：

```text
read
write
edit
delete
grep
glob
```

禁止访问：

```text
data/users/bob/**
data/users/default/**
data/users/**
```

除当前用户目录外，其他用户目录全部拒绝。

---

### 3.2 公共 Wiki 目录

公共 Wiki 目录为：

```text
data/wiki/**
```

允许操作：

```text
read
grep
glob
```

禁止操作：

```text
write
edit
delete
rename
move
patch
```

公共 Wiki 是全局只读知识库，任何用户都不能通过 opencode Web UI 或工具调用修改。

---

### 3.3 其他项目目录

默认禁止 AI 和 Web UI 访问 opencode 项目源码目录中的其他文件。

也就是说，知识库模式下，模型不应该读取或修改：

```text
packages/**
src/**
node_modules/**
bun.lock
package.json
opencode.json
.env
.git/**
```

允许访问的根目录仅限：

```text
data/users/<currentUserId>/**
data/wiki/**
```

---

## 4. 禁止能力

必须禁用以下能力：

```text
bash
shell
terminal
local command
本地命令执行
TUI attach
session shell API
```

需要同时从三层处理：

1. UI 层隐藏入口。
2. Server/API 层拒绝请求。
3. Tool/Permission 层禁止模型调用。

---

## 5. 权限模型

新增一个知识库模式权限判断模块。

建议新增模块名：

```text
kbAccessGuard
```

职责：

1. 获取当前用户 ID。
2. 解析用户请求路径。
3. 将相对路径转换为绝对路径。
4. 防止 `../` 路径穿越。
5. 防止 symlink 逃逸。
6. 判断路径是否属于当前用户私有目录。
7. 判断路径是否属于公共 Wiki 目录。
8. 根据操作类型判断是否允许访问。

---

## 6. 路径判断规则

所有文件路径必须先经过 `realpath` 或等价逻辑解析。

禁止直接用字符串 `startsWith` 判断未经解析的路径。

必须防止以下绕过：

```text
../
../../
软链接指向 data 外部
绝对路径访问项目根目录
绝对路径访问系统目录
通过 data/users/alice/link -> /etc 的软链接逃逸
```

路径判断逻辑：

```text
privateRoot = realpath(projectRoot/data/users/<currentUserId>)
wikiRoot    = realpath(projectRoot/data/wiki)
targetPath  = realpath(requestedPath)

如果 targetPath 在 privateRoot 内：
  read/write/edit/delete 允许

如果 targetPath 在 wikiRoot 内：
  read/grep/glob 允许
  write/edit/delete 拒绝

其他路径：
  全部拒绝
```

注意：

```text
如果目标文件尚不存在，不能直接 realpath 目标文件。
需要 realpath 它的父目录，然后再判断新文件路径是否位于允许目录内。
```

---

## 7. 用户 ID 获取方式

当前本地测试阶段可以先使用环境变量：

```bash
OPENCODE_KB_USER=default
```

默认值：

```text
default
```

后续接入登录系统后，再改为从 session、cookie、JWT 或反向代理 header 获取。

建议预留：

```text
x-opencode-kb-user
```

例如：

```http
x-opencode-kb-user: alice
```

但本地测试阶段先不要依赖真实登录。

---

## 8. 环境变量设计

新增环境变量：

```bash
OPENCODE_KB_MODE=1
OPENCODE_KB_DATA_DIR=./data
OPENCODE_KB_USER=default
```

含义：

```text
OPENCODE_KB_MODE
  是否启用知识库模式。
  1 表示启用。
  未设置或 0 表示使用原始 opencode 行为。

OPENCODE_KB_DATA_DIR
  知识库数据目录。
  默认 ./data。

OPENCODE_KB_USER
  当前测试用户。
  默认 default。
```

本地启动示例：

```bash
OPENCODE_KB_MODE=1 \
OPENCODE_KB_DATA_DIR=./data \
OPENCODE_KB_USER=alice \
OPENCODE_SERVER_PASSWORD=dev \
opencode web --port 4096
```

---

## 9. Server 层需要拦截的能力

必须禁止 shell 相关 API。

重点拦截：

```text
POST /session/:id/shell
```

如果存在以下 API，也应禁止或限制：

```text
PATCH /config
POST /mcp
TUI attach 相关接口
terminal 相关接口
command 相关接口
```

返回：

```http
403 Forbidden
```

响应示例：

```json
{
  "error": "Shell is disabled in knowledge base mode."
}
```

---

## 10. Tool 层权限要求

知识库模式启用时：

```text
bash: deny
shell: deny
terminal: deny
local command: deny
```

文件工具：

```text
read:
  data/users/<currentUserId>/** allow
  data/wiki/** allow
  others deny

edit/write/patch/delete:
  data/users/<currentUserId>/** allow
  data/wiki/** deny
  others deny

grep/glob:
  data/users/<currentUserId>/** allow
  data/wiki/** allow
  others deny
```

网络工具：

```text
webfetch: allow
websearch: allow
```

其他工具：

```text
task: allow
skill: allow
question: allow
```

需要注意：

```text
任何可能间接启动本地进程的工具都需要检查。
如果工具底层依赖本地命令执行，应在知识库模式下禁用。
```

---

## 11. UI 魔改任务

### 11.1 文件树展示

Web UI 文件树只展示两个根节点：

```text
我的知识库
公开 Wiki
```

映射关系：

```text
我的知识库 -> data/users/<currentUserId>/
公开 Wiki   -> data/wiki/
```

不要展示真实项目根目录。

---

### 11.2 Wiki 只读提示

打开 Wiki 文件时，编辑器需要显示只读状态。

建议 UI 文案：

```text
公开 Wiki，只读
```

禁止显示保存、修改、删除、重命名等操作。

---

### 11.3 用户目录可编辑

打开用户私有目录文件时，允许：

```text
编辑
保存
新建文件
新建目录
删除
重命名
```

UI 文案：

```text
我的知识库
```

---

### 11.4 隐藏危险入口

知识库模式下隐藏：

```text
终端
Shell
Run command
Bash tool
TUI attach
MCP 动态添加
配置修改入口
```

即使 UI 隐藏了，也必须保留 Server 层拦截。

---

## 12. 推荐新增抽象路径

为了避免前端直接感知真实路径，建议引入虚拟路径：

```text
kb://private/
kb://wiki/
```

映射：

```text
kb://private/xxx.md -> data/users/<currentUserId>/xxx.md
kb://wiki/xxx.md    -> data/wiki/xxx.md
```

好处：

1. UI 不暴露真实项目路径。
2. 权限判断更清晰。
3. 后续迁移到 Docker、远程存储、对象存储时更容易。

当前阶段如果改动成本太大，可以先直接使用真实路径，但推荐逐步过渡到虚拟路径。

---

## 13. 初始化脚本

新增初始化脚本：

```bash
scripts/init-kb-data.sh
```

脚本内容目标：

```bash
#!/usr/bin/env bash
set -euo pipefail

mkdir -p data/wiki
mkdir -p data/users/default
mkdir -p data/state/default

if [ ! -f data/wiki/README.md ]; then
  cat > data/wiki/README.md <<'EOF'
# Public Wiki

这是公开 Wiki，只读。
EOF
fi

if [ ! -f data/users/default/README.md ]; then
  cat > data/users/default/README.md <<'EOF'
# My Knowledge Base

这是默认用户的个人知识库，可读写。
EOF
fi

echo "Knowledge base data initialized."
```

运行：

```bash
bash scripts/init-kb-data.sh
```

---

## 14. 本地测试流程

### 14.1 初始化数据

```bash
bash scripts/init-kb-data.sh
```

### 14.2 启动知识库模式

```bash
OPENCODE_KB_MODE=1 \
OPENCODE_KB_DATA_DIR=./data \
OPENCODE_KB_USER=default \
OPENCODE_SERVER_PASSWORD=dev \
opencode web --port 4096
```

### 14.3 测试用户私有目录

要求：

```text
可以读取 data/users/default/README.md
可以修改 data/users/default/README.md
可以新建 data/users/default/test.md
可以删除 data/users/default/test.md
```

### 14.4 测试公共 Wiki

要求：

```text
可以读取 data/wiki/README.md
可以搜索 data/wiki/**
不能修改 data/wiki/README.md
不能新建 data/wiki/test.md
不能删除 data/wiki/README.md
```

### 14.5 测试越权访问

以下操作必须失败：

```text
读取 package.json
读取 .env
读取 ../package.json
读取 data/users/alice/README.md，当前用户不是 alice 时
修改 data/wiki/README.md
写入 data/wiki/new.md
使用 bash
调用 shell API
使用终端
```

---

## 15. 验收标准

### 15.1 功能验收

知识库模式开启后：

```text
用户只能看到“我的知识库”和“公开 Wiki”
用户可以编辑自己的知识库
用户可以读取公开 Wiki
用户不能编辑公开 Wiki
用户不能访问其他用户目录
用户不能访问 opencode 项目源码目录
用户不能使用 bash/shell/terminal
其他允许的 AI 工具可以正常使用
```

---

### 15.2 安全验收

以下攻击方式必须被拒绝：

```text
../ 路径穿越
绝对路径访问
软链接逃逸
通过 shell 读取文件
通过 shell 修改文件
通过 API 直接调用 shell
通过 UI 入口打开终端
通过修改 config 重新开启 bash
通过 MCP 添加本地命令工具
```

---

### 15.3 回归验收

知识库模式未开启时：

```bash
OPENCODE_KB_MODE=0
```

或不设置：

```bash
OPENCODE_KB_MODE
```

opencode 应尽量保持原始行为，不影响正常开发使用。

---

## 16. 开发阶段拆分

### Phase 1：本地数据目录与权限守卫

任务：

```text
创建 data 目录结构
新增初始化脚本
新增 kbAccessGuard
实现 private/wiki/deny 路径判断
禁止 bash 权限
```

验收：

```text
后端文件访问已经受到限制
bash 调用被拒绝
```

---

### Phase 2：Server API 拦截

任务：

```text
拦截 POST /session/:id/shell
拦截 PATCH /config
拦截 POST /mcp
拦截 TUI/terminal 相关接口
统一返回 403
```

验收：

```text
即使绕过前端直接请求 API，也不能执行 shell 或修改配置
```

---

### Phase 3：Web UI 知识库化

任务：

```text
文件树改成“我的知识库 / 公开 Wiki”
Wiki 文件显示只读
用户目录显示可编辑
隐藏 shell/terminal/config/mcp 入口
隐藏真实项目路径
```

验收：

```text
普通用户只能在 UI 中看到知识库相关内容
```

---

### Phase 4：多用户本地测试

任务：

```text
支持 OPENCODE_KB_USER=alice
支持 OPENCODE_KB_USER=bob
不同用户看到不同 private 目录
所有用户看到同一个 wiki 目录
```

验收：

```text
alice 不能访问 bob 的目录
bob 不能访问 alice 的目录
二者都可以读取 wiki
二者都不能修改 wiki
```

---

### Phase 5：后续生产化预留

当前阶段不实现，但需要预留接口：

```text
从登录 session 获取 userId
从反向代理 header 获取 userId
每用户独立 state
每用户独立 opencode server/container
wiki 目录改成只读挂载
审计日志
操作历史
管理员维护 wiki
```

---

## 17. 建议的 Git 分支

```bash
git checkout -b feature/kb-mode
```

---

## 18. 建议提交顺序

```text
chore: add local kb data init script
feat: add kb mode environment config
feat: add knowledge base access guard
feat: restrict file tools in kb mode
feat: disable shell APIs in kb mode
feat: adapt web file tree for kb mode
feat: mark public wiki as readonly
test: add kb mode permission tests
docs: add kb mode task document
```

---

## 19. 注意事项

1. 不要只做 UI 限制。
2. 不要只隐藏 bash 按钮，必须在 server 和 tool 层拒绝。
3. 不要允许模型访问项目根目录，否则它可以读写 opencode 源码。
4. 不要把用户可写目录作为配置目录。
5. 不要信任前端传来的路径。
6. 所有路径必须由后端解析和校验。
7. Wiki 只读最好后续再配合系统层只读挂载。
8. 当前 `data` 目录仅用于本地测试，后续生产环境应移动到独立数据目录或容器挂载目录。

---

## 20. 当前阶段完成定义

当以下命令启动后：

```bash
OPENCODE_KB_MODE=1 \
OPENCODE_KB_DATA_DIR=./data \
OPENCODE_KB_USER=default \
OPENCODE_SERVER_PASSWORD=dev \
opencode web --port 4096
```

系统满足：

```text
只能读写 data/users/default/**
只能读取 data/wiki/**
不能访问其他路径
不能使用 bash/shell/terminal
Web UI 展示为知识库界面
```

即可认为当前阶段任务完成。
