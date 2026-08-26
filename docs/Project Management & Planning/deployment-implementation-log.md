# Deployment implementation log

*Janidu · infra, CI and Dockerfiles · newest entry first.*

A record of **what changed, why, and how to check it still works**. Running the project locally is
in the [root README](../../README.md) and [infra/README](../../infra/README.md); this file is about
what is *deployed*.

## What is live

| | |
|---|---|
| Site · API | `https://codesageai.dev` · `https://api.codesageai.dev` |
| Railway `codesageai/production` | `web`, `api`, `worker`, `ml` — Singapore |
| Database · Broker | Neon Postgres · Upstash Redis — both `ap-southeast-1` |
| Images | `ghcr.io/jpabasara/codesage-ai/{web,api,ml}` — built and published by CI on `main` |
| Spending cap | $15 |

---

## Entry 5 — 26 Aug 2026 — Phase 4: the rest of the deployment

Phase 1 deployed two of four containers and stopped at "images published". Phase 4 closed both gaps.

| Step | | Result |
|---|---|---|
| 1 | Branch protection (J0.8) | ✅ Six correctly-named required checks |
| 2 | CK jar into the image (J4.1) | ✅ Pinned, checksummed, smoke-tested at build |
| 3 | Deploy `worker` (J4.2) | ✅ `celery@… ready` on Upstash |
| 4 | Deploy `ml` (J4.3) | ✅ Reachable at `ml.railway.internal:8001` |
| 5 | Migrations on deploy (J4.4) | ✅ `alembic upgrade head` as `api`'s pre-deploy command |
| 6 | Auto-deploy on `main` (J4.5) | ✅ `deploy` job added to CI — **unproven until a merge exercises it** |
| 7 | Verify end to end (J4.6) | ❌ **A real Java scan on the live site has not been run** |

### Step 1 — the required checks were ambiguous

`main` was already protected — by a **ruleset**, `main-branch-protection-with-packages`, active
since 20 Aug with 1 required review and no bypass actors.

> ⚠️ `gh api repos/{owner}/{repo}/branches/main/protection` returns **404 Branch not protected** even
> when a ruleset is enforcing. That endpoint only sees *classic* protection. Rulesets are at
> `gh api repos/{owner}/{repo}/rulesets`. A 404 there is not evidence of anything.

The real defect: `images — build` was **one required name covering three matrix legs**, so a failing
`ml` image build could hide behind a passing `web` one. The name was also built from an expression
that appended `" and publish"` on `main`, so it differed between a pull request and `main`.

Fixed by making the job name static and unique — `images — ${{ matrix.name }}` — and requiring all
six checks. Because the rename PR itself produces the new names, requiring all six *while it is open*
is satisfied by its own run: one edit, no window where `main` is under-protected.

> **Two Windows encoding traps, both invisible until a PR hangs.**
>
> 1. `/tmp` is not shared between Git Bash and Windows Python — use `$LOCALAPPDATA/Temp`.
> 2. **`json.load(open(path))` decodes as cp1252 on Windows**, and every check name contains an em
>    dash. `—` is read as `â€"`, and writing it back stores a double-encoded name no job reports.
>    Printing it to a cp1252 console encodes it *straight back*, so it looks correct on screen while
>    being wrong in the API.
>
> Read with `encoding='utf-8'`, rebuild lists from literals, send as
> `json.dumps(body, ensure_ascii=True).encode('ascii')`, and **verify at the byte level**:
> `grep -c $'\xc3\xa2\xe2\x82\xac\xe2\x80\x9d'` should find nothing.
>
> Also: **`mergeStateStatus: BLOCKED` with every check green and the review in is not a stale cache.**
> It means a required name matches no reported check. Compare the two lists byte for byte.

### Step 2 — the published image could not run a scan

`apps/api/Dockerfile` did `COPY vendor/ /opt/ck/`, but `apps/api/vendor/*.jar` is gitignored — and
**CI checks out fresh**. So `/opt/ck/` was empty in every image ever published, and any scan died in
`ck_metrics.py` with `CK jar was not found`. `run_scan` catches that and writes phase `error` with
*"The repository could not be analysed."*, so the symptom was a scan failing for no stated reason.

