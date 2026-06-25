#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${LLM_WIKI_DATA_DIR:-./data}"
mkdir -p "$DATA_DIR"

SAMPLE_PROJECT="$DATA_DIR/sample-wiki"
if [ ! -d "$SAMPLE_PROJECT/.llm-wiki" ]; then
    mkdir -p "$SAMPLE_PROJECT/.llm-wiki"
    cat > "$SAMPLE_PROJECT/.llm-wiki/project.json" <<'EOF'
{
  "id": "sample-wiki",
  "createdAt": "2026-06-25T00:00:00Z"
}
EOF
fi

mkdir -p "$SAMPLE_PROJECT/wiki"
mkdir -p "$SAMPLE_PROJECT/raw/sources"

if [ ! -f "$SAMPLE_PROJECT/purpose.md" ]; then
    cat > "$SAMPLE_PROJECT/purpose.md" <<'EOF'
# Purpose

This is a sample LLM Wiki project for headless server deployments.
EOF
fi

if [ ! -f "$SAMPLE_PROJECT/schema.md" ]; then
    cat > "$SAMPLE_PROJECT/schema.md" <<'EOF'
# Schema

Page types: entity, concept, source, query, synthesis, comparison.
Use YAML frontmatter on every page.
EOF
fi

if [ ! -f "$SAMPLE_PROJECT/wiki/index.md" ]; then
    cat > "$SAMPLE_PROJECT/wiki/index.md" <<'EOF'
# Index

- [[README]]
EOF
fi

if [ ! -f "$SAMPLE_PROJECT/wiki/README.md" ]; then
    cat > "$SAMPLE_PROJECT/wiki/README.md" <<'EOF'
---
title: README
type: concept
---

# README

Welcome to the LLM Wiki headless server.
EOF
fi

echo "Initialized LLM Wiki data directory: $DATA_DIR"
echo "Sample project: $SAMPLE_PROJECT"
