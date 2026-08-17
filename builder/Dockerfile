FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# CI-equivalent verification is part of the production image build itself.
# This keeps VPS deploys fail-closed even when external GitHub Actions runners
# are unavailable: a syntax, lint, unit-test, or build failure stops docker build
# before migrations or live containers can be replaced.
FROM dependencies AS verification
COPY migrations ./migrations
COPY public ./public
COPY src ./src
COPY scripts ./scripts
COPY test ./test
COPY Dockerfile railway.json ./

# npm run check starts by running the same V60 materializer used by direct CI.
# The materializer accepts real gzip or Base64-wrapped gzip, verifies the SHA-256
# of the decompressed approved release, normalizes the gzip asset, and creates
# plain HTML/JS siblings. Node startup then reads only those verified plain files;
# gzip is retained solely as an optional HTTP transfer encoding for the JS asset.
RUN npm run check \
 && npm run lint \
 && npm test \
 && npm run build

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev

FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PREVIEW_MEMORY_MODE=false \
    REQUIRE_PERSISTENT_DATABASE=true \
    DEMO_SEED=false \
    ALLOW_DEMO_BILLING=false \
    TELEGRAM_MODE=live \
    UCHIHA_API_1_MODE=test
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node migrations ./migrations
COPY --from=verification --chown=node:node /app/public ./public
COPY --chown=node:node src ./src
COPY --chown=node:node railway-python-compat.sh /usr/local/bin/python
RUN chmod 755 /usr/local/bin/python
USER node
EXPOSE 4100
CMD ["node", "src/start.mjs"]