The build was green throughout. Both CK tests are structurally blind: one `touch`es an empty file and
monkeypatches `subprocess.run`, the other asserts the wording of the missing-jar error. Neither reads
`settings.ck_jar` or looks at `/opt/ck/`.

```dockerfile
# syntax=docker/dockerfile:1.7      ← MUST be line 1, or --checksum is silently ignored

ENV CODESAGE_CK_JAR=/opt/ck/ck.jar
ADD --chmod=0644 --checksum=sha256:2ddfdc27…72c74d \
    https://repo1.maven.org/maven2/com/github/mauricioaniche/ck/0.7.0/ck-0.7.0-jar-with-dependencies.jar \
    /opt/ck/ck.jar

RUN java -jar "$CODESAGE_CK_JAR" 2>&1 | grep -q "^Usage java -jar ck.jar"
```

- **Maven Central, not GitHub** — `gh api repos/mauricioaniche/ck/releases` returns `[]`; the project
  publishes tags but no release assets, so the old README pointed at an empty page.
- **The smoke test cannot use the exit code** — CK with no arguments prints usage and **exits 1**.
  `grep` is the assertion, and it proves the JRE can *execute* the jar.
- **`--chmod=0644`** — `ADD` defaults to 0600 root-only. No `USER` here today, but `web` already runs
  non-root, and the day someone hardens this one a 0600 jar breaks every scan.

Verified in the built image: 16,052,728 bytes, digest matches, CK runs, `vendor/README.md` no longer
leaks in — **and a deliberately zeroed digest fails the build** (`digest mismatch`). An unverified pin
is decoration.

> Still owed: `AnalysisEngineVersion.ck_version = "0.7.0"`, matching the pin. Without it REL-10's
> *"same revision, consistent results"* is unverifiable across a CK bump. **Chamodh**, one field.

### `main` could not migrate at all

Found while verifying Step 2. PR #83 and PR #81 each added a migration numbered `20260825_0002`.
Both green, neither conflicting — they are *different files*, and git does not read revision ids.
Merged together they left two heads and a duplicate id, so `alembic upgrade head` refused to run.
`main` had been un-migratable since 25 Aug.

Renumbered into a line, keeping `membership_definer_lookup` at `0002` because it is the live sign-in
fix and so most likely already applied to Neon — renumbering an *applied* revision leaves
`alembic_version` pointing at an id no file declares:

```
0001 complete_erd → 0002 membership_definer_lookup → 0003 seed_security_rules → 0004 repository_metadata
```

**CI now fails on more than one head** (`api` job, after Install). `alembic heads` opens no database
connection. Both failure modes were reproduced against the guard before trusting it — same
`down_revision` gives 2 lines; same revision id gives 2 lines *and* `present more than once`.

#### It also un-skipped the six RLS tests

`test_rls.py` builds its schema by running the real migrations, so two heads made the fixture give up
and the whole module skipped — the tests proving tenant isolation had been reporting green while
checking nothing, exactly as Entry 3 warned. Running them surfaced two real defects:

| | |
|---|---|
| `NotNullViolation` on `theme_preference` | `nullable=False` with an **ORM-level** `default=`, not a `server_default` — so SQLAlchemy fills it only for ORM inserts, and this test uses raw SQL |
| `permission denied for function app_workspace_for_user` | The migration revokes EXECUTE from PUBLIC and grants it to `codesage_app`; the fixture connects as a *different* role. Fixed with role **membership**, so it inherits whatever the migration grants instead of keeping a copy that drifts |

**8 passing**, genuinely running.

> A `NOT NULL` column whose only default lives on the mapping is a trap for every raw statement.
> `server_default=text("'system'")` would close it at the database. **Chamodh's call** — it changes
> the schema.

### Step 3 — `worker`

