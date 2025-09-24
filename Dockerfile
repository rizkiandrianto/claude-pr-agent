# ---- build (compile TS -> JS) ----
FROM node:20-alpine AS build
RUN apk add --no-cache bash
WORKDIR /app

# install deps incl dev (for tsc)
COPY package*.json ./
# if you don't use package-lock.json, this still works
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:20-alpine AS runtime
RUN apk add --no-cache tini bash
ENV NODE_ENV=production
WORKDIR /app

# install only prod deps for server runtime
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# ✅ install Claude Code CLI globally in the *runtime* layer
# this ensures /usr/local/bin/claude exists at runtime
ARG CLAUDE_CODE_PKG=@anthropic-ai/claude-code
ARG CLAUDE_CODE_VERSION=latest
RUN npm i -g ${CLAUDE_CODE_PKG}@${CLAUDE_CODE_VERSION} \
 && ln -sf /usr/local/bin/claude /usr/bin/claude || true
ENV PATH="/usr/local/bin:${PATH}"

# app artifacts
COPY --from=build /app/dist ./dist

# persist Claude auth/config across containers
ENV XDG_CONFIG_HOME=/data/.config \
    XDG_CACHE_HOME=/data/.cache \
    XDG_DATA_HOME=/data/.local/share
RUN mkdir -p /data
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD sh -lc 'command -v claude >/dev/null 2>&1 || exit 1'

ENTRYPOINT ["/sbin/tini","--"]
EXPOSE 8080
CMD ["node","dist/server.js"]
