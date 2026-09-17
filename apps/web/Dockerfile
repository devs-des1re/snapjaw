# syntax=docker/dockerfile:1
#
# Build context is the repository root:
#   docker build -f apps/web/Dockerfile --target runner -t snapjaw-web .
#
# Three targets: `builder` compiles the app, `migrator` carries drizzle-kit so
# migrations can run as their own step, `runner` is the small runtime image.

FROM node:22-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY services/sandbox-runner/package.json ./services/sandbox-runner/package.json
RUN npm ci --no-audit --no-fund

FROM node:22-slim AS builder
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /repo/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/web ./apps/web
COPY services/sandbox-runner/package.json ./services/sandbox-runner/package.json
RUN npm run build --workspace @snapjaw/web

# Migrations need drizzle-kit and the generated SQL, nothing else. Deriving this
# from `builder` works but drags in the whole workspace install (~1.8GB); this
# installs the version pinned in apps/web/package.json and stays small.
FROM node:22-slim AS migrator
WORKDIR /app
COPY apps/web/package.json ./package.json
RUN npm install --no-audit --no-fund \
      "drizzle-kit@$(node -p "require('./package.json').devDependencies['drizzle-kit']")" \
 && npm cache clean --force \
 && rm -rf /root/.npm /tmp/*
COPY apps/web/drizzle.config.ts ./
COPY apps/web/drizzle ./drizzle
CMD ["npx", "drizzle-kit", "migrate"]

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# `output: "standalone"` mirrors the workspace layout, so the server entry is
# nested under apps/web.
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
