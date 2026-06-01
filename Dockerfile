# Backend-only Docker image for ZeloChat (deployed on Dokploy / Fly / Render).
# Frontend is built separately via Dockerfile.frontend (nginx).

# ---- version stage: derive the build version from git --------------------
# Same logic as Dockerfile.frontend so the backend's /api/version reports the
# SAME commit the frontend bundle baked. That match is what makes the
# UpdateAvailableBanner fire only across deploys, never within one. .git stays
# in this throwaway stage — it never ships in the runtime image below.
FROM node:20-alpine AS version
WORKDIR /v
RUN apk add --no-cache git
COPY .git ./.git
ARG PUBLIC_APP_VERSION
RUN case "$PUBLIC_APP_VERSION" in \
      ''|'${'*) PUBLIC_APP_VERSION=$(git rev-parse --short=12 HEAD 2>/dev/null || echo dev) ;; \
    esac; \
    printf '%s' "$PUBLIC_APP_VERSION" > /v/APP_VERSION; \
    echo "[build] PUBLIC_APP_VERSION=$(cat /v/APP_VERSION)"

# ---- runtime stage -------------------------------------------------------
FROM node:20-alpine

WORKDIR /app

# Install deps (including devDeps so tsx is available)
COPY package*.json ./
RUN npm ci

# Copy source
COPY server ./server
COPY src/types.ts ./src/types.ts
COPY src/domain ./src/domain
COPY src/data ./src/data
COPY tsconfig*.json ./

# Baked build version (read at startup by the CMD below).
COPY --from=version /v/APP_VERSION ./APP_VERSION

# Dokploy/Fly/Render inject PORT — server already reads SERVER_PORT; map both
ENV SERVER_PORT=$PORT
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3001}/api/healthz >/dev/null || exit 1

# Export PUBLIC_APP_VERSION from the baked file (unless already provided via env)
# so GET /api/version reports the real build. `exec` keeps tsx/node as PID 1 so
# it still receives shutdown signals.
CMD ["sh", "-c", "export PUBLIC_APP_VERSION=\"${PUBLIC_APP_VERSION:-$(cat APP_VERSION 2>/dev/null)}\"; exec npx tsx server/index.ts"]
