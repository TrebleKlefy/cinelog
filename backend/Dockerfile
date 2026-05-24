# syntax=docker/dockerfile:1
# Production API image (AWS App Runner / ECS / Elastic Beanstalk from ECR)
FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma

RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim AS production

WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY prisma ./prisma

# Full node_modules from build (includes generated Prisma client + engines).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# Strip dev tooling; reinstall prisma CLI only for migrations at boot.
RUN npm prune --omit=dev && npm install prisma@6.19.3 --no-save

ENV PORT=4000

EXPOSE 4000

ENTRYPOINT ["sh", "-ec"]
CMD ["exec npx prisma migrate deploy && exec node dist/index.js"]
