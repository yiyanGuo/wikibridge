# WikiBridge

WikiBridge 是一个把本地知识库、OpenCode 阅读/问答界面、LLM Wiki 后端和 BearFRP 发布能力组合在一起的课程项目。

项目目标是让用户把本地文档或 Wiki 构建成可检索、可阅读、可远程访问的知识库：

- `llm_wiki/` 提供知识库索引、文件阅读、搜索和图谱 API。
- `opencode/` 提供 Knowledge Base 模式的 Web UI 和 LLM Wiki 代理入口。
- `bearfrp/` 提供基于 frp/frps 的用户、代理、端口和发布管理能力。
- `desktop/` 提供 Tauri 桌面壳，整合 BearFRP 入口、本地 OpenCode 入口和 sidecar 管理。
- `docker-compose.yml` 提供一套可本地启动的 Web 端联调栈。

`opencode/` 和 `llm_wiki/` 是上游/外部代码目录；本仓库当前主要维护 `desktop/`、`bearfrp/`、部署脚本和项目 glue code。

## 环境要求

基础工具：

- Node.js `>=20.19.0`，npm
- Rust toolchain，Cargo，rustfmt
- Conda，项目 Python 环境名固定为 `bearfrp_test`
- Go toolchain，提供 `gofmt`
- Docker 和 Docker Compose，用于一键启动 Web 联调栈

构建桌面端和 sidecar 时还需要：

- Tauri v2 Linux/macOS/Windows 对应系统依赖
- `curl`、`tar`、`unzip`
- Bun 和 `protoc`，可通过 `desktop` 的 npm devDependencies 获得

Python 环境必须使用项目文档指定的 conda 环境：

```bash
conda run -n bearfrp_test python -m pip install -r bearfrp/requirements.txt
```

Node 依赖：

```bash
npm install
cd desktop && npm ci
cd ../bearfrp/desktop-frp && npm ci
```

## 快速启动

### Docker Compose Web 栈

从仓库根目录运行：

```bash
cp .env.example .env
cd llm_wiki && bash scripts/init-data-dir.sh && cd ..
docker compose up --build -d
```

启动后访问：

- OpenCode / WikiBridge 入口：<http://localhost>
- BearFRP 后台与 API：<http://localhost:8000>

自动创建的 BearFRP 发布地址可查看：

```bash
docker compose logs bearfrp-wikibridge-frpc
```

更多部署参数见 [README.deploy.md](README.deploy.md)。

### 桌面端开发

桌面端需要先准备当前平台 sidecar：

```bash
cd desktop
npm ci
npm run sidecars
npm run build
npm run tauri:dev
```

如果只想检查已有 sidecar 是否齐全：

```bash
cd desktop
npm run sidecars:check
```

### BearFRP 后端单独启动

```bash
cd bearfrp
conda run -n bearfrp_test python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

页面入口：

- <http://127.0.0.1:8000/user>
- <http://127.0.0.1:8000/admin>
- <http://127.0.0.1:8000/show>

## 测试

提交前建议运行：

```bash
npm run format:owned:check
cd desktop && npm run ci:check
```

`desktop` 的手动 CI 会依次运行：

- BearFRP backend pytest
- desktop TypeScript/Vite build
- sidecar 二进制布局检查
- Tauri Rust contract tests

单独运行 BearFRP 后端测试：

```bash
cd bearfrp
conda run -n bearfrp_test python -m pytest -q
```

桌面端系统测试：

```bash
cd desktop
npm run test:system:install
npm run test:system
```

包含真实进程的集成测试：

```bash
cd desktop
npm run test:integration:desktop
npm run test:integration:fake-stack
```

完整本地套件：

```bash
cd desktop
npm run test:all
```

## 格式化

格式化入口在仓库根目录：

```bash
npm run format:owned
npm run format:owned:check
```

提交前一行命令：

```bash
npm run format:owned && npm run format:owned:check && cd desktop && npm run ci:check
```

格式化脚本只处理 `desktop/` 和 `bearfrp/`，并跳过 `opencode/`、`llm_wiki/`、生成物、lockfile、sidecar 二进制和报告文件。

使用的 formatter：

- Prettier：TS/TSX/JS/MJS/CSS/HTML/JSON/YAML
- Ruff format：Python
- `cargo fmt`：Rust
- `gofmt`：Go

配置文件：

- [.prettierrc.json](.prettierrc.json)
- [pyproject.toml](pyproject.toml)
- [rustfmt.toml](rustfmt.toml)
- [scripts/format-owned.mjs](scripts/format-owned.mjs)

## 目录说明

```text
.
├── bearfrp/          # BearFRP 后端、静态前端、demo server、测试
├── desktop/          # Tauri 桌面端和 sidecar 编排
├── llm_wiki/         # LLM Wiki 上游/外部代码
├── opencode/         # OpenCode 上游/外部代码
├── docker/           # Compose 镜像和启动辅助
├── scripts/          # 项目级脚本
└── docker-compose.yml
```

## 常见问题

如果在 `/mnt/...` 下运行 `npm ci` 或 `cargo test` 遇到新生成二进制 `Permission denied`，通常是挂载目录执行权限问题。可以把仓库复制到 `/tmp` 或其他原生 Linux 文件系统路径后运行验证；源码本身不需要改变。

如果 `desktop` 的 `ci:check` 停在 sidecar 检查，先运行：

```bash
cd desktop
npm run sidecars
```
