# Test Task Runner

`test-tasks.mjs` maps the black-box and white-box targets in
`/root/SE/doc/测试文档.pdf` to executable checks for T-01 through T-09.

Run source-level checks that do not require a running Compose stack:

```bash
cd /root/SE/wikibridge
node scripts/test-tasks.mjs
```

Run specific tasks:

```bash
node scripts/test-tasks.mjs --task T-04,T-05
```

Run black-box HTTP checks after starting services with `docker compose up -d`:

```bash
node scripts/test-tasks.mjs --blackbox --no-whitebox \
  --base-url http://127.0.0.1 \
  --bearfrp-url http://127.0.0.1:8000
```

Useful environment variables:

- `WIKIBRIDGE_BASE_URL`: nginx/OpenCode entry, default `http://127.0.0.1`
- `LLM_WIKI_API_URL`: direct or bridged LLM Wiki API base
- `BEARFRP_API_URL`: BearFRP API base
- `WIKIBRIDGE_TEST_PROJECT`: project id, default `current`
- `WIKIBRIDGE_TEST_QUERY`: search keyword, default `example`
- `LLM_WIKI_TOKEN`: optional API token used by LLM Wiki black-box checks

Task coverage:

- `T-01`: Docker Compose config and optional service health probes
- `T-02`: LLM Wiki mocked tests, MCP tests, and optional API probes
- `T-03`: OpenCode KB permission tests and optional HTTP guard probes
- `T-04`: BearFRP user/proxy pytest coverage
- `T-05`: frps plugin and poller pytest coverage
- `T-06`: sidecar syntax check and optional Docker image build
- `T-07`: optional end-to-end HTTP entry checks
- `T-08`: BearFRP/LLM Wiki security and error-boundary checks
- `T-09`: desktop Playwright system tests and Tauri Rust contract tests
