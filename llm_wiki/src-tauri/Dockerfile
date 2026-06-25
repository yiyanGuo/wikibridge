FROM rust:1-bookworm AS builder

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        pkg-config \
        libssl-dev \
        libgtk-3-dev \
        libwebkit2gtk-4.1-dev \
        libayatana-appindicator3-dev \
        librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

COPY . .
RUN cargo build --release --bin llm-wiki-server

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        libgtk-3-0 \
        libwebkit2gtk-4.1-0 \
        libayatana-appindicator3-1 \
        librsvg2-2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/llm-wiki-server /usr/local/bin/llm-wiki-server

ENV LLM_WIKI_BIND=0.0.0.0 \
    LLM_WIKI_PORT=19828 \
    LLM_WIKI_DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 19828

CMD ["llm-wiki-server"]
