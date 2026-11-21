FROM node:22-bookworm-slim AS build
RUN apt-get update \n    && apt-get install -y --no-install-recommends ca-certificates \n    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    SNAPJAW_DATA_DIR=/data \
    SNAPJAW_MIGRATIONS_DIR=/app/drizzle \
    SNAPJAW_SMTP_PORT=2587 \
    SNAPJAW_SMTPS_PORT=2465
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/bin ./bin
RUN ln -s /app/bin/snapjaw.mjs /usr/local/bin/snapjaw \
    && chmod +x /app/bin/snapjaw.mjs \
    && mkdir -p /data \
    && chown node:node /data
USER node
EXPOSE 3000 2587 2465
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/.krate/server/server.mjs"]
