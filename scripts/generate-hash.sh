#!/bin/bash
set -euo pipefail

DIST_DIR="$(dirname "$0")/../build"

if [ ! -d "$DIST_DIR" ]; then
  echo "Error: build/ directory not found. Run 'npm run build' first."
  exit 1
fi

# Hash ALL files in build/ (sorted for determinism)
HASH=$(find "$DIST_DIR" -type f | sort | xargs cat | shasum -a 256 | awk '{print $1}')

echo "SHA-256: $HASH"
echo ""
echo "Verify by running:"
echo "  find build -type f | sort | xargs cat | shasum -a 256"
