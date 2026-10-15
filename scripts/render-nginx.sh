#!/bin/sh
# Fill the RPC origin into the nginx CSP template, so connect-src always
# matches the RPC_URL baked into the bundle.
set -eu

if [ $# -ne 2 ]; then
  echo "Usage: $0 <rpc-url> <template>" >&2
  exit 1
fi

RPC_URL="$1"
TEMPLATE="$2"

# Strict shape check: the value lands in a response header, so anything that
# isn't a plain https origin (plus optional path) is refused.
if ! printf '%s' "$RPC_URL" | grep -Eq '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._~/-]*)?$'; then
  echo "render-nginx: RPC_URL must be an https URL, got: $RPC_URL" >&2
  exit 1
fi

HOST=$(printf '%s' "$RPC_URL" | sed -E 's#^https://([^/]+).*#\1#')

sed -e "s#__RPC_ORIGIN__#https://$HOST#g" -e "s#__RPC_WS_ORIGIN__#wss://$HOST#g" "$TEMPLATE"
