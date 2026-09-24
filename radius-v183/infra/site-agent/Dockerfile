FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /opt/uchiha-radius-agent
COPY --chown=node:node package.json ./
COPY --chown=node:node apps ./apps
COPY --chown=node:node packages ./packages
COPY --chown=node:node check-config.mjs ./
RUN npm install --offline --ignore-scripts --no-audit --no-fund \
 && mkdir -p /var/lib/uchiha-radius-agent \
 && chown node:node /var/lib/uchiha-radius-agent
USER node
# Configuration is supplied from read-only mounts on the operator's computer.
# No router password or public inbound listening port is embedded in this image.
CMD ["sh", "-c", "node check-config.mjs && exec node apps/radius-agent/src/index.js"]
