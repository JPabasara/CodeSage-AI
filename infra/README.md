# infra/

The local stack. Seven services on your laptop, wired together by Docker Compose — six that stay
running, plus `migrate`, which applies the database migrations and exits.

**None of this runs in production.** Railway, Neon and Upstash never read these files — the
compose file is a development tool. What changes between here and there is written down in
[the deployment log's Compose reference, §7](../docs/Project%20Management%20&%20Planning/deployment-implementation-log.md#7-what-actually-happens-in-production).

| File | What it is |
|---|---|
| `docker-compose.yml` | The stack. Seven services (`postgres`, `redis`, `ml`, `migrate`, `api`, `worker`, `web`) |
| `docker-compose.dev.yml` | An **opt-in** override that publishes Postgres on `127.0.0.1:5433`. Never applied by default |
| `.env.example` | Template. Copy to `.env` |
| `.env` | **Yours, gitignored.** Asgardeo credentials |
| `postgres/init/01-init.sql` | Runs once, on a fresh database. Creates the `codesage_app` role — see [postgres/README.md](postgres/README.md) |

---

## Start it

```powershell
cd infra
cp .env.example .env     # then fill in the Asgardeo values
docker compose build
docker compose up -d     # allow ~90s — the worker's start_period alone is 45s
docker compose ps        # everything should read (healthy)
```

`web` → <http://localhost:3000>  ·  `api` → <http://localhost:8000>

From nothing, when something is badly wrong:

```powershell
docker compose down -v --remove-orphans   # -v ALSO DELETES THE DATABASE
docker compose build
docker compose up -d
```

---

## What you have to supply

Cloning the repository gives you a compose file with all the local passwords already in it. Two
files are yours and are never shared:

| File | Needed for | How |
|---|---|---|
| `infra/.env` | Asgardeo sign-in | Copy `.env.example`, fill in the client id and secret from the Asgardeo console (or a teammate, privately) |
| `apps/web/.env.local` | `pnpm dev` only — **not** for Docker | Copy `apps/web/.env.example` |

Everything else works from a clean clone. `apps/api/.env.example` is the checklist of every
backend setting; it is committed precisely so nobody has to guess.

### `devpassword` is committed on purpose

`docker-compose.yml` contains `devpassword` and `dev-only-change-me` in plain sight. That is not
an oversight:

- Postgres and Redis are **not published**, so nothing outside your laptop can reach them;
- it is a throwaway database that `docker compose down -v` deletes;
- production never reads this file.

**The rule:** a real secret goes in `.env` and is referenced as `${NAME:-}`. A fake local value is
written literally.

> `infra/.env` is read by **Compose itself**, for `${...}` substitution only. It is *not* handed
> to the containers. A value reaches a container only because a `${...}` in an `environment:`
> block puts it there. Two different things that both involve a file called `.env`.

---

## What is published, and what is not

```
api        0.0.0.0:8000->8000/tcp     ← published
web        0.0.0.0:3000->3000/tcp     ← published
ml         8001/tcp                   ← NOT published
postgres   5432/tcp                   ← NOT published
worker     8000/tcp                   ← NOT published
```

**The `->` arrow is the whole difference.** A bare `8001/tcp` is an `EXPOSE` line in a Dockerfile
— documentation, opening nothing. Only a `ports:` entry in compose opens a door on your machine.

Inside the network every service can reach every other by its **service name**: `postgres`,
`redis`, `ml` are real hostnames there and nowhere else. It is a wall, not a lock — credentials do
not help you cross it from outside, because there is nothing listening to connect to.

Reach an unpublished service through a container instead:

```powershell
docker compose exec postgres psql -U codesage_owner codesage
docker compose exec api python -c "import urllib.request; print(urllib.request.urlopen('http://ml:8001/healthz').read())"
```

### Opening the database port, deliberately

```powershell
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
```

Typing the second `-f` is the point. The default stays locked, and opening it is something you
did on purpose and can see in your shell history. It binds `127.0.0.1:5433` — this machine only,
and 5433 so it cannot collide with a PostgreSQL already installed. Not 55432: that lands inside a
port range Windows reserves and refuses to bind.

---

## Two database URLs, two roles

```yaml
CODESAGE_DATABASE_URL:           ...codesage_app:...      # everyday use
CODESAGE_MIGRATION_DATABASE_URL: ...codesage_owner:...    # creating tables
```

| Role | Can | Why |
|---|---|---|
| `codesage_owner` | create and change tables | runs migrations |
| `codesage_app` | read and write rows only | **Row-Level Security is silently ignored for a table's owner.** If the app connected as the owner, tenant isolation would do nothing while appearing to work |

That is the single most important idea in `postgres/init/01-init.sql`, and forgetting the second
URL is what broke J0.4 — Alembic fell back to `localhost:5432` *from inside a container*, which
fails with an error that looks like broken networking and is not.

---

## `web` is different from everything else

Every backend setting is read when the container **starts**. Every `NEXT_PUBLIC_*` setting is
frozen into the JavaScript when the image is **built** — Next.js textually replaces
`process.env.NEXT_PUBLIC_API_BASE_URL` with a string literal during `next build`, because the
browser runs that code and a browser cannot read your server's environment.

So the API address is a `build.args:` entry, not an `environment:` entry:

```yaml
web:
  build:
    args:
      NEXT_PUBLIC_API_BASE_URL: ${CODESAGE_WEB_API_BASE_URL:-http://localhost:8000}
```

**Changing it means rebuilding, not restarting:**

```powershell
$env:CODESAGE_WEB_API_BASE_URL = "https://api.codesageai.dev"
docker compose build web
docker compose up -d web
```

It sat in compose as `environment:` until 20 Aug 2026 and did nothing at all — every deployed
image still called `localhost:8000`, meaning the user's own laptop.

**Mocking is always off in Docker.** `apps/web/Dockerfile` hardcodes
`ENV NEXT_PUBLIC_API_MOCKING=disabled`, and `.dockerignore` excludes `.env*` so `.env.local` never
reaches the build. An image built with the mock backend on would demo beautifully and prove
nothing. For mock data, run `pnpm dev` instead.

---

## Commands worth knowing

| Command | Does |
|---|---|
| `docker compose up -d` | Start everything, in the background |
| `docker compose ps` | What is running, and its health |
| `docker compose logs -f api` | Follow one service. **First thing to run when something breaks** |
| `docker compose config` | Print the file with every `${...}` filled in — the fastest way to see what a variable actually became |
| `docker compose exec api alembic upgrade head` | Run migrations by hand |
| `docker compose up -d --scale worker=3` | Three concurrent scans (PERF-07) |
| `docker compose down` | Stop and remove containers, **keep the data** |
| `docker compose down -v` | …and **delete the database** |

| You changed | Run |
|---|---|
| a Dockerfile or app source | `docker compose up -d --build` |
| `environment:` in compose | `docker compose up -d` |
| `NEXT_PUBLIC_API_BASE_URL` | `docker compose build web` — a restart is not enough |

---

## Known gaps, as of 26 Aug 2026

**Scans work as of 26 Aug 2026.** The CK jar used to be missing from every built image —
`apps/api/vendor/*.jar` is gitignored, so a fresh checkout had nothing to copy. The Dockerfile now
fetches it itself, pinned and checksummed, and fails the build if it cannot run it. Nothing to
download by hand; a plain `docker compose build api` is enough. (Log Entry 5, Step 2.)

**Scan a Java repository.** `analysed_extensions` is `[".java"]` — v1.0 analyses Java only,
because CK is a Java-only extractor. A Python repository scans *successfully* and finds nothing,
which looks like a failure and is not.

**`GET /readyz` returns 501.** It is an unfinished stub, and so is `/version`. The health endpoint
is **`/api/healthz`** — never point an orchestrator at `/readyz`.

**Profiles endpoints return 501.** `GET /api/profiles`, `GET /api/profiles/active` and
`PUT /api/profiles/active` are not implemented. The Profiles screen works only against MSW.

---

## Five things that will confuse you once

1. **`localhost` inside a container means the container**, not your laptop. Use the service name.
2. **`EXPOSE` opens nothing.** Only `ports:` does. Look for the `->` arrow.
3. **`infra/.env` is read by Compose, not given to containers.**
4. **`down -v` deletes your database.** Without `-v` the data survives.
5. **`NEXT_PUBLIC_*` needs a rebuild, not a restart.**

---

## Where to read more

| | |
|---|---|
| The full Compose explainer — the private network, where values come from, what changes in production | [deployment log → Reference — Docker Compose, explained](../docs/Project%20Management%20&%20Planning/deployment-implementation-log.md#reference--docker-compose-explained) |
| Frontend-with-MSW vs Docker vs the live site, and what cannot be tested locally | [deployment log → the three ways to run it](../docs/Project%20Management%20&%20Planning/deployment-implementation-log.md#reference--the-three-ways-to-run-it-and-what-each-one-can-prove) |
| What changed and why, per phase | [deployment log](../docs/Project%20Management%20&%20Planning/deployment-implementation-log.md) |
| The two roles and RLS | [postgres/README.md](postgres/README.md) |
