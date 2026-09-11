#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This local build helper is only for macOS."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$FRONTEND_DIR/.." && pwd)"
TARGET_TRIPLE="$(rustc -vV | awk '/^host:/ { print $2 }')"
SIDECAR_DIR="$FRONTEND_DIR/src-tauri/binaries"

echo "Building llama-helper with Metal support..."
cargo build --manifest-path "$REPO_DIR/Cargo.toml" --release -p llama-helper --features metal

mkdir -p "$SIDECAR_DIR"
cp "$REPO_DIR/target/release/llama-helper" "$SIDECAR_DIR/llama-helper-$TARGET_TRIPLE"

echo "Building the local Meetily app..."
cd "$FRONTEND_DIR"
pnpm exec tauri build \
  --bundles app \
  --no-sign \
  --config '{"bundle":{"createUpdaterArtifacts":false}}' \
  --features metal

echo "Local app: $REPO_DIR/target/release/bundle/macos/meetily.app"
