# Backend-only Docker image for ZeloChat (for Railway / Fly / Render)
# Frontend deploys separately to Vercel.
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

# Railway/Fly/Render inject PORT — server already reads SERVER_PORT; map both
ENV SERVER_PORT=$PORT
EXPOSE 3001

CMD ["npx", "tsx", "server/index.ts"]
