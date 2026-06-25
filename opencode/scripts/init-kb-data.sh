#!/usr/bin/env bash
set -euo pipefail

# Initialize the local knowledge-base data directory used by OPENCODE_KB_MODE.
# Safe to run repeatedly: existing files are never overwritten.

DATA_DIR="${OPENCODE_KB_DATA_DIR:-./data}"

mkdir -p "$DATA_DIR/wiki/docs"
mkdir -p "$DATA_DIR/users/default"
mkdir -p "$DATA_DIR/users/alice"
mkdir -p "$DATA_DIR/users/bob"
mkdir -p "$DATA_DIR/state/default"
mkdir -p "$DATA_DIR/state/alice"
mkdir -p "$DATA_DIR/state/bob"

if [ ! -f "$DATA_DIR/wiki/README.md" ]; then
  cat > "$DATA_DIR/wiki/README.md" <<'EOF'
# Public Wiki

这是公开 Wiki，只读。
EOF
fi

if [ ! -f "$DATA_DIR/wiki/docs/example.md" ]; then
  cat > "$DATA_DIR/wiki/docs/example.md" <<'EOF'
# Example Wiki Page

这是一个示例 Wiki 文档，用于演示公开只读知识库。
EOF
fi

for user in default alice bob; do
  if [ ! -f "$DATA_DIR/users/$user/README.md" ]; then
    cat > "$DATA_DIR/users/$user/README.md" <<EOF
# My Knowledge Base

这是用户 $user 的个人知识库，可读写。
EOF
  fi
done

echo "Knowledge base data initialized at: $DATA_DIR"
