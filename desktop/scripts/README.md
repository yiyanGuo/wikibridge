## Sidecar Scripts

Build and copy current-platform sidecars into Tauri's bundled resource tree:

```bash
npm run sidecars
```

Run BearFRP backend pytest through the project conda env:

```bash
npm run test:backend
```

Individual targets:

```bash
npm run sidecars:frpc
npm run sidecars:llm-wiki
npm run sidecars:opencode
```

Use `-- --skip-build` to copy existing build outputs without rebuilding.
