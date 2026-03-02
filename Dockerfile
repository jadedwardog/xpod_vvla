# Build Stage
FROM rust:1.75-slim AS builder

# Install system dependencies for building
RUN apt-get update && apt-get install -y \
    protobuf-compiler \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/xpod
COPY . .

# Build the application
RUN cargo build --release

# Run Stage
FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy binary and required runtime assets
COPY --from=builder /usr/src/xpod/target/release/xpod /app/xpod
COPY --from=builder /usr/src/xpod/web_ui /app/web_ui
COPY --from=builder /usr/src/xpod/proto /app/proto

# Expose the Web UI and API port
EXPOSE 3000

CMD ["./xpod"]