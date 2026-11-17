# syntax=docker/dockerfile:1.7
# Express API: production image (docs/DOCKER_SETUP.md).
# Build context: ecommerce-backend. TypeScript is compiled in the build stage;
# the runtime stage holds only dist/ (the server, the operator commands
# dbMigrate/dataMigrate/sessionsCleanup/reconcile, and the SQL migrations in
# dist/db/migrations) plus production dependencies, on a distroless base (no
# shell, no package manager) as an unprivileged user.
# The server never migrates at start-up: migrations are a separate one-off run
# of the same image with the command `dist/scripts/dbMigrate.js up`.

# Both pinned by digest; both Debian 13 with Node.js 24.22.3 (CI uses Node 24).
# The build image has npm and a shell; the runtime image has only node.
ARG BUILD_IMAGE=node:24-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0
ARG RUNTIME_IMAGE=gcr.io/distroless/nodejs24-debian13:nonroot@sha256:6abfcb367ebc291572c774c1592a986be2ab26a2486f73093401327495a5962a

FROM ${BUILD_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Exact lockfile versions; no package install scripts run.
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY . .
RUN npm run build

FROM ${BUILD_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund --ignore-scripts

FROM ${RUNTIME_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
# Root-owned and read-only for the server user; nothing is written at run time.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# distroless "nonroot" (uid 65532); stated explicitly.
USER 65532:65532
EXPOSE 3000
# /healthz: the process answers (no database). Readiness (/readyz: database
# reachable, 503 while draining) is for the load balancer and docker/compose.yaml.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# server.ts handles SIGTERM: readiness turns 503, requests drain, keep-alive
# connections close, then the pool and MongoDB close (lifecycle.ts).
STOPSIGNAL SIGTERM
# The image's entrypoint is /nodejs/bin/node.
CMD ["dist/server.js"]
