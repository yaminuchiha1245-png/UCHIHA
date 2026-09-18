FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/provider-mobile/package.json apps/provider-mobile/package.json
COPY apps/owner-mobile/package.json apps/owner-mobile/package.json
COPY apps/radius-agent/package.json apps/radius-agent/package.json
COPY apps/telegram-bot/package.json apps/telegram-bot/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:24-bookworm-slim AS provider-builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY reference/UCHIHA-RADIUS-UI-V1-83.html ./reference/UCHIHA-RADIUS-UI-V1-83.html
COPY apps/provider-v183-runtime ./apps/provider-v183-runtime
COPY scripts/build-provider-v183.mjs ./scripts/build-provider-v183.mjs
RUN npm run provider:v183:server

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node apps ./apps
COPY --chown=node:node packages ./packages
COPY --chown=node:node infra/postgres ./infra/postgres
COPY --from=provider-builder --chown=node:node /app/dist/provider ./dist/provider
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:8787/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "apps/api/src/server.js"]
