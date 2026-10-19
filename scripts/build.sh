#!/bin/bash
set -euo pipefail

echo "Building multisig-verifier..."
bun run build

echo ""
echo "Generating build hash..."
bash "$(dirname "$0")/generate-hash.sh"
