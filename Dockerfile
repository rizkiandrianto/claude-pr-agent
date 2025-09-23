# syntax=docker/dockerfile:1.7

############################
# Base (common)
############################
FROM node:20-alpine AS base
RUN apk add --no-cache tini bash
ENV APP_HOME=/home/node
WORKDIR $APP_HOME

# Global npm prefix for non-root "node" user
ENV NPM_CONFIG_PREFIX=$APP_HOME/.npm-global
ENV PATH=$NPM_CONFIG_PREFIX/bin:$PATH

# Where the CLI will save its login token (mount this)
# ENV XDG_CONFIG_HOME=/data/.config
# ENV XDG_CACHE_HOME=/data/.cache
# ENV XDG_DATA_HOME=/data/.local/share
# RUN mkdir -p /data && chown -R node:node /data $APP_HOME
# VOLUME ["/data"]

############################
# Build stage
############################
FROM base AS build
USER node

# 1) Install deps (include devDeps)
COPY --chown=node:node package*.json ./
RUN --mount=type=cache,target=/home/node/.npm,uid=1000,gid=1000 \
    npm cache clean --force && \
    npm install --no-audit --no-fund

# 2) Compile TS
COPY --chown=node:node tsconfig.json ./
COPY --chown=node:node src ./src
RUN npm run build

# 3) Install Claude Code CLI globally (still in build stage)
ARG CLAUDE_CODE_PKG=@anthropic-ai/claude-code
ARG CLAUDE_CODE_VERSION=latest
RUN --mount=type=cache,target=/home/node/.npm,uid=1000,gid=1000 \
    npm i -g ${CLAUDE_CODE_PKG}@${CLAUDE_CODE_VERSION}

############################
# Runtime stage
############################
FROM base AS runtime
USER node

# Prod deps only
COPY --chown=node:node package*.json ./
RUN --mount=type=cache,target=/home/node/.npm,uid=1000,gid=1000 \
  rm -rf node_modules package-lock.json && \
  npm cache clean --force && \
  npm install --omit=dev --no-audit --no-fund

# Bring compiled app + global CLI from build
COPY --from=build --chown=node:node /home/node/dist /home/node/dist
COPY --from=build --chown=node:node /home/node/.npm-global /home/node/.npm-global

# Healthcheck — ensures CLI is on PATH
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD sh -lc 'claude --version >/dev/null 2>&1 || exit 1'

ENTRYPOINT ["/sbin/tini","--"]
ENV PORT=8080
EXPOSE 8080
CMD ["node","dist/server.js"]
