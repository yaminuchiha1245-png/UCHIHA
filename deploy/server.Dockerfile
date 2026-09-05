FROM node:22-alpine

WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server/ /app/server/
COPY miniapp/ /app/miniapp/
COPY admin/ /app/admin/
COPY assets/ /app/assets/

RUN mkdir -p /app/server/backups \
    && chown -R node:node /app/server/backups

ENV NODE_ENV=production
EXPOSE 3000
USER node
CMD ["node","server.js"]
