FROM node:25-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y \
    openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .

RUN DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder \
    npx prisma generate

RUN npm run build

FROM node:25-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV STORAGE_PATH=/app/storage

RUN apt-get update && apt-get install -y \
    openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=node:node /app/package*.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/prisma.config.ts ./

RUN mkdir -p storage && chown node:node storage

USER node

EXPOSE 3000

CMD ["node", "dist/main"]
