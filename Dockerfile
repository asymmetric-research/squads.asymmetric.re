FROM docker.io/oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
# Baked into the bundle and the CSP connect-src. Not a secret (every visitor's
# browser receives it), but kept out of this public repo so scrapers don't
# harvest the paid endpoint: CI passes the RPC_URL repo variable.
# An unset repo variable arrives as an empty build arg, hence the shell default
# rather than an ARG default (it matches the app's own fallback).
ARG RPC_URL
RUN export RPC_URL="${RPC_URL:-https://api.mainnet-beta.solana.com}" && \
    sh scripts/render-nginx.sh "$RPC_URL" nginx/default.conf.template > nginx-default.conf && \
    bun run build

FROM docker.io/nginxinc/nginx-unprivileged:stable-alpine
COPY --from=build /app/nginx-default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html
EXPOSE 8080
