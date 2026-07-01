# WikiBridge 测试命令与脚本输出整理

测试时间：2026-06-26 15:50 CST  
测试目录：`/root/SE/wikibridge`  
测试脚本：`scripts/test-tasks.mjs`  

## 环境

```text
Node.js: v18.19.1
npm: 9.2.0
Docker: Docker version 29.4.3, build 055a478
Docker Compose: Docker Compose version v5.1.3
```

说明：本机 Node.js 版本低于 `20.19.0`，因此脚本会明确跳过依赖新版 Node 的 `T-02 llm_wiki mocked tests` 和 `T-09 desktop mocked system tests`。CI 或本机切换到 Node `20.19+` / `24+` 后可执行这些项。

## 1. 脚本语法检查

命令：

```bash
node --check scripts/test-tasks.mjs
```

输出：

```text
无输出，退出码 0
```

结论：通过。

## 2. Diff 空白检查

命令：

```bash
git diff --check -- scripts/test-tasks.mjs scripts/test-tasks.md
```

输出：

```text
无输出，退出码 0
```

结论：通过。

## 3. 本地临时数据目录 fixture 准备

命令：

```bash
tmpdir=$(mktemp -d)
node scripts/test-tasks.mjs --prepare-blackbox-data --no-whitebox --llm-wiki-data-dir "$tmpdir"
node -e "const fs=require('fs'); const p=process.argv[1]; const s=JSON.parse(fs.readFileSync(p+'/app-state.json','utf8')); if(!s.projectRegistry['sample-wiki']) throw new Error('missing registry'); if(!fs.existsSync(p+'/sample-wiki/wiki/README.md')) throw new Error('missing readme'); console.log('fixture-ok')" "$tmpdir"
rm -rf "$tmpdir"
```

输出：

```text
Prepared LLM Wiki black-box data: wrote /tmp/tmp.ALhXiZ30z7/sample-wiki
fixture-ok
```

结论：`sample-wiki` 可写入本地 LLM Wiki 数据目录，`app-state.json` 注册信息和 `wiki/README.md` 均存在。

## 4. Docker Compose fixture 准备

命令：

```bash
node scripts/test-tasks.mjs --prepare-blackbox-data
```

输出：

```text
Prepared LLM Wiki black-box data: wrote /data/sample-wiki in docker compose llm-wiki
```

结论：已在运行中的 Compose `llm-wiki` 容器内写入 `/data/sample-wiki`，未重启服务。

## 5. T-02/T-07 黑盒项目级检查

命令：

```bash
sleep 6
node scripts/test-tasks.mjs --full --blackbox --no-whitebox --task T-02,T-07 \
  --base-url http://127.0.0.1:18080 \
  --bearfrp-url http://127.0.0.1:8000 \
  --query WikiBridge
```

输出：

```text
Prepared LLM Wiki black-box data: wrote /data/sample-wiki in docker compose llm-wiki

T-02 LLM Wiki API
  [PASS] LLM Wiki health - HTTP 200
  [PASS] LLM Wiki projects - HTTP 200
  [PASS] LLM Wiki project files - HTTP 200
  [PASS] LLM Wiki search - HTTP 200
  [PASS] LLM Wiki graph - HTTP 200

T-07 end-to-end access
  [PASS] OpenCode page advertises KB mode - HTTP 200
  [PASS] bridge project list - HTTP 200
  [PASS] bridge project files - HTTP 200

Summary: 8 passed, 0 skipped, 0 failed in 3.9s.
```

结论：通过。`files/search/graph` 等项目级黑盒检查不再因缺少项目数据而跳过。

## 6. T-06 默认轻量模式

命令：

```bash
node scripts/test-tasks.mjs --task T-06
```

输出：

```text
T-06 auto-publish sidecar
  [PASS] sidecar Python syntax
  [SKIP] sidecar image build - disabled by CLI options

Summary: 1 passed, 1 skipped, 0 failed in 0.1s.
```

结论：通过。默认模式保留轻量行为，不执行 Docker build。

## 7. T-06 full + docker 模式

命令：

```bash
node scripts/test-tasks.mjs --full --docker --task T-06
```

