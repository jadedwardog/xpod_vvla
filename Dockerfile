FROM rust:1.75-slim AS builder

RUN apt-get update && apt-get install -y \
    protobuf-compiler \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/xpod
COPY . .

RUN cargo build --release

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /usr/src/xpod/target/release/xpod /app/xpod
COPY --from=builder /usr/src/xpod/target/release/xpod-vector /app/xpod-vector
COPY --from=builder /usr/src/xpod/xpod-core/web_ui /app/web_ui

EXPOSE 30301

ENV SERVER_PORT=30301
ENV SERVER_HOST=localhost

CMD ["./xpod"]