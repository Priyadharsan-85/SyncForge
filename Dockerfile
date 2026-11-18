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
FROM node:22-alpine AS server

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

# Copy the built client output so the server can serve static assets if needed
COPY --from=client-builder /build/client/dist ./client/dist

# Drop privileges
USER syncforge

EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/ready || exit 1

CMD ["node", "server/src/index.js"]
