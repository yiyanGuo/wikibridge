# Test Task Runner

`test-tasks.mjs` maps the black-box and white-box targets in
`/root/SE/doc/测试文档.pdf` to executable checks for T-01 through T-09.

Run lightweight source-level checks that do not require a running Compose stack:

```bash
cd /root/SE/wikibridge
node scripts/test-tasks.mjs
```

Lightweight mode may skip checks that need dependency installation, fixture data,
Docker image builds, or an isolated Cargo target directory. Use `--full` when you
want the runner to prepare those pieces and turn eligible skips into real checks.

Run specific tasks:

```bash
node scripts/test-tasks.mjs --task T-04,T-05
node scripts/test-tasks.mjs --full --task T-02
```

Run black-box HTTP checks after starting services with `docker compose up -d`:

```bash
node scripts/test-tasks.mjs --full --blackbox --no-whitebox \
  --base-url http://127.0.0.1 \
  --bearfrp-url http://127.0.0.1:8000
```

Recommended fuller runs:

```bash
node scripts/test-tasks.mjs --full
node scripts/test-tasks.mjs --full --blackbox --no-whitebox --task T-02,T-07 --base-url http://127.0.0.1:18080
node scripts/test-tasks.mjs --full --blackbox --base-url http://127.0.0.1:18080 --bearfrp-url http://127.0.0.1:8000
node scripts/test-tasks.mjs --full --docker --task T-06
```

`--full --blackbox` prepares a `sample-wiki` project for LLM Wiki API checks. By
default it writes into the running Docker Compose `llm-wiki` container without
restarting services. Use `--llm-wiki-data-dir <dir>` or `LLM_WIKI_DATA_DIR` to
prepare a local data directory directly, or run only the setup step:

```bash
node scripts/test-tasks.mjs --prepare-blackbox-data --llm-wiki-data-dir /tmp/llm-wiki-data
```

`T-02` mocked tests and `T-09` Playwright system tests require Node
`>=20.19.0`. CI uses a sufficiently new Node runtime; on a local older Node,
run the script through `nvm`, `fnm`, `asdf`, or your package manager after
selecting Node 20.19+ or 24+.

Useful environment variables:

- `WIKIBRIDGE_BASE_URL`: nginx/OpenCode entry, default `http://127.0.0.1`
- `LLM_WIKI_API_URL`: direct or bridged LLM Wiki API base
- `LLM_WIKI_DATA_DIR`: direct data dir for `sample-wiki` fixture preparation
- `BEARFRP_API_URL`: BearFRP API base
- `WIKIBRIDGE_TEST_PROJECT`: project id, default `current`
- `WIKIBRIDGE_TEST_QUERY`: search keyword, default `example`
- `LLM_WIKI_TOKEN`: optional API token used by LLM Wiki black-box checks

Task coverage:

- `T-01`: Docker Compose config and optional service health probes
- `T-02`: LLM Wiki mocked tests, MCP tests, and optional API probes; `--full`
  runs `npm ci` when `llm_wiki/node_modules` is missing
- `T-03`: OpenCode KB permission tests and optional HTTP guard probes
- `T-04`: BearFRP user/proxy pytest coverage
- `T-05`: frps plugin and poller pytest coverage
- `T-06`: sidecar syntax check and Docker image build with `--full --docker`
- `T-07`: optional end-to-end HTTP entry checks; `--full --blackbox` prepares
  the `sample-wiki` project used by project-level checks
- `T-08`: BearFRP/LLM Wiki security and error-boundary checks
- `T-09`: desktop Playwright system tests and Tauri Rust contract tests; `--full`
  runs contracts with an isolated `CARGO_TARGET_DIR`
