#!/bin/bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <expected-hash> [dist-dir]"
  exit 1
fi

EXPECTED="$1"
DIST_DIR="${2:-build}"

if [ ! -d "$DIST_DIR" ]; then
  echo "Error: directory '$DIST_DIR' not found."
  exit 1
fi

ACTUAL=$(find "$DIST_DIR" -type f | sort | xargs cat | shasum -a 256 | awk '{print $1}')

if [ "$ACTUAL" = "$EXPECTED" ]; then
  echo "VERIFIED: Build hash matches."
  echo "  Hash: $ACTUAL"
else
  echo "MISMATCH: Build hash does not match!"
  echo "  Expected: $EXPECTED"
  echo "  Actual:   $ACTUAL"
  exit 1
fi
