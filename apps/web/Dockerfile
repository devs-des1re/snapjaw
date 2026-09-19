# syntax=docker/dockerfile:1

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

# Kept separate: deriving from builder would drag in the whole workspace install.
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

# Standalone output mirrors the workspace, so the server entry is nested under apps/web.
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
# Standalone does not bundle public/, so static assets have to be copied across by hand.
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
