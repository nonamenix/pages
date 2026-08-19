FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /workspace/site-source

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
RUN chown -R node:node /workspace/site-source

COPY --chown=node:node astro.config.mjs tsconfig.json ./
COPY --chown=node:node src/ ./src/
COPY --chown=node:node public/ ./public/
COPY --chown=node:node publisher/server.mjs /app/server.mjs

USER node
EXPOSE 3000
CMD ["node", "/app/server.mjs"]