Same image as `api`, different command. No domain, no port, no health check, no volume.

| Setting | Value |
|---|---|
| Start command | `celery -A codesage_api.worker worker --loglevel=INFO --concurrency=1` |
| Memory | 1 GB — a clone plus CK plus PyDriller is not small, and Railway kills a container that exceeds its limit |
| Variables | `CODESAGE_DATABASE_URL` (pooled), `CODESAGE_REDIS_URL` (`rediss://…?ssl_cert_reqs=required`), `CODESAGE_ML_SERVICE_URL`, `CODESAGE_ML_TIMEOUT_SECONDS`, `CODESAGE_LOG_LEVEL` |

- **Do not set `CODESAGE_CLONE_DIR` or `CODESAGE_CK_JAR`** — both are `ENV` in the image; a second
  place to get them wrong.
- **`CODESAGE_GITHUB_TOKEN` belongs on `api`, not the worker.** Only `services/repositories.py` and
  `services/analysis.py` call the GitHub REST API; nothing under `tasks/` imports
  `integrations.github`. The worker clones over plain `git`, unauthenticated.
- **Concurrency stays 1.** Three concurrent scans is a *replica count*, not a concurrency number —
  three clones in one container's disk is a different thing.

### Step 5 — migrations on deploy, and the live 500 that forced it

**Promoted ahead of Step 4, because the outage it prevents had already happened.**

Minutes after `worker` went live, the signed-in Projects page showed *"Failed to fetch"* with a CORS
error. Neither a CORS fault nor the redeploy that had just happened — both were guessed first, both
wrong. The Network tab had what the console did not:

```
Status Code: 500 · content-type: text/plain · content-length: 21
```

21 bytes of `text/plain` is `Internal Server Error` — Starlette's `ServerErrorMiddleware`, which sits
**outside** `CORSMiddleware`, so its response carries no `Access-Control-Allow-Origin`.
`errors.py::_not_built_yet` documents this exact trap.

**Cause: the deployed code was ahead of the deployed schema.** `list_projects` orders by
`repository.created_at`, added in `20260825_0004`, and Neon was still on an earlier revision —
migrations had only ever been run by hand, last during Phase 1. Merging a migration and the live
database having it were unrelated events.

Fixed by `alembic upgrade head` against Neon's **direct** endpoint as the owner; no redeploy needed.
Then wired permanently:

| Railway `api` service | |
|---|---|
| Pre-deploy Command | `alembic upgrade head` |
| New variable | `CODESAGE_MIGRATION_DATABASE_URL` — direct endpoint, owner role |

Not on `worker`: same image, but two services racing the same migration is a lock fight.

