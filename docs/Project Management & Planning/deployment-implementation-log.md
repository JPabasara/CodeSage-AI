# Deployment implementation log

*Janidu · infra, CI and Dockerfiles · append a new entry per phase.*

What this file is: a plain record of **what was changed, why, and how to check it still works**. Written so a teammate who has never opened a Dockerfile can follow it. Newest entry at the top.

New to Docker Compose? Start with **[Reference — Docker Compose, explained](#reference--docker-compose-explained)** at the foot of this file: the private network, where the passwords come from, and what changes in production.

---

## Entry 3 — 20 Aug 2026 — J0.5, J0.6 and J0.7 (CI)

**Plan reference:** §6, Phase 0, steps J0.5, J0.6, J0.7. Also §10.

**Status:** written, and every command verified on a clean Linux machine. **The workflow itself has not run on GitHub yet** — that needs a push. J0.7's "images are pullable by tag" is unproven until then. Do not tick it off before you have seen a green run.

### Files changed

| File | New? | What it does |
|---|---|---|
| `.github/workflows/ci.yml` | new | The whole pipeline — checks, image builds, publishing |
| `apps/web/package.json` | edited | Added a `typecheck` script (`tsc --noEmit`); there wasn't one |

### What runs, and who owns a red tick

One job per folder, deliberately — so a failure names its owner without anyone reading a log.

| Job | Steps | Owner |
|---|---|---|
| `web` | contract check → type check → lint → tests | Janidu |
| `api` | layer check → pytest → ruff *(advisory)* | Chamodh |
| `ml` | pytest → ruff | Nathasha |
| `images` | build `web`, `api`, `ml`; publish to GHCR **on `main` only** | Janidu |

### Why the steps are in that order

**Contract check first.** `docs/api/openapi.yaml` is the one file all three of us share. If it breaks, everyone is broken. Ten seconds to find out, instead of three minutes of tests first.

**Layer check second.** `lint-imports` checks the *shape* of the code, not whether it works: scoring must stay pure, workers must never score. A human reading one file cannot see this. A machine can.

**Tests last.** They are the slowest.

### Building vs publishing

Two different things, one job:

| | On a pull request | On `main` |
|---|---|---|
| Build the images | ✅ yes | ✅ yes |
| Upload them to GitHub | ❌ no | ✅ yes |

Building on a pull request answers *"does this still compile on a clean machine?"* — that is the point of J0.6. Uploading is only useful once the code is actually merged, so it waits for `main`.

There is also no choice about it: a pull request from someone else's fork gets a read-only token and **cannot** upload even if we wanted it to.

### Verified on a clean Linux machine

I did not just run these on this laptop. I exported the repository fresh, put it inside an empty `python:3.12-slim` container with no virtualenv and nothing pre-installed, and ran the exact commands CI will run:

| Job | Result |
|---|---|
| `web` | contract check OK · types clean · 0 lint errors · **25 tests pass** |
| `api` | install OK · **layer check: 3 rules kept, 0 broken** · 28 passed |
| `ml` | install OK · **ruff: all checks passed** |
| the workflow file itself | `actionlint`: no problems |

> My first attempt failed, but the mistake was mine, not CI's: I exported only `apps/api`, and one of its tests reads `docs/api/openapi.yaml` from the top of the repository. CI checks out everything, so it is fine.
>
> **Remember this if anyone ever tries to make jobs "only run when their folder changes".** A change to `docs/api/openapi.yaml` alone must still run the `api` job. We do not do that filtering today — leave it that way.

### Three things CI does not check, and why

These are decisions, not things I forgot.

**1. Ruff (Python style) does not fail the build.** There are 31 existing style complaints, **all in `apps/api`**. None came from this work.

Why not just fix them? They are in Chamodh's folder, and he is working in those files right now. Editing 18 of his files would cause exactly the merge mess §2 exists to prevent. The alternative — turning it on anyway — gives a pipeline that is red from day one, and a permanently red pipeline can never be used for branch protection.

So it runs and prints its findings, but does not block.

> **Chamodh:** `ruff check --fix .` fixes 26 of the 31 automatically. Once it is clean, remove `--exit-zero` from the workflow. `apps/ml` is already clean.

**2. Prettier (formatting) is not checked.** It currently complains about 82 files. Fixing them means one huge commit of pure whitespace right before we merge Phase 0 — and J2.2 is going to rewrite all those files anyway. §10 asks for "Lint", which is ESLint, and that passes cleanly.

**3. Mypy (Python types) is not checked.** It is misconfigured and refuses to start at all — unrelated to anything here, and not in §10's list.

### ⚠️ The most important thing on this page

**Six security tests are not actually running.** They report as "skipped", and the reason they print is misleading:

> *"Docker/PostgreSQL is unavailable"*

The real reason is:

```
role "codesage_app" does not exist
```

The test database never runs `infra/postgres/init/01-init.sql`, so the user account the tests need was never created. The tests quietly give up.

**Why this matters:** those six tests are the ones proving *one customer cannot see another customer's data*. Right now the suite says "30 passed" and looks perfectly healthy while checking none of that. §12's rule is *"never claim something is done when it is a skeleton"* — this is that, hidden behind a green tick.

What I could do from outside: CI now runs pytest with `-rs`, which forces it to **print why anything skipped**, so it is visible rather than buried. The real fix is in `apps/api/tests/conftest.py` — Chamodh's file. **Raise it with him.**

### Where the images go (J0.7)

After a merge to `main`, three images are uploaded to GitHub's built-in registry:

```
ghcr.io/jpabasara/codesage-ai/web
ghcr.io/jpabasara/codesage-ai/api
ghcr.io/jpabasara/codesage-ai/ml
```

Each gets two labels: `latest`, and the exact commit ID it was built from. The commit ID one matters — it lets you deploy or roll back to a *specific* version rather than whatever "latest" happens to mean today.

Small trap avoided: our repository is `JPabasara/CodeSage-AI`, but this registry **rejects capital letters**. `docker/metadata-action` lowercases it automatically. Writing the name by hand would have failed.

> ⚠️ **The `web` image has the API address baked inside it.** Not a setting it reads when it starts — it is frozen into the image at build time (see Entry 1).
>
> Right now that address is `http://localhost:8000`, so **the published web image only works on a laptop.**
>
> **When Railway gives us a real API address (J1.4):** add a repository variable called `WEB_API_BASE_URL` under *Settings → Secrets and variables → Actions → Variables*, then re-run this workflow to build a new image. Setting it in Railway will not work — by then it is too late.

### Still to do

| Step | What is needed |
|---|---|
| Verify J0.5/J0.6 | Open the Phase 0 pull request and see the jobs go green |
| Verify J0.7 | Merge to `main`, then `docker pull ghcr.io/jpabasara/codesage-ai/api:latest` |
| J0.8 | Branch protection on `main` — a GitHub settings change, not code. Require `web`, `api`, `ml`, `images` |

Packages published by Actions default to **private**. If teammates cannot pull, make them public under the repository's Packages settings.

---

## Entry 2 — 20 Aug 2026 — J0.3 and J0.4 (the whole stack up)

**Plan reference:** §6, Phase 0, steps J0.3 and J0.4.

**Status:** done. **Six containers healthy at the same time — the first time in this project.**

```
NAME                  SERVICE    STATUS
codesage-api-1        api        Up (healthy)
codesage-ml-1         ml         Up (healthy)
codesage-postgres-1   postgres   Up (healthy)
codesage-redis-1      redis      Up (healthy)
codesage-web-1        web        Up (healthy)
codesage-worker-1     worker     Up (healthy)
```

### Files changed

| File | New? | What changed |
|---|---|---|
| `infra/docker-compose.yml` | edited | Added `CODESAGE_MIGRATION_DATABASE_URL`; healthchecks for `api`, `ml`, `worker` |
| `apps/api/.dockerignore` | new | Build context 253 MB → 481 kB |
| `apps/ml/.dockerignore` | new | Build context 17 MB → 53 kB |

### The four things that were wrong

**1. Migrations could not run.** `CODESAGE_MIGRATION_DATABASE_URL` was never set in compose, so Alembic fell back to the default in `config.py` — `localhost:5432`, password `changeme`. Inside a container that fails with a connection error that looks like broken Docker networking and is nothing of the sort.

There are **two** database URLs on purpose. `codesage_app` is the role Row-Level Security applies to and it deliberately cannot create tables; migrations run as `codesage_owner`. Confirmed working: the migration created 27 tables, and the API connects as `codesage_app`.

**2. Only three of six containers could ever report "healthy".** `postgres`, `redis` and `web` had healthchecks; `api`, `ml` and `worker` had none, so they showed `running` forever. J0.3's success condition was literally unobservable. Added:

- `api` and `ml` — a one-line Python `urlopen`, because `python:3.12-slim` ships neither curl nor wget and adding one would be a whole layer to ask a question Python can ask itself.
- `worker` — `celery inspect ping`, because the worker serves no HTTP and has no port to poll. A green tick means it genuinely answered over the broker, not merely that the process has not exited.

`web`'s healthcheck stays in its Dockerfile, not here, because the api image serves **both** `api` and `worker` and they need different checks — a single image-level `HEALTHCHECK` would be wrong for one of them.

**3 and 4. Build contexts were enormous.** Docker sends the entire context to the daemon before the first instruction runs, so this was pure waiting on every build:

| | Before | After | What was in it |
|---|---|---|---|
| `apps/api` | 253 MB | 481 kB | `.venv` — a Windows virtualenv the Linux image never uses |
| `apps/ml` | 17 MB | 53 kB | training datasets the inference service never reads |
| `apps/web` | 2.0 GB on disk | 5 kB | `node_modules` + 1.3 GB of accumulated `.next` |

This is not tidiness. CI has no warm context and would have paid that transfer on **every pull request**.

### `/readyz` returns 500 — expected, not a defect

`GET /readyz` answers `Internal Server Error`. It is a stub: `routers/system.py` line 38 is `raise NotImplementedError`, and `/version` on line 44 is the same. The docstring describes what it will check one day; the body was never written.

Leave it alone:

- it is on `ops_router`, which `main.py` marks *"not in the contract"*;
- `/api/healthz` is the health endpoint the plan actually ticks (§5), and J1.7 checks that one;
- `apps/api/` is Chamodh's. Writing a real readiness probe is backend work.

> **⚠️ Carry this into J1.** Point Railway's healthcheck at **`/api/healthz`**, never `/readyz`. Railway would see 500 and refuse to route traffic to a container that is working perfectly.

`/api/healthz` and `/readyz` differ on purpose: `healthz` checks only that the process is alive, so a database blip cannot make an orchestrator restart a healthy API. That is why the compose healthcheck uses it.

### How to verify the containers really talk to each other

Since `/readyz` is a stub, prove it directly:

```powershell
docker compose exec api python -c "import redis,os; print(redis.Redis.from_url(os.environ['CODESAGE_REDIS_URL']).ping())"
docker compose exec api python -c "import urllib.request; print(urllib.request.urlopen('http://ml:8001/healthz').read())"
```

Verified 20 Aug 2026: `True` and `{"status":"ok"}`. Postgres needs no separate check — `alembic upgrade head` ran *from inside the api container*, which proves more than any probe.

End-to-end checks, all passing:

| Check | Result | Meaning |
|---|---|---|
| `GET :8000/api/healthz` | `{"status":"ok"}` | API alive |
| `GET :8000/api/projects` | **401** | auth is real, not decorative (same check as J1.8) |
| `GET :3000/` | 200 | frontend serves, redirects to `/projects` |

### Full runbook, from nothing

```powershell
cd infra
docker compose down -v --remove-orphans
docker compose build
docker compose up -d postgres redis      # wait for (healthy)
docker compose up -d api
docker compose exec api alembic upgrade head
docker compose up -d                     # allow ~90s: worker start_period is 45s
docker compose ps
```

---

## Entry 1 — 20 Aug 2026 — J0.1 and J0.2 (web image + API address)

**Plan reference:** [team-plan-to-mid-evaluation.md](team-plan-to-mid-evaluation.md) §6, Phase 0, steps J0.1 and J0.2.

**Status:** done and verified by actually building and running the image.

### Files changed

| File | New? | What it does now |
|---|---|---|
| `apps/web/Dockerfile` | new | Builds the frontend into a runnable container image |
| `apps/web/.dockerignore` | new | Lists what must **not** be sent into the build |
| `apps/web/next.config.ts` | edited | Added `output: "standalone"` |
| `infra/docker-compose.yml` | edited | Moved the API address from `environment:` to `build.args:` |

Nothing in `apps/api/` or `apps/ml/` was touched.

---

### The Dockerfile, in plain words

A Dockerfile is a recipe. Ours has four steps, and **only the last one ships**. The first three are scaffolding that gets thrown away, which is how the final image stays small.

| Stage | What happens | Ships? |
|---|---|---|
| `base` | Install Node and pnpm. Set registry timeouts. | no |
| `deps` | Copy *only* `package.json` + lockfiles, then `pnpm install`. | no |
| `builder` | Copy the source, run `pnpm run build`. | no |
| `runner` | Copy just the built output onto a clean Node image. | **yes** |

**Why `deps` is separate from `builder`.** Docker caches each step. Because `deps` only sees the lockfiles, editing a React component does not invalidate it — so you do not reinstall 831 packages to change a button colour. If install and build were one step, every edit would cost five minutes.

**Why `runner` starts from a fresh image.** The final image has no pnpm, no source code, no test tools, no dev dependencies. Less to download, and less that could be attacked. It runs as the `node` user, not root.

**What `output: "standalone"` does.** Normally `next start` needs the whole `node_modules` folder (~700 MB) sitting next to it. `standalone` tells Next to work out which files it *actually* imports and bundle them into `.next/standalone/server.js`. Final image: **285 MB instead of ~700 MB**. The command becomes plain `node server.js`.

One quirk worth knowing: standalone deliberately leaves out `.next/static` and `public/`, because Next assumes a CDN will serve them. We have no CDN, so the Dockerfile copies them back in by hand. If you ever see a deployed page load with no CSS, that is the line that broke.

---

### The important part: build time vs run time

This is the thing that was wrong, and the thing most likely to confuse someone later.

> **Anything starting with `NEXT_PUBLIC_` is frozen into the JavaScript when the image is built. Setting it when the container runs does nothing.**

Why: the browser runs that code, and the browser cannot read your server's environment variables. So Next.js does a find-and-replace during `next build`, swapping `process.env.NEXT_PUBLIC_API_BASE_URL` for a literal piece of text like `"http://localhost:8000"`. By the time a container starts, the address is already baked into a `.js` file that users download.

| Setting | Whose is it | Decided when | Set where |
|---|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | frontend | **build** | `build.args:` in compose / `--build-arg` |
| `NEXT_PUBLIC_API_MOCKING` | frontend | **build** | forced to `disabled` in the Dockerfile |
| `CODESAGE_DATABASE_URL` | backend | run | `environment:` in compose / Railway dashboard |
| `CODESAGE_ASGARDEO_*` | backend | run | `infra/.env` locally, Railway dashboard live |

Backend settings are read at run time because Python reads the environment while it is running. Frontend `NEXT_PUBLIC_*` settings cannot work that way. **Same-looking syntax, completely different mechanism.**

#### What was wrong

`infra/docker-compose.yml` had:

```yaml
web:
  environment:
    NEXT_PUBLIC_API_BASE_URL: http://localhost:8000   # did nothing
```

That line had no effect whatsoever. Deployed anywhere, the site still called `localhost:8000` — meaning the user's *own laptop*, where nothing is listening. Now:

```yaml
web:
  build:
    args:
      NEXT_PUBLIC_API_BASE_URL: ${CODESAGE_WEB_API_BASE_URL:-http://localhost:8000}
```

**Consequence to remember:** changing the API address now means **rebuilding the web image**, not restarting it. `docker compose build web`.

---

### How MSW, `localhost`, and the `.env` files fit together

Three different `.env` files exist and they are unrelated to each other. This trips people up.

| File | Read by | In git? | Purpose |
|---|---|---|---|
| `apps/web/.env.local` | `pnpm dev` on your laptop | no (gitignored) | Your personal frontend dev settings |
| `infra/.env` | `docker compose` | no (gitignored) | Asgardeo client id/secret |
| `apps/api/.env.example` | nobody — it is a checklist | yes | Lists every backend setting that must exist |

#### What MSW actually is

MSW = **Mock Service Worker**. A *service worker* is a small script the browser runs in the background that sits between the page and the network. It can see `fetch()` calls leaving the page and answer them itself, with fake data, without any server existing.

That file is `apps/web/public/mockServiceWorker.js`. The fake answers live in `apps/web/src/lib/mocks/`.

It is switched on by one line in `src/components/msw-provider.tsx`:

```ts
const on = process.env.NEXT_PUBLIC_API_MOCKING === "enabled"
```

So the whole fake backend is controlled by one string. `apps/web/.env.local` sets it to `enabled`, which is why the dashboard shows data on your laptop even when Chamodh's API is not running. That is the point of it — the frontend could be built before the backend answered.

#### The trap this created

Next.js reads `.env` files **during `next build`**. If `.env.local` had been copied into the Docker build, the production image would have been built with `NEXT_PUBLIC_API_MOCKING=enabled` — and the deployed site would have answered its own API calls with fake data.

It would have looked perfect. Green dashboard, data everywhere, nothing talking to the real backend. That is the worst kind of bug: one that demos beautifully and proves nothing.

Blocked in two places, deliberately:

1. `.dockerignore` excludes `.env*`, so the file never reaches the build.
2. The Dockerfile sets `NEXT_PUBLIC_API_MOCKING=disabled` explicitly, rather than trusting that it is absent.

#### Why sign-in is different from everything else

A service worker can intercept `fetch()`. It **cannot** intercept a full page navigation — a click that makes the browser leave the page entirely.

Sign-in is exactly that: OIDC needs the browser to physically travel to Asgardeo and come back. MSW can never touch it. This is why the sign-in button must be a plain `<a href>` link and never a `fetch` (that is step J2.6), and why sign-in hits the real backend even with mocking switched on.

#### Two different fallbacks in the code, on purpose

```ts
// src/lib/api/client.ts        — data calls
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? ""

// src/app/(auth)/login/page.tsx — sign-in
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"
```

Empty string means "same origin" — the request goes to the page's own address, so the service worker sees it and can fake it. The absolute address means "really go to the backend". Data calls are fakeable; sign-in is not.

#### A knock-on effect for later — worth knowing before J2.7

Once the image is built with a real address, the frontend and backend are on **different origins**. Every request becomes cross-origin, and browsers do not send cookies cross-origin unless you ask twice:

- the frontend must send `credentials: "include"` on every request (**J2.7**);
- the backend must list the frontend's address in `CODESAGE_CORS_ORIGINS` (already supported).

Miss either and every call returns 401 while looking correct in the code. This is the single most likely cause of "it worked locally".

---

### Problems hit while doing this

| Problem | Fix |
|---|---|
| Install died at package **828 of 831** on a registry timeout, throwing away 5½ minutes | Added a BuildKit cache mount for the pnpm store plus longer fetch timeouts, so a retry resumes instead of restarting |
| That cache mount broke `COPY`, because pnpm hardlinks out of its store and hardlinks do not survive being copied between stages | Set `npm_config_package_import_method=copy` |

**Note for CI (J0.5–J0.7):** pnpm 11 spent **5 min 19 s** on its supply-chain policy check *before downloading anything*. Budget for it, and cache the store with `actions/cache`.

---

### How to check this still works

```bash
# builds, and prints the address that got baked in
cd apps/web
docker build -t web-check .
docker run --rm --entrypoint sh web-check \
  -c 'grep -roh "http://localhost:8000" .next/static/chunks | head -1'

# prove the build argument works — should print the other address
docker build --build-arg NEXT_PUBLIC_API_BASE_URL=https://example.com -t web-check2 .
docker run --rm --entrypoint sh web-check2 \
  -c 'grep -roh "https://example.com" .next/static/chunks | head -1'
```

Verified on 20 Aug 2026: image builds, 285 MB, container reports `healthy`, runs as non-root, `/` redirects to `/projects` with 200, and the two builds above produce two different addresses.

---

### Is this the industry-standard way to set the API address?

**Yes — this is the approach Next.js documents itself**, and it is what their official Docker example does. It is a normal, defensible choice. But it is worth knowing there are three common approaches and why we are on this one.

| Approach | How | Trade-off |
|---|---|---|
| **1. Build argument** ← ours | Bake the address in at build time | Standard and simple. But the image is tied to one API address |
| **2. Relative URLs + reverse proxy** | Frontend calls `/api/...`; nginx or an ingress forwards it to the backend | Arguably the most common at scale. No address to bake, and **no CORS at all**. Needs a proxy in front |
| **3. Runtime config injection** | Serve a tiny `/config.js` the page reads on load | One image runs in every environment. More moving parts |

**Why option 1 is right for us:** we have no reverse proxy, and web and api are separate Railway services on separate addresses. Options 2 and 3 both solve a problem we do not have yet — several environments from one image.

**The honest caveat.** The plan's §5 slogan is *"build once, run anywhere"*. That is fully true of the `api`, `worker` and `ml` images: same image, settings supplied at run time. For `web` it is really *"build once **per API address**"*. With one deployment that costs nothing. If we later add a staging environment, that is the moment to move to option 2 — and it is a small change, not a rewrite.

Worth being able to say out loud at the evaluation, because "why is the frontend different?" is a fair question and the answer is a property of how browsers work, not a shortcut we took.

---

### Not done yet

J0.3 onwards: run all six containers together, then CI, image publishing, and branch protection.

*(J0.3 and J0.4 landed the same day — see Entry 2 above. Remaining: J0.5 CI, J0.6 build all three images in CI, J0.7 publish to GHCR, J0.8 branch protection.)*

---

# Reference — Docker Compose, explained

*Not a log entry: background for anyone who has never used Docker Compose. Everything here was checked against our actual running stack on 20 Aug 2026.*

### 1. The one idea

A **container** is one program in a sealed box. Compose runs several boxes at once and wires them together.

`infra/docker-compose.yml` is a description of six boxes. One command starts all six:

```powershell
docker compose up -d
```

Compose does three things for you:

1. **Builds or downloads** each image.
2. **Creates a private network** and puts every box on it.
3. **Starts them in the right order**, waiting where you told it to wait.

That is the whole thing. The rest is detail.

---

### 2. The private network — the part most people get wrong

When you run `docker compose up`, Compose creates a virtual network. Ours is called `codesage_default` (project name `codesage`, from `name:` at the top of the file).

**Every service is given a hostname equal to its service name.** So inside that network, `postgres` is a real address, like a tiny private internet.

#### The correction

> "Is it a port only the owner can access from outside?"

**No.** It is not about *who*. It is about *where from*.

- **Inside the network:** everything can reach everything. No restriction at all.
- **From your laptop:** you can only reach what has been explicitly **published**.

It's a wall, not a lock. Credentials don't help you cross it — there is nothing to connect to.

#### Proof, measured on our stack

Same five ports, tried from two places:

| Service | From your laptop | From another container |
|---|---|---|
| postgres :5432 | ❌ refused | ✅ reachable |
| redis :6379 | ❌ refused | ✅ reachable |
| ml :8001 | ❌ refused | ✅ reachable |
| **api :8000** | ✅ **reachable** | ✅ reachable |
| **web :3000** | ✅ **reachable** | ✅ reachable |

`api` and `web` are reachable from the laptop because they are the only two with a `ports:` line. That is the *only* difference.

#### Why deliberately

Your database holds everything. If port 5432 were open on a deployed machine, the entire internet could try passwords against it forever. Not publishing it means there is no door to knock on.

The compose file says this in a comment for a reason: *"An open database port is the single easiest thing to forget before a demo."*

---

### 3. `ports:` vs `EXPOSE` — read the arrow

You saw this in `docker compose ps`:

```
SERVICE    PORTS
api        0.0.0.0:8000->8000/tcp     ← published
web        0.0.0.0:3000->3000/tcp     ← published
ml         8001/tcp                   ← NOT published
postgres   5432/tcp                   ← NOT published
worker     8000/tcp                   ← NOT published
```

**The arrow `->` is what matters.**

| | Means | Effect |
|---|---|---|
| `8000/tcp` | `EXPOSE 8000` in a Dockerfile | **Documentation only.** Opens nothing |
| `0.0.0.0:8000->8000/tcp` | `ports:` in compose | Really opens a door on your machine |

`worker` shows `8000/tcp` only because it shares the API's Dockerfile, which has `EXPOSE 8000`. The worker serves no HTTP at all. Nothing is open.

#### Reading a `ports:` line

```yaml
ports:
  - "3000:3000"        # host:container
```

Left = port on your laptop. Right = port inside the container. They need not match — `"8080:3000"` would mean `localhost:8080` on your machine.

`0.0.0.0` means **every network interface**, so anyone on your Wi-Fi could reach it. Compare `docker-compose.dev.yml`:

```yaml
ports:
  - "127.0.0.1:5433:5432"
```

`127.0.0.1` means **this machine only**, not the network. That is the safer form, and why the dev override is written that way.

#### Getting into an unpublished container anyway

```powershell
docker compose exec postgres psql -U codesage_owner codesage
```

`exec` runs the command *inside* the box, so the network boundary never comes into it. This is how you inspect the database without opening a port.

---

### 4. Where do the values come from?

There are **three** sources, and mixing them up causes most confusion.

#### Source 1 — written literally in the file (committed to git)

```yaml
postgres:
  environment:
    POSTGRES_USER: codesage_owner
    POSTGRES_PASSWORD: devpassword
```

`devpassword` is **hardcoded in `docker-compose.yml`** and committed. It does not come from `.env`.

**Is that a security hole? No** — and it is worth knowing why:

- the database is not published, so nothing outside your laptop can use it;
- it is a throwaway database that `docker compose down -v` deletes;
- production never sees this file at all (see §7).

You will see `devpassword` and `dev-only-change-me`. Both are deliberate, both are local-only.

#### Source 2 — `${...}` substituted from `infra/.env`

```yaml
CODESAGE_ASGARDEO_CLIENT_SECRET: ${CODESAGE_ASGARDEO_CLIENT_SECRET:-}
```

`${NAME:-default}` means *"use `NAME` if it is set, otherwise the default"*.

Compose fills these in from `infra/.env` — the file next to the compose file. That file is **gitignored** because these are real credentials.

> ⚠️ **`infra/.env` is read by Compose itself, for `${...}` substitution only.** It is *not* handed to the containers. A value reaches a container only if a `${...}` in `environment:` puts it there. Two different things that both involve a file called `.env`.

**Rule of thumb:** real secret → `${...}` + `.env`. Fake local value → write it literally.

#### Source 3 — defaults in the code

If nothing sets a variable, `apps/api/src/codesage_api/config.py` has a fallback:

```python
database_url: str = "postgresql+psycopg://codesage_app:changeme@localhost:5432/codesage"
redis_url:    str = "redis://localhost:6379/0"
```

These exist so you can run the API **directly on your laptop**, outside Docker, without setting anything. They say `localhost` because that is where things are when nothing is containerised.

**Yes — these are the "if not provided" defaults, and they bite.** This is exactly the J0.4 bug: `CODESAGE_MIGRATION_DATABASE_URL` was not set in compose, so Alembic used the default, tried `localhost:5432` *from inside the container*, and failed. Inside a container `localhost` means **the container itself**, not your laptop.

#### Which wins

```
compose `environment:`   ← highest, always wins
        ↓
a .env file next to the running app   (not present in our images)
        ↓
the default in config.py   ← lowest, the "nobody told me" value
```

---

### 5. Reading that database URL

```
postgresql+psycopg://codesage_app:devpassword@postgres:5432/codesage
└────────┬────────┘   └────┬────┘ └────┬────┘ └───┬──┘ └┬─┘ └───┬──┘
      driver           username   password      host   port   database
```

| Piece | Meaning |
|---|---|
| `postgresql+psycopg` | Which database, and which Python driver. Not a real network scheme |
| `codesage_app` | The login role |
| `devpassword` | Its password — local only |
| **`postgres`** | **The hostname — this is the service name from the compose file** |
| `5432` | Port inside the private network |
| `codesage` | Which database on that server |

**`@postgres` is the key insight.** It is not a domain name that exists on the internet. Compose invented it. Type `postgres` into your browser and nothing happens; inside the network it resolves to the database container.

#### Why there are two URLs

```yaml
CODESAGE_DATABASE_URL:           ...codesage_app:...      # everyday use
CODESAGE_MIGRATION_DATABASE_URL: ...codesage_owner:...    # creating tables
```

Two roles on purpose:

| Role | Can | Why |
|---|---|---|
| `codesage_owner` | create and change tables | runs migrations |
| `codesage_app` | read and write rows only | **Row-Level Security is silently ignored for a table's owner.** If the app connected as the owner, tenant isolation would do nothing while appearing to work |

That is the single most important line in `infra/postgres/init/01-init.sql`.

#### "Are these mine?"

They are **the project's**, written once into the compose file and shared by everyone who clones the repo. Not personal, not generated for you. Every teammate's local stack uses the identical `devpassword`, and that is fine because it is a disposable local database.

Only two files are *yours* and never shared: `infra/.env` and `apps/web/.env.local`.

---

### 6. What each teammate has to do

Cloning the repo gives you `docker-compose.yml` with all the fake passwords already in it. You additionally need:

| File | Why | How |
|---|---|---|
| `infra/.env` | Asgardeo credentials — real secrets, gitignored | Copy from a teammate privately, or the Asgardeo console |
| `apps/web/.env.local` | Your frontend dev settings | Only needed for `pnpm dev`, not for Docker |

Everything else works from a clean clone. `apps/api/.env.example` is the checklist of every backend setting — it is committed precisely so nobody has to guess.

---

### 7. What actually happens in production

**The compose file is not used in production at all.** Railway, Neon and Upstash never read it. It is a local-development tool.

| Local | Production |
|---|---|
| `postgres` container, `devpassword` | **Neon** — managed Postgres, real password, TLS |
| `redis` container | **Upstash** — managed Redis |
| values in `docker-compose.yml` | values typed into the **Railway dashboard** |
| `docker compose up` | Railway pulls the published image and runs it |

The URLs keep the same shape but stop being local:

```
# local
postgresql+psycopg://codesage_app:devpassword@postgres:5432/codesage

# Neon
postgresql+psycopg://codesage_app:REAL_SECRET@ep-cool-name-123.eu-central-1.aws.neon.tech/codesage?sslmode=require
```

The host changes from an invented compose name to a real internet address, and `sslmode=require` appears because the traffic now crosses the public internet. Redis likewise becomes `rediss://` — **two s's**, meaning TLS.

**This is why the code never hardcodes any of it.** Every setting arrives from the environment, so the same image runs on your laptop and on Railway with nothing recompiled. That is the plan's §5 idea in one sentence.

> The exception is the frontend, for a reason specific to browsers — see Entry 1 of the log.

**Secrets in production live only in the Railway dashboard**, never in git. If you delete the Railway services you must retype them, which is why `apps/api/.env.example` must be kept accurate.

---

### 8. Commands worth knowing

Run these from `infra/`.

#### Daily

| Command | Does |
|---|---|
| `docker compose up -d` | Start everything, in the background |
| `docker compose ps` | What is running, and its health |
| `docker compose logs -f api` | Follow one service's output. **First thing to run when something breaks** |
| `docker compose down` | Stop and remove containers, **keep the data** |
| `docker compose restart api` | Restart one service |

#### After changing something

| You changed | Run |
|---|---|
| a `Dockerfile` or app source | `docker compose up -d --build` |
| `environment:` in compose | `docker compose up -d` (recreates it) |
| **`NEXT_PUBLIC_API_BASE_URL`** | `docker compose build web` — **a restart is not enough**, see log Entry 1 |

#### Digging in

| Command | Does |
|---|---|
| `docker compose exec api bash` | A shell inside the API container |
| `docker compose exec postgres psql -U codesage_owner codesage` | The database, without opening a port |
| `docker compose exec api alembic upgrade head` | Run migrations |
| `docker compose config` | Show the final file with every `${...}` filled in — **the fastest way to see what a variable actually became** |

#### Starting over

```powershell
docker compose down -v          # -v ALSO DELETES THE DATABASE
docker compose build
docker compose up -d
```

#### Flags

| Flag | Meaning |
|---|---|
| `-d` | Detached — run in the background and give you your prompt back |
| `-f <file>` | Use a specific compose file. Repeatable: later files override earlier ones |
| `-v` | **On `down` only: delete the volumes.** Your data is gone. Fine locally, never in production |
| `--build` | Rebuild images before starting |
| `-f` on `logs` | Follow — keep printing as new lines arrive |
| `--remove-orphans` | Delete containers from services no longer in the file |

Opening the database port for a moment, without editing the main file:

```powershell
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
```

Typing the second `-f` is the point — the default stays locked, and opening it is something you did deliberately and can see in your shell history.

---

### 9. Five things that will confuse you once

1. **`localhost` inside a container means the container**, not your laptop. Use the service name — `postgres`, not `localhost`.
2. **`EXPOSE` in a Dockerfile opens nothing.** Only `ports:` does. Look for the `->` arrow.
3. **`infra/.env` is read by Compose, not given to containers.** Only `${...}` in `environment:` puts a value into a container.
4. **`down -v` deletes your database.** Without `-v` the data survives.
5. **`NEXT_PUBLIC_*` needs a rebuild, not a restart.** It is baked into JavaScript at build time.
