# syntax=docker/dockerfile:1

# Docker CLI stage, copied in rather than installed.
FROM docker:cli AS dockercli

FROM node:22-slim AS build
WORKDIR /app
COPY services/sandbox-runner/package.json ./
RUN npm install --no-audit --no-fund
COPY services/sandbox-runner/tsconfig.json ./
COPY services/sandbox-runner/src ./src
RUN npm run build

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker

COPY services/sandbox-runner/package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist ./dist

EXPOSE 4000
CMD ["node", "dist/index.js"]
