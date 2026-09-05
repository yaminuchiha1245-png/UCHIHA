FROM node:22-alpine

WORKDIR /app/bot
COPY bot/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY bot/ /app/bot/
COPY assets/ /app/assets/
COPY miniapp/icon-512.png /app/miniapp/icon-512.png
RUN test -s /app/miniapp/icon-512.png

ENV NODE_ENV=production
USER node
CMD ["node","bot.js"]
