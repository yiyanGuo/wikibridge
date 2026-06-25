FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl tar \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend ./backend
COPY frontend ./frontend
COPY scripts ./scripts
COPY static ./static
COPY config ./config
COPY frps ./frps

RUN mkdir -p /app/config /app/frontend /app/frps

EXPOSE 8000 7000 8080

CMD set -eu; \
    VERSION="${FRPS_VERSION:-v0.58.1}"; \
    VERSION_NOV="${VERSION#v}"; \
    ARCH="$(uname -m)"; \
    case "$ARCH" in \
      x86_64) ARCH=amd64 ;; \
      aarch64|arm64) ARCH=arm64 ;; \
      *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;; \
    esac; \
    if [ ! -x /app/frps/frps ]; then \
      tmp="$(mktemp -d)"; \
      url="https://github.com/fatedier/frp/releases/download/${VERSION}/frp_${VERSION_NOV}_linux_${ARCH}.tar.gz"; \
      echo "Downloading frps from ${url}"; \
      curl -fsSL -o "${tmp}/frp.tar.gz" "${url}"; \
      tar xzf "${tmp}/frp.tar.gz" -C "${tmp}"; \
      frps_path="$(find "${tmp}" -type f -name frps -print -quit)"; \
      if [ -z "${frps_path}" ]; then \
        echo "frps binary not found in release archive" >&2; \
        exit 1; \
      fi; \
      cp "${frps_path}" /app/frps/frps; \
      chmod +x /app/frps/frps; \
      rm -rf "${tmp}"; \
    fi; \
    exec uvicorn backend.main:app --host 0.0.0.0 --port "${BACKEND_PORT:-8000}"
