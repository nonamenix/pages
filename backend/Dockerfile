FROM node:22-bookworm-slim AS build

ENV NODE_ENV=production
WORKDIR /opt/app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --include=dev

COPY backend/ ./
RUN npm run build \
  && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /opt/app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=node:node /opt/app /opt/app
RUN mkdir -p /opt/app/public/uploads /opt/app/database/migrations /opt/app/.tmp \
  && chown -R node:node /opt/app/public /opt/app/database /opt/app/.tmp

USER node
EXPOSE 1337
CMD ["npm", "run", "start"]
