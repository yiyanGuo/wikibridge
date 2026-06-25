# syntax=docker/dockerfile:1
FROM rust:1.85-bookworm AS builder

# Install Tauri / GTK system dependencies required to build the Rust project.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libwebkit2gtk-4.1-dev \
        libjavascriptcoregtk-4.1-dev \
        libgtk-3-dev \
        libsoup-3.0-dev \
        libayatana-appindicator3-dev \
        librsvg2-dev \
        pkg-config \
        nodejs \
        npm \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the Cargo manifest first to cache dependencies.
COPY src-tauri/Cargo.toml src-tauri/Cargo.lock* ./src-tauri/
RUN mkdir -p src-tauri/src/bin \
    && echo 'fn main() {}' > src-tauri/src/main.rs \
    && echo 'fn main() {}' > src-tauri/src/bin/server.rs

# Build a dummy binary so that Cargo downloads and caches all dependencies.
WORKDIR /app/src-tauri
RUN cargo build --release --bin llm-wiki-server || true

# Now copy the real source and build the headless server binary.
WORKDIR /app
COPY src-tauri/src ./src-tauri/src
COPY src-tauri/tauri.conf.json ./src-tauri/
COPY src-tauri/capabilities ./src-tauri/capabilities
COPY src-tauri/icons ./src-tauri/icons
COPY mcp-server ./mcp-server

# Build the MCP server bundle (the Rust health endpoint only needs the binary,
# but bundling keeps the image self-consistent with desktop builds).
RUN cd mcp-server && npm ci && npm run build

WORKDIR /app/src-tauri
RUN cargo build --release --bin llm-wiki-server

# -----------------------------------------------------------------------------
FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        libwebkit2gtk-4.1-0 \
        libjavascriptcoregtk-4.1-0 \
        libgtk-3-0 \
        libsoup-3.0-0 \
        libayatana-appindicator3-1 \
        librsvg2-2 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 llmwiki

WORKDIR /app

COPY --from=builder /app/src-tauri/target/release/llm-wiki-server /usr/local/bin/llm-wiki-server
COPY --from=builder /app/mcp-server/dist /app/mcp-server/dist

# The data directory is where projects and app-state.json live.
ENV LLM_WIKI_DATA_DIR=/data
ENV LLM_WIKI_BIND=0.0.0.0
ENV LLM_WIKI_PORT=19828

RUN mkdir -p /data && chown -R llmwiki:llmwiki /data

USER llmwiki

EXPOSE 19828

ENTRYPOINT ["/usr/local/bin/llm-wiki-server"]
