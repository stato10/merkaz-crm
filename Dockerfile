# syntax=docker/dockerfile:1

# ---- deps: install once, cached by lockfile ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: Next.js standalone output ----
FROM node:24-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_DEMO_MODE=0
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_DEMO_MODE=$NEXT_PUBLIC_DEMO_MODE
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- migrate: one-off job that pushes the schema, RLS policies and demo data ----
FROM deps AS migrate
WORKDIR /app
COPY drizzle.config.ts tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
CMD ["sh", "-c", "npm run db:push && if [ \"$SEED_DEMO\" = \"1\" ]; then npm run db:seed; fi"]

# ---- runtime: small image, non-root ----
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