输出摘要：

```text
T-06 auto-publish sidecar
  [PASS] sidecar Python syntax
 Image wikibridge-bearfrp-wikibridge-frpc Building
 ...
 Image wikibridge-bearfrp-wikibridge-frpc Built
  [PASS] sidecar image build

Summary: 2 passed, 0 skipped, 0 failed in 5.5s.
```

结论：通过。`--full --docker` 下 sidecar image build 实际执行。

## 8. T-09 full 模式

命令：

```bash
node scripts/test-tasks.mjs --full --task T-09
```

输出摘要：

```text
T-09 desktop knowledge-base loop
  [SKIP] desktop mocked system tests - Node 18.19.1 is below required 20.19.0

> wikibridge-desktop@0.1.0 test:contracts
> cargo test --manifest-path src-tauri/Cargo.toml --locked

Finished `test` profile [unoptimized + debuginfo] target(s) in 1m 21s

running 32 tests
...
test result: ok. 31 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.03s

running 0 tests
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

Doc-tests wikibridge_desktop_lib
running 0 tests
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

  [PASS] desktop Rust contract tests

Summary: 1 passed, 1 skipped, 0 failed in 82.8s.
```

结论：通过。Rust contract tests 使用隔离目录 `/tmp/wikibridge-test-target/desktop-tauri`，未受正在运行的 desktop sidecar target 目录占用影响。

## 9. T-02 full 模式

命令：

```bash
node scripts/test-tasks.mjs --full --task T-02
```

输出摘要：

```text
T-02 LLM Wiki API
  [SKIP] llm_wiki mocked tests - Node 18.19.1 is below required 20.19.0

> llm-wiki@0.5.0 mcp:test
> npm --prefix mcp-server test

> llm-wiki-mcp-server@0.4.25 test
> npm run build && node --test dist/test/*.test.js

TAP version 13
# Subtest: normalizeBaseUrl trims trailing slashes and falls back to localhost
ok 1 - normalizeBaseUrl trims trailing slashes and falls back to localhost
# Subtest: projects sends bearer token and parses current project
ok 2 - projects sends bearer token and parses current project
# Subtest: health does not send authorization
ok 3 - health does not send authorization
# Subtest: search posts JSON body to current project
ok 4 - search posts JSON body to current project
# Subtest: graph parses nodeType from API graph nodes
ok 5 - graph parses nodeType from API graph nodes
# Subtest: files exposes truncated flag
ok 6 - files exposes truncated flag
# Subtest: reviews requests unresolved review items with filters
ok 7 - reviews requests unresolved review items with filters
# Subtest: network failures include desktop app hint
ok 8 - network failures include desktop app hint
# Subtest: non-JSON responses include status and body preview
ok 9 - non-JSON responses include status and body preview
# Subtest: API errors include status and server message
ok 10 - API errors include status and server message
# Subtest: MCP server version is read from package.json
ok 11 - MCP server version is read from package.json
# Subtest: MCP server version supports source-layout execution
ok 12 - MCP server version supports source-layout execution
# Subtest: MCP server version falls back when package.json cannot be found
ok 13 - MCP server version falls back when package.json cannot be found
# Subtest: MCP server version falls back for invalid meta URLs
ok 14 - MCP server version falls back for invalid meta URLs
1..14
# tests 14
# pass 14
# fail 0

  [PASS] LLM Wiki MCP tests

Summary: 1 passed, 1 skipped, 0 failed in 3.6s.
```

结论：MCP tests 通过。`llm_wiki mocked tests` 因本机 Node 版本不足按预期跳过。

## 总结

- `T-02/T-07` 黑盒项目级检查：通过，`sample-wiki` fixture 生效。
- `T-06` 默认模式：通过，Docker build 保持跳过。
- `T-06 --full --docker`：通过，sidecar image build 实际执行。
- `T-09 --full`：Rust contract tests 通过，Playwright 因 Node 18 明确跳过。
- `T-02 --full`：MCP tests 通过，mocked tests 因 Node 18 明确跳过。
- 静态检查：`node --check` 和 `git diff --check` 均通过。

