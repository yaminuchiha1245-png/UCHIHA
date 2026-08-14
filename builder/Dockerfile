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
COPY --chown=node:node public ./public
COPY --chown=node:node src ./src
COPY --chown=node:node railway-python-compat.sh /usr/local/bin/python
RUN chmod 755 /usr/local/bin/python
USER node
EXPOSE 4100
CMD ["node", "src/start.mjs"]
