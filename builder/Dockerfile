FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PREVIEW_MEMORY_MODE=true \
    REQUIRE_PERSISTENT_DATABASE=false \
    DEMO_SEED=true \
    ALLOW_DEMO_BILLING=true \
    TELEGRAM_MODE=fake \
    UCHIHA_API_1_MODE=test
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY migrations ./migrations
COPY public ./public
COPY src ./src
COPY railway-python-compat.sh /usr/local/bin/python
RUN chmod 755 /usr/local/bin/python
USER node
EXPOSE 4100
CMD ["node", "src/start.mjs"]
