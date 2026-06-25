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

Build and copy current-platform frpc, OpenCode, and LLM Wiki sidecars:

```bash
npm run sidecars
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

## Packaging

See [PACKAGING.md](./PACKAGING.md) for the full desktop packaging workflow,
including sidecar preparation, platform output paths, and release checks.
