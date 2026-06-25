# WikiBridge Desktop

This is the final desktop packaging project for WikiBridge.

It contains the Tauri shell, the BearFRP entry, and the OpenCode entry. OpenCode
and LLM Wiki source code stay in their existing top-level directories; only
their built binaries are copied into `src-tauri/binaries`.

## Entries

- BearFRP: calls a remote BearFRP backend and manages local `frpc`.
- OpenCode: starts local `llm-wiki-server` and `opencode` sidecars, then loads
  OpenCode from `http://127.0.0.1:<port>/` in the same desktop window.

BearFRP backend and `frps` are never bundled into this app.

## Sidecars

Expected binary layout:

```text
src-tauri/binaries/
  frpc/<platform>/frpc
  opencode/<platform>/opencode
  llm-wiki-server/<platform>/llm-wiki-server
```

Use `.exe` suffixes on Windows.

Build and copy current-platform OpenCode and LLM Wiki sidecars:

```bash
npm run sidecars
```

Download current-platform `frpc` from the upstream frp release:

```bash
npm run sidecars:frpc
```

Copy existing build outputs without rebuilding:

```bash
npm run sidecars -- --skip-build
```

## Development

```bash
npm ci
npm run build
npm run tauri:dev
```

The OpenCode entry requires `opencode` and `llm-wiki-server` binaries to be
present under `src-tauri/binaries` for the current platform.

## Testing

Run the minimal desktop check before handoff or packaging:

```bash
npm run ci:check
```

The current check runs the frontend build, validates required sidecar binaries
for the host platform, and runs the Tauri Rust contract tests. To check
sidecars for a specific packaging target:

```bash
npm run ci:check -- --platform linux-amd64
```

Run browser-level desktop system tests with a mocked Tauri backend:

```bash
npm run test:system:install
npm run test:system
```

These tests use a mocked Tauri backend and are intended to capture correct
behavior even when the current app still has known bugs.

Run real integration checks:

```bash
npm run test:integration:desktop
```

Integration tests require a conda environment named `bearfrp_test` with
`bearfrp/requirements.txt` installed. The script starts the BearFRP backend
with an isolated temporary config directory, checks current-platform sidecars,
and writes logs under `test-results/integration/`.

Run the full local suite:

```bash
npm run test:all
```

`test:all` includes real integration tests, so it requires `bearfrp_test` and
current-platform sidecars. Known product bugs should be tracked in
`tests/system/known-bugs.ts` and marked with Playwright `test.fail()` until the
bug is fixed.

GitHub Actions runs the desktop suite on Linux, macOS, and Windows. Failed runs
upload Playwright reports and integration logs as workflow artifacts.

## Packaging

See [PACKAGING.md](./PACKAGING.md) for the full desktop packaging workflow,
including sidecar preparation, platform output paths, and release checks.
