# syntax=docker/dockerfile:1
#
# Build context is the repository root:
#   docker build -f services/sandbox-runner/Dockerfile -t snapjaw-sandbox-runner .

# The docker CLI, copied in rather than installed: the runner drives the host
# daemon over the mounted socket, so it needs the client and nothing else.
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
