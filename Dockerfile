FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-alpine AS source
WORKDIR /app
RUN apk add --no-cache git
COPY . .
ARG PUBLIC_APP_VERSION
RUN PUBLIC_APP_VERSION="$PUBLIC_APP_VERSION" node build-meta.mjs

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=source /app/package.json /app/build-info.json ./
COPY --from=source /app/server ./server
COPY --from=source /app/src/types.ts ./src/types.ts
COPY --from=source /app/src/domain ./src/domain
COPY --from=source /app/src/data ./src/data
USER node
EXPOSE 3001
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3001}/api/healthz >/dev/null || exit 1
CMD ["node", "--import", "tsx/esm", "server/index.ts"]
