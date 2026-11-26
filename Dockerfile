# syntax=docker/dockerfile:1

# ── Stage 1: build the React client ──────────────────────────────────────────
FROM node:22-alpine AS client-builder

WORKDIR /build

# Copy workspace manifests first to benefit from Docker layer caching
COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/

RUN npm ci --workspace client --ignore-scripts

COPY client ./client
RUN npm run build --workspace client


# ── Stage 2: production server image ─────────────────────────────────────────
# One image serves the API, the Socket.IO endpoint and the built client from
# a single origin, so it can run as-is on any container host.
FROM node:22-alpine AS server

# The commit being built, surfaced by GET /api/version.
ARG GIT_COMMIT=unknown

LABEL org.opencontainers.image.title="SyncForge" \
      org.opencontainers.image.description="Real-time collaborative code workspace" \
      org.opencontainers.image.source="https://github.com/Priyadharsan-85/SyncForge" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.revision="${GIT_COMMIT}"

ENV NODE_ENV=production \
    PORT=3001 \
    GIT_COMMIT=${GIT_COMMIT}

# Non-root user for security
RUN addgroup -S syncforge && adduser -S syncforge -G syncforge

WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json ./
COPY server/package.json ./server/
RUN npm ci --workspace server --omit=dev --ignore-scripts && \
    npm cache clean --force

# Copy server source
COPY server/src ./server/src

# The built client, served by the Node server (see server/src/staticClient.js)
COPY --from=client-builder /build/client/dist ./client/dist

# Drop privileges
USER syncforge

EXPOSE 3001

# /health is liveness: it answers as soon as the process is serving, even
# while Redis is reconnecting, so a Redis blip doesn't get the container killed.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["node", "server/src/index.js"]
