FROM node:22-alpine

# Install build tools for native packages
RUN apk add --no-cache python3 make g++

# Install pnpm globally
RUN npm install -g pnpm

WORKDIR /app

# Copy workspace manifest files first (for better layer caching)
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json tsconfig.json .npmrc ./

# Copy all lib packages (workspace dependencies)
COPY lib/ ./lib/

# Copy artifact apps
COPY artifacts/ ./artifacts/

# Copy scripts
COPY scripts/ ./scripts/

# Install dependencies in CI mode to skip purge confirmation
ENV CI=true
RUN pnpm install --frozen-lockfile --ignore-scripts

# Build API server for production runtime (used by Hugging Face / generic Docker)
RUN pnpm --filter @workspace/api-server run build

# Hugging Face Docker Spaces set PORT (usually 7860). Our API requires PORT.
ENV HOST=0.0.0.0
EXPOSE 7860

# Default: ensure DB schema exists, then run API server (docker-compose overrides this for dev)
CMD ["sh", "-c", "export PORT=\"${PORT:-7860}\"; cd /app/lib/db && pnpm run push && cd /app/artifacts/api-server && node --enable-source-maps /app/artifacts/api-server/dist/index.mjs"]

