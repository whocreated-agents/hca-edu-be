# Build context: repo root.  docker build -f apps/api/Dockerfile .
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json prisma.config.ts ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN npm ci
COPY prisma prisma
COPY packages packages
COPY apps/api apps/api
RUN npx prisma generate \
    && npm run build -w @hca/contracts \
    && npm run build -w @hca/api

# Runtime keeps the full dependency tree on purpose: `prisma migrate deploy` and the tsx-run seed
# need the prisma CLI + tsx (devDependencies) at container start.
FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/storage && chown node:node /app/storage
USER node
EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && node apps/api/dist/main.js"]
