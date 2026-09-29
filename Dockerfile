# syntax=docker/dockerfile:1

# ── Build stage: production dependencies, compiling native modules if needed ──
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ── Runtime stage: no build tools, runs as the unprivileged "node" user ──
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8081 \
    DATA_DIR=/data
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY . .

# Code stays root-owned (read-only for the app); only /data is writable.
RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 8081
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8081) + '/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "app.js"]
