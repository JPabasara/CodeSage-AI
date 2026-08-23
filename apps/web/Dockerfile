# syntax=docker/dockerfile:1

# Code Sage AI — frontend image (J0.1, J0.2).
#
# Four stages: base → deps → builder → runner. Only `runner` ships; the other
# three exist so a lockfile that has not changed does not trigger a reinstall,
# and so pnpm, the source tree and the dev dependencies never reach production.
#
# ⚠️ THE API ADDRESS IS FIXED WHEN THIS IMAGE IS BUILT, NOT WHEN IT RUNS.
# Next.js textually replaces every `process.env.NEXT_PUBLIC_*` with a string
# literal during `next build`. Setting NEXT_PUBLIC_API_BASE_URL in a compose
# file, a Railway variable, or a `docker run -e` does NOTHING to an image that
# is already built — the value is inside the JavaScript the browser downloads.
# So it arrives as a BUILD ARGUMENT (see `ARG` in the builder stage), and
# pointing the frontend at a different backend means building a new image.
# That is not a workaround; it is how Next.js works.
#
# ⚠️ apps/web is its own pnpm root (it has its own pnpm-lock.yaml and
# pnpm-workspace.yaml, and the repository has no top-level package.json), so the
# build context is this directory alone. Do not widen it to the repo root.

ARG NODE_VERSION=22-alpine
ARG PNPM_VERSION=11.15.1


# ── base ─────────────────────────────────────────────────────────────────────
# One place where the Node and pnpm versions are decided, so deps and builder
# cannot silently drift apart.
FROM node:${NODE_VERSION} AS base

ARG PNPM_VERSION
RUN npm install --global pnpm@${PNPM_VERSION}

# Next phones home during builds unless told not to. A CI build should not make
# network calls nobody asked for.
ENV NEXT_TELEMETRY_DISABLED=1

# ── Registry settings, tuned for a bad connection ────────────────────────────
# 831 packages, and the first attempt at this build died on number 828 with
# "The operation was aborted due to timeout". pnpm's defaults assume a fast,
# reliable link; a home connection on a bad evening is neither, and one slow
# tarball failing the whole install is not a real failure.
#
# pnpm reads npm_config_* from the environment, so these apply without an
# .npmrc that would then have to be kept in sync with anyone's laptop.
ENV npm_config_fetch_timeout=600000 \
    npm_config_fetch_retries=5 \
    npm_config_fetch_retry_mintimeout=10000 \
    npm_config_fetch_retry_maxtimeout=120000

# The store lives on a BuildKit cache mount (see the deps stage), which is not
# part of any image layer. pnpm's default is to hardlink out of the store into
# node_modules — and a hardlink into a cache mount does not survive being copied
# to the next stage. `copy` costs some disk inside the builder and nothing in
# the shipped image, which contains no node_modules at all.
ENV npm_config_package_import_method=copy \
    npm_config_store_dir=/pnpm/store

WORKDIR /app


# ── deps ─────────────────────────────────────────────────────────────────────
# Manifests only. Docker reuses this layer until one of these three files
# changes, so editing a component does not reinstall 900 packages.
FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# --frozen-lockfile makes the build fail rather than quietly resolve a different
# version than the one that was tested. "It builds on a clean machine" is only
# worth something if the clean machine installs the same tree.
#
# The cache mount keeps the downloaded tarballs between builds. Without it every
# retry re-downloads all 831 packages, so a timeout on the last one throws away
# five minutes of work — which is exactly what happened the first time. The
# mount is a build-time cache only: nothing from it reaches any image layer, so
# a clean machine with a cold cache still produces the identical result, just
# slower. CI can persist it with actions/cache to get the same benefit.
RUN --mount=type=cache,id=codesage-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile


# ── builder ──────────────────────────────────────────────────────────────────
FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# J0.2 — the build argument. Default is the local stack so a bare
# `docker build apps/web` still produces something that works on a laptop.
# Override it for anywhere real:
#
#   docker build --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.example.com .
#
# Proving it works: build twice with different values and grep the two images'
# .next/static chunks — the string differs. That is J0.2's "done when".
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}

# Hard-off, not merely absent. src/components/msw-provider.tsx starts the MSW
# fake backend when this equals "enabled", and .env.local sets exactly that for
# local development. .dockerignore keeps that file out of the context, but state
# it here too: a production image that answers its own API calls would look
# perfectly healthy while proving nothing.
ENV NEXT_PUBLIC_API_MOCKING=disabled

ENV NODE_ENV=production

# Writes .next/standalone (server + trimmed node_modules) and .next/static.
RUN pnpm run build


# ── runner ───────────────────────────────────────────────────────────────────
# No pnpm, no source, no dev dependencies, no package.json. Just the server
# Next generated and the assets it serves.
FROM node:${NODE_VERSION} AS runner

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

# Next's standalone server binds to localhost by default, which inside a
# container means "reachable from nowhere" — the port maps to a socket that
# nothing outside the container can open. Compose and Railway both need it
# listening on every interface.
ENV HOSTNAME=0.0.0.0

WORKDIR /app

# `node` (uid 1000) ships with the image. Running as root is a finding waiting
# to be written up, and costs nothing to avoid.
USER node

# The standalone bundle carries its own minimal node_modules and server.js.
COPY --from=builder --chown=node:node /app/.next/standalone ./
# Static assets and public/ are deliberately NOT included in the standalone
# bundle — Next expects a CDN to serve them. There is no CDN here, so the Node
# server serves them and they have to be copied to exactly these paths.
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

EXPOSE 3000

# busybox wget, so no extra package. Compose waits on this for J0.3's "six
# containers healthy at the same time"; start-period covers Next's cold start.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD wget --quiet --spider http://127.0.0.1:3000/ || exit 1

CMD ["node", "server.js"]
