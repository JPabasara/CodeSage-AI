# infra/

The local stack: seven Compose services — six that stay running, plus `migrate`, which applies the
database migrations and exits.

**None of this runs in production.** Railway, Neon and Upstash never read these files.

| File | What it is |
|---|---|
| `docker-compose.yml` | The stack |
| `docker-compose.dev.yml` | **Opt-in** override publishing Postgres on `127.0.0.1:5433` |
| `.env.example` → `.env` | **Yours, gitignored.** Asgardeo client id and secret |
| `postgres/init/01-init.sql` | Runs once on a fresh volume — creates `codesage_app`. See [postgres/README.md](postgres/README.md) |

## Start

```powershell
cd infra
cp .env.example .env      # fill in the Asgardeo values
docker compose up -d      # ~90s; the worker's start_period alone is 45s
docker compose ps         # all six (healthy)
```

`web` → <http://localhost:3000> · `api` → <http://localhost:8000>

Start over (**`-v` deletes the database**):

```powershell
docker compose down -v --remove-orphans && docker compose build && docker compose up -d
```

## Commands

| Command | Does |
|---|---|
| `docker compose logs -f api` | Follow one service. **First thing when something breaks** |
| `docker compose config` | Print the file with every `${...}` resolved — fastest way to see what a variable became |
| `docker compose exec postgres psql -U codesage_owner codesage` | The database, without opening a port |
| `docker compose exec api alembic upgrade head` | Run migrations by hand |
| `docker compose up -d --scale worker=3` | Three concurrent scans (PERF-07) |

| You changed | Run |
|---|---|
| a Dockerfile or app source | `docker compose up -d --build` |
| `environment:` in compose | `docker compose up -d` |
| `NEXT_PUBLIC_API_BASE_URL` | `docker compose build web` — **a restart is not enough** |
| anything under `apps/api/alembic/` | `docker compose build migrate api worker` — `migrate` builds its **own** image, so rebuilding only `api` leaves it on stale files |

## Five things that will confuse you once

1. **`localhost` inside a container means the container**, not your laptop. Use the service name —
   `postgres`, not `localhost`. This was the J0.4 bug.
2. **`EXPOSE` opens nothing.** Only a `ports:` entry does. In `docker compose ps`, look for the `->`
   arrow: `0.0.0.0:8000->8000/tcp` is published, bare `5432/tcp` is not. Only `api` and `web` are
   published — that is the *only* difference between them and the rest.
3. **`infra/.env` is read by Compose, not given to containers.** A value reaches a container only
   because a `${...}` in `environment:` puts it there.
4. **`down -v` deletes your database.** Without `-v` the data survives.
5. **`NEXT_PUBLIC_*` is baked into the JavaScript at build time**, not read at startup — the browser
   cannot read your server's environment. Changing it means a rebuild. It sat in compose as
   `environment:` until 20 Aug 2026 and did nothing at all.

## `devpassword` is committed on purpose

`docker-compose.yml` contains `devpassword` and `dev-only-change-me` in plain sight. Postgres and
Redis are not published, the database is thrown away by `docker compose down -v`, and production
never reads this file.

**The rule:** a real secret goes in `.env` as `${NAME:-}`. A fake local value is written literally.

## Two database URLs, two roles

```yaml
CODESAGE_DATABASE_URL:           ...codesage_app:...      # everyday use
CODESAGE_MIGRATION_DATABASE_URL: ...codesage_owner:...    # creating tables
```

**Row-Level Security is silently ignored for a table's owner.** If the app connected as the owner,
tenant isolation would do nothing while appearing to work. So migrations run as the owner and
nothing else does. See [postgres/README.md](postgres/README.md).

## Opening the database port, deliberately

```powershell
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
```

Typing the second `-f` is the point — the default stays locked, and opening it is something you did
on purpose and can see in your shell history. It binds `127.0.0.1:5433`: this machine only, and 5433
so it cannot collide with a local PostgreSQL.

## Known gaps

- **`GET /readyz` and `/version` return 501.** Unfinished stubs. The health endpoint is
  **`/api/healthz`** — never point an orchestrator at `/readyz`.
- **Profiles endpoints return 501.** The Profiles screen works only against MSW.
- **Scan a Java repository.** `analysed_extensions` is `[".java"]`; a Python repo scans successfully
  and finds nothing, which looks like a failure and is not.

## More

[Deployment log](../docs/Project%20Management%20&%20Planning/deployment-implementation-log.md) — what
is deployed, what broke on the way, and what cannot be tested locally.
