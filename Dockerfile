FROM node:24-alpine AS dependencies
WORKDIR /app
COPY builder/package.json builder/package-lock.json ./
RUN npm ci

# Root-level Railway compatibility image for the Builder service.
# If Railway is configured with repository root '/', this image builds only
# the production Builder subtree and applies the same fail-closed verification
# used by builder/Dockerfile.
FROM dependencies AS verification
COPY builder/migrations ./migrations
COPY builder/public ./public
COPY builder/src ./src
COPY builder/scripts ./scripts
COPY builder/test ./test
COPY builder/Dockerfile builder/railway.json ./
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
COPY --chown=node:node builder/package.json builder/package-lock.json ./
COPY --chown=node:node builder/migrations ./migrations
COPY --chown=node:node builder/public ./public
COPY --chown=node:node builder/src ./src
COPY --chown=node:node builder/railway-python-compat.sh /usr/local/bin/python
RUN chmod 755 /usr/local/bin/python
USER node
EXPOSE 4100
CMD ["node", "src/start.mjs"]
