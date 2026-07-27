FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
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
CMD ["node", "src/server.mjs"]
