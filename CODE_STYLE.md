# Code Style

This repository only owns the `desktop/` and `bearfrp/` source trees. Do not run
project-wide formatting over `opencode/` or `llm_wiki/`; those are upstream or
third-party codebases.

## Formatting Command

Run all owned formatters from the repository root:

```bash
npm run format:owned
```

Check formatting without rewriting files:

```bash
npm run format:owned:check
```

## Tooling

- JavaScript, TypeScript, React, CSS, HTML, JSON, and YAML use Prettier with
  `.prettierrc.json`.
- Python uses Ruff's formatter through the documented BearFRP conda environment
  `bearfrp_test`.
- Rust uses `cargo fmt` / `rustfmt` for the Tauri crates.
- Go uses `gofmt` when the Go toolchain is available.

The script intentionally avoids formatter-driven lint fixes. It only applies
syntax-preserving formatting and skips Markdown prose, generated artifacts,
bundled binaries, lockfiles, and report output.

## Python Environment

BearFRP documentation specifies the conda environment `bearfrp_test`. Install or
refresh its Python dependencies before running Python formatting:

```bash
conda run -n bearfrp_test python -m pip install -r bearfrp/requirements.txt
```
