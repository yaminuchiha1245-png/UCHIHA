FROM node:22-alpine

WORKDIR /app/bot
COPY bot/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY bot/ /app/bot/
COPY assets/ /app/assets/

ENV NODE_ENV=production
USER node
CMD ["node","bot.js"]
