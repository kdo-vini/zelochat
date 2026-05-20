# Backend-only Docker image for ZeloChat (deployed on Dokploy / Fly / Render).
# Frontend is built separately via Dockerfile.frontend (nginx).
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

# Dokploy/Fly/Render inject PORT — server already reads SERVER_PORT; map both
ENV SERVER_PORT=$PORT
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3001}/api/healthz >/dev/null || exit 1

CMD ["npx", "tsx", "server/index.ts"]
