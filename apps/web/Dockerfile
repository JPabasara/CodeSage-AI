# syntax=docker/dockerfile:1

# Code Sage AI — frontend image.
#
# Four stages: base → deps → builder → runner. Only `runner` ships; the other
# three exist so a lockfile that has not changed does not trigger a reinstall,
# and so pnpm, the source tree and the dev dependencies never reach production.
#
# ⚠️ The API address is fixed when this image is BUILT, not when it runs.
# Next.js replaces every `process.env.NEXT_PUBLIC_*` with a string literal during
# `next build`, so setting it in a compose file or at `docker run` does nothing to
# an image that is already built. It arrives as a build argument instead, and
# pointing the frontend at a different backend means building a new image.
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
# Around 830 packages, and one slow tarball timing out should not fail the whole
# install. pnpm reads npm_config_* from the environment, so these apply without an
# .npmrc that would have to be kept in sync with everyone's laptop.
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

# --frozen-lockfile fails rather than quietly resolving a different version than
# the one that was tested. "It builds on a clean machine" is only worth something
# if the clean machine installs the same tree.
#
# The cache mount keeps downloaded tarballs between builds, so a timeout on the
# last package does not throw away five minutes of work. Build-time only —
# nothing from it reaches an image layer, so a cold cache gives the identical
# result, just slower.
RUN --mount=type=cache,id=codesage-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile


# ── builder ──────────────────────────────────────────────────────────────────
FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The build argument. The default is the local stack, so a bare `docker build`
# still produces something that works on a laptop. Override it for anywhere real:
#
#   docker build --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.example.com .
#
# To prove it works: build twice with different values and grep the two images'
# .next/static chunks — the string differs.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}

# Hard-off, not merely absent. The app starts its MSW fake backend when this is
# "enabled", and .env.local sets exactly that locally. A production image that
# answered its own API calls would look healthy while proving nothing.
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

# busybox wget, so no extra package. Compose waits on this; the start period
# covers Next's cold start.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD wget --quiet --spider http://127.0.0.1:3000/ || exit 1

CMD ["node", "server.js"]