> **The pattern, now three times over** (Entry 4's 401, the ruleset block, this):
> **a browser says "CORS" whenever a cross-origin request fails for *any* reason** — including the
> server erroring from outside the CORS middleware, or not answering at all. CORS stops the browser
> *reading* a response; it does not stop the response existing.
>
> ```bash
> curl -s -D - -o /dev/null -H "Origin: https://codesageai.dev" \
>   https://api.codesageai.dev/api/projects | grep -i "access-control"
> ```
>
> Header present → CORS is fine, look behind it. Absent → then it is real.

### Step 4 — `ml`

| Setting | Value |
|---|---|
| Image · Port | `ghcr.io/jpabasara/codesage-ai/ml:latest` · `8001` |
| **Start command** | `uvicorn codesage_ml.main:app --host :: --port 8001` |
| Public domain · Variables | none · none |

⚠️ **The start-command override is the whole trick.** Railway's private network is **IPv6**; the
image's `CMD` binds `--host 0.0.0.0`, so the service would start, look perfect, and refuse every call
from the worker. Railway's docs don't say this for Python, but their MongoDB example is
`--bind_ip ::,0.0.0.0` and their Go guidance is to listen "on IPv6 as well as IPv4".

**Why this is a Railway setting and not a Dockerfile change — measured.** Changing `CMD` to
`--host ::` would be tidier, and it breaks the local stack:

```
INFO: Uvicorn running on http://[::]:8001      ← binds fine
# from another container on the compose network:
urllib.error.URLError: <urlopen error [Errno 111] Connection refused>
```

**Refused**, not "name not known" — DNS resolved, the port was closed to IPv4. A `::` socket accepts
IPv4-mapped connections only when `net.ipv6.bindv6only=0`, which does not hold on Docker's default
bridge. So `::` is right on Railway and wrong in Compose. The Dockerfile stays IPv4; the IPv6
requirement lives on the one platform that has it.

> If a deploy fails its health check while the log shows `Uvicorn running on http://[::]:8001`, that
> is the same split — remove the health check rather than changing the bind. `ml` serves no public
> traffic, and the worker's call is the check that matters.

**What deploying `ml` does and does not buy.** `/healthz` and `/version` answer. `/classify` falls
back to a **keyword matcher** because `models/` is empty in the image, and `/risk` returns
deterministic pseudo-random numbers. **And nothing calls it** — `scan_pipeline.py` imports only the
rule engine; `detection/satd/client.py` is written but unimported, `detection/risk/client.py` is
`NotImplementedError`.

So a 200 from `/classify` does not mean the trained model is deployed — read `model_version`, not the
status code. It is still worth deploying: it is one of four containers in the SAD's deployment view,
it proves the published image runs off a laptop, and the address is correct for whenever stage 3 is
wired in.

> Also for Chamodh: `detection/satd/client.py` calls `httpx.post(..., timeout=30.0)` — a hardcoded
> literal. It never reads `settings.ml_timeout_seconds`, so the variable does nothing for the one
> call it was added for.

### Step 6 — auto-deploy on `main`

**Not** by pointing Railway at the repository — that makes Railway build the code itself, discarding
the images CI tested, so what runs is not what passed. §5 of the team plan is that the artefact CI
built is the artefact that runs.

So CI publishes, then tells Railway to pull: a `deploy` job gated on `push` to `main`, `needs:
[images]`, using a Railway **project token** in `secrets.RAILWAY_TOKEN`. `api` deploys first and
alone, because its pre-deploy command migrates the schema and a failure there must stop everything
below.

⚠️ **Two things to verify on the first automatic deploy**, because neither is proven yet:

1. **`railway redeploy --service <name> --yes` is the right invocation.** Run `railway redeploy
   --help` once rather than debugging through five pushes to `main`.
2. **The redeploy actually re-pulls.** Services are pinned to `:latest`, which *should* re-resolve to
   the new digest. Confirm the `api` deployment log shows a **different digest** than the previous
   one. If not, pin to the immutable tag — CI already publishes `sha-<commit>`.

### Still outstanding

| | Whose |
|---|---|
| **Step 7 — a real Java scan on the live site.** The only thing that proves the CK work landed | Janidu |
| Rotate the Neon passwords pasted into a chat transcript on 26 Aug (second occurrence) | Janidu |
| Profiles endpoints ×3 → **501**; the Profiles screen works only against MSW | Chamodh |
| `/readyz`, `/version` → **501** | Chamodh |
| ML-1 and ML-2 not wired into the scan pipeline | Chamodh |
| No trained artifact in the `ml` image | Nathasha |
| Playwright never runs in CI — the `web` job is vitest only | Janidu |
| `ruff` advisory on `apps/api` (31 findings) | Chamodh |

---

## Entry 4 — 20–21 Aug 2026 — Phase 1: first deploy

Sign-in completes on the live site, a user row exists in Neon, the browser lands on `/projects`.

### Buying `codesageai.dev` shaped the whole phase

**It removed a bug we would otherwise have had to fix in code.** Every `*.up.railway.app` address is
a separate *site* to a browser, because that suffix is on the public suffix list. Our session cookie
is `SameSite=Lax`, so a frontend on one Railway address would never have sent it to a backend on
another — sign-in would succeed and every request after would 401. `codesageai.dev` and
`api.codesageai.dev` are the same site, so `Lax` works and `routers/auth.py` needs no change.

**And it let the web image be built once, correctly** — the API address is frozen in at build time, so
without a domain we would have deployed, waited for Railway to invent an address, rebuilt, redeployed.

Railway's **Hobby plan is required**: Trial allows 1 custom domain in total; we need two.

### Three faults, one symptom

Each produced a deployment that fails its health check while the service still shows Online and
`/api/healthz` still returns 200.

| Last line of the traceback | Cause | Fix |
|---|---|---|
| `invalid channel_binding value: "('requiresslmode=require', 'require')"` | the `&` between query parameters was lost | end the URL at `?sslmode=require` |
| `ModuleNotFoundError: No module named 'psycopg2'` | URL began `postgresql://`, so SQLAlchemy loaded its default driver; the image ships psycopg **3** | prefix must be `postgresql+psycopg://` |
| `SettingsError: error parsing value for field "cors_origins"` | written as plain text | must be JSON: `["https://codesageai.dev"]` |

Fault 1 starts fine and fails on the first query. Faults 2 and 3 kill the process at **import**,
before uvicorn binds a port — which is why the health check can never pass.

> **A failed deployment leaves the previous container serving.** So "the URL still returns 200" proves
> the *old* build is alive and says nothing about your change. **Trust the deployment badge, not the
> URL.**
>
> And `/api/healthz` never touches the database, deliberately — so **signing in is the first request
> that opens a database connection**, and every database misconfiguration stays invisible until then.

### Smaller findings

- TXT verification records need their leading underscore (`_railway-verify.api`).
- **"TCP Proxy" is not "Generate Domain"** — a TCP proxy publishes a raw unencrypted `host:port`.
- **Attach custom domains with an explicit port** — `api` → 8000, `web` → 3000. Otherwise the
  generated `*.up.railway.app` address works while the custom domain returns **502**.
- **`web` needs `PORT=3000`** — the one runtime variable that image reads. Railway injects a `PORT` of
  its own and Next reads it at startup; without this the container listens on Railway's port while the
  domain routes to 3000.
- Append `?ssl_cert_reqs=required` to `CODESAGE_REDIS_URL` or Celery warns and skips certificate checking.
- `Failed to find Server Action "0000…"` in the web logs is a browser holding a page from the previous
  deployment. Harmless.
- **Do not enable Serverless / App Sleeping before the evaluation** — the first request then takes
  seconds to wake, which reads as "the site is broken".
- The `neondb_owner` password was pasted into a chat transcript. **Rotated 21 Aug.** *(It happened
  again on 26 Aug — rotate both roles.)*

### Stopping a service without destroying it

Service → **Deployments** → ⋮ on the active deployment → **Remove**. Compute billing stops;
variables, domains, ports and settings survive. **Never delete the *service*** — that takes the
domains and variables with it. Restart with **Redeploy** on the existing deployment.

---

## Entry 3 — 20 Aug 2026 — CI (J0.5–J0.7)

One job per folder, so a red tick names its owner without anyone reading a log: `web` → Janidu,
`api` → Chamodh, `ml` → Nathasha, `images` → Janidu.

**Order is deliberate.** Contract check first — `docs/api/openapi.yaml` is the one file all three of
us share, and ten seconds beats three minutes of tests. Layer check second: `lint-imports` checks the
*shape* of the code (scoring stays pure, workers never score), which a human reading one file cannot
see. Tests last, because they are slowest.

**Build on every pull request; publish only on `main`.** Building answers *"does this still compile on
a clean machine?"*; uploading is only useful once merged. There is also no choice — a fork PR gets a
read-only token.

### Verified on a clean Linux machine, not just a laptop

Exported the repo fresh into an empty `python:3.12-slim` container and ran the exact CI commands.

> My first attempt failed, and the mistake was mine: I exported only `apps/api`, and one of its tests
> reads `docs/api/openapi.yaml` from the repository root. **Remember this if anyone proposes making
> jobs "only run when their folder changes"** — a change to the contract alone must still run the
> `api` job. We do not filter. Leave it that way.

### Three things CI does not check, deliberately

1. **Ruff does not fail the build.** 31 pre-existing findings, all in `apps/api`. Fixing them means
   editing 18 of Chamodh's files mid-flight; turning it on anyway means a pipeline red from day one,
   which can never be required by branch protection. `ruff check --fix .` clears 26 of them; then drop
   `--exit-zero`.
2. **Prettier is not checked** — 97 files fail, and that is one huge whitespace commit.
3. **Mypy is not checked** — misconfigured, refuses to start.

### Where the images go

```
ghcr.io/jpabasara/codesage-ai/{web,api,ml}     tags: latest, sha-<commit>
```

The commit-id tag is what lets you deploy or roll back to a *specific* version. Small trap avoided:
the repository is `JPabasara/CodeSage-AI` but GHCR rejects capitals — `docker/metadata-action`
lowercases it; writing the name by hand fails. Packages published by Actions default to **private**.

> ⚠️ **The `web` image has the API address baked inside it** — frozen at build time, not read at
> startup. The repository variable `WEB_API_BASE_URL` (Settings → Secrets and variables → Actions →
> Variables) is what the build reads. Setting it in Railway does nothing; by then it is too late.

---

## Entry 2 — 20 Aug 2026 — the whole stack up (J0.3, J0.4)

Six containers healthy at the same time, for the first time.

| What was wrong | Fix |
|---|---|
| **Migrations could not run.** `CODESAGE_MIGRATION_DATABASE_URL` was never set in compose, so Alembic fell back to `localhost:5432` / `changeme` — which inside a container fails with an error that looks like broken Docker networking and is nothing of the sort | Set it. Two URLs and two roles on purpose: RLS is ignored for a table's owner |
| **Only three of six containers could ever report healthy.** `api`, `ml`, `worker` had no health check, so J0.3's success condition was literally unobservable | `api`/`ml`: a one-line Python `urlopen` (the slim image ships neither curl nor wget). `worker`: `celery inspect ping` — it serves no HTTP, and a green tick means it genuinely answered over the broker |
| **Build contexts were enormous** — Docker sends the whole context before the first instruction | `.dockerignore`: `apps/api` 253 MB → 481 kB (a Windows `.venv` the Linux image never uses), `apps/ml` 17 MB → 53 kB (training datasets), `apps/web` 2.0 GB → 5 kB |

> ⚠️ **Point Railway's health check at `/api/healthz`, never `/readyz`.** `/readyz` is an unfinished
> stub. The two differ on purpose: `healthz` checks only that the process is alive, so a database blip
> cannot make an orchestrator restart a healthy API.

---

## Entry 1 — 20 Aug 2026 — the web image (J0.1, J0.2)

Four-stage Dockerfile; **only the last stage ships**. `output: "standalone"` makes Next bundle just
the files it actually imports — **285 MB instead of ~700 MB** — and the command becomes plain
`node server.js`. One quirk: standalone leaves out `.next/static` and `public/` because it assumes a
CDN, so the Dockerfile copies them back by hand. *If a deployed page ever loads with no CSS, that is
the line that broke.*

### The important part: build time vs run time

> **Anything starting with `NEXT_PUBLIC_` is frozen into the JavaScript when the image is built.
> Setting it when the container runs does nothing.**

The browser runs that code, and the browser cannot read your server's environment — so Next does a
find-and-replace during `next build`.

| Setting | Decided when | Set where |
|---|---|---|
| `NEXT_PUBLIC_*` | **build** | `build.args:` / `--build-arg` |
| `CODESAGE_*` | run | `environment:` / the Railway dashboard |

It sat in compose as `environment:` until 20 Aug and did nothing at all — deployed anywhere, the site
still called `localhost:8000`, meaning the user's *own laptop*.

### The MSW trap this created

Next reads `.env` files **during `next build`**. If `.env.local` reached the Docker build, the
production image would be built with `NEXT_PUBLIC_API_MOCKING=enabled` — and the deployed site would
answer its own API calls with fake data. **It would look perfect. Green dashboard, data everywhere,
nothing talking to the real backend.** Blocked twice over: `.dockerignore` excludes `.env*`, and the
Dockerfile sets `NEXT_PUBLIC_API_MOCKING=disabled` explicitly rather than trusting it is absent.

### Is baking the address in the industry-standard way?

Yes — it is what Next.js documents and what their official Docker example does. There are three
approaches: **build argument** (ours), **relative URLs behind a reverse proxy** (no CORS at all, but
needs a proxy), and **runtime config injection** (one image everywhere, more moving parts).

**The honest caveat:** §5's "build once, run anywhere" is fully true of `api`, `worker` and `ml`. For
`web` it is really *"build once **per API address**"*. With one deployment that costs nothing; if we
add staging, that is the moment to move to a reverse proxy. Worth being able to say out loud, because
"why is the frontend different?" is a fair question and the answer is a property of browsers.

---

# Reference — what cannot be tested locally

Running the three modes is in the [root README](../../README.md). This is the part specific to being
deployed.

### Not testable locally because the *environment* differs

| What | Why it is invisible locally | Where it bit us |
|---|---|---|
| The **`Secure`** cookie flag | plain http cannot carry one, so compose sets `false` | — |
| **Cookie domain across two hosts** | `web` and `api` are both `localhost`; live they need `.codesageai.dev` or `middleware.ts` bounces every signed-in visitor to `/login` | commit `ff27d8e` |
| **CORS between real origins** | same reason — `credentials: "include"` only matters when origins genuinely differ | J2.7 |
| **HTTPS, certificates, DNS, the apex CNAME** | no TLS locally | the `_railway-verify` TXT record |
| **Custom-domain port mapping** | compose publishes ports directly | 502 on the custom domain |
| **Neon** pooled vs direct, `sslmode`, `channel_binding` | local Postgres is one plain container | Entry 4, faults 1 and 2 |
| **Upstash** `rediss://` TLS | local Redis is plain | Entry 4 |
| **Railway's IPv6 private network** | compose's network is IPv4, so `0.0.0.0` works locally and fails there | Entry 5, Step 4 |
| **The published image itself** | compose *builds* from your working tree; Railway *pulls* what CI built — a gitignored file exists for you and not for CI | Entry 5, the CK jar |

> Most of these share one shape: **something that is a single thing locally becomes two things in
> production.** One host becomes two hosts. One database container becomes a pooler and a direct
> endpoint. Your working tree becomes a git checkout.

### Testable locally, and easy to assume otherwise

Row-Level Security and tenant isolation · the worker end to end · migrations from nothing
(`down -v` then up is a truer test than Neon, which is never empty) · a real Asgardeo sign-in against
`localhost:8000`, provided that callback is registered in the console.

---

# Reference — local vs production

**The compose file is not used in production at all.**

| Local | Production |
|---|---|
| `postgres` container, `devpassword` | **Neon** — managed Postgres, real password, TLS |
| `redis` container | **Upstash** — managed Redis, `rediss://` |
| values in `docker-compose.yml` | values in the **Railway dashboard** |
| `docker compose up` | Railway pulls the published image and runs it |

The URLs keep their shape but stop being local:

```
# local
postgresql+psycopg://codesage_app:devpassword@postgres:5432/codesage
# Neon
postgresql+psycopg://codesage_app:SECRET@ep-xxxx-pooler.region.aws.neon.tech/neondb?sslmode=require
```

The host changes from an invented compose name to a real address, and `sslmode=require` appears
because the traffic now crosses the public internet.

**This is why the code never hardcodes any of it** — every setting arrives from the environment, so
the same image runs on a laptop and on Railway with nothing recompiled. The exception is the frontend,
for a reason specific to browsers (Entry 1).

**Secrets in production live only in the Railway dashboard**, never in git. If you delete the
services you must retype them — which is why `apps/api/.env.example` must be kept accurate.
