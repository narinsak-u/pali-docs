FROM oven/bun:1.4.0 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/package.json
COPY apps/web/source.config.ts apps/web/source.config.ts
RUN bun install --frozen-lockfile
COPY apps/web apps/web
WORKDIR /app/apps/web
RUN bunx next build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
