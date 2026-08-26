# CodeSage-AI

The Lightweight Technical-Debt & Analytics Dashboard — an AI-assisted tool that
scores a repository's code health, ranks the highest-value refactors first, and
shows it all on a heat-map dashboard.

## Repository layout

```
apps/
├── web/     # Next.js frontend (App Router + shadcn). Runs on a mock backend today.
├── api/     # FastAPI + Celery — the API process and the scan worker (one image, two commands)
└── ml/      # ML inference service (:8001) + offline training code for ML-1 and ML-2
infra/
└── docker-compose.yml          # the six-container local stack
docs/
├── api/openapi.yaml            # the REST contract. Frontend types are generated from it
├── Deliverables/               # SRS and SAD — .docx is the deliverable, .md is a generated mirror
├── Diagrams/UMLs/              # draw.io sources for every figure in the SAD
├── Change Requests/            # accepted changes to the deliverables, with rationale
│   └── CR-001_2026-07-30_scoring-model-and-finding-ux.md
├── Progress Evaluations/       # viva / progress-review preparation, one file per review
├── Templates/                  # the blank course templates (inputs only)
├── tools/                      # the scripts that build the deliverables — see its README
└── Project Management & Planning/
    ├── work-plan-and-locked-decisions-after-progress-eval.md  # ← start here: the work order and the locked decisions
    ├── frontend_build_stepbystep.md   # the execution recipe (phase by phase)
    ├── frontend_prototype_plan.md     # architecture & design decisions
    ├── code-sage_backend-analysis-engine.md
    ├── data-model-decisions.md        # DB / multi-tenancy / RLS decisions
    └── release-roadmap.md
```

> **Change Requests.** Once a deliverable is written, a decision that contradicts it is
> recorded rather than silently edited in — as a CR, or as a revision-history row in the
> deliverable itself. Each records the problem, the decision and the *why*, so a reader
> six months later can tell a considered change from a drifting document.

> **Start here:** [the work plan and locked decisions](docs/Project%20Management%20&%20Planning/work-plan-and-locked-decisions-after-progress-eval.md) carries the decisions that are
> locked and the order of work. Read it before changing anything — several decisions
> were reversed after the deliverables were written.

> **The contract generates the frontend's types.** `apps/web/src/lib/types/api.ts` is
> produced from [`docs/api/openapi.yaml`](docs/api/openapi.yaml) by `pnpm gen:types`
> and must never be hand-edited. `pnpm gen:types:check` regenerates in memory and
> compares, so it exits 1 the moment the contract and the generated file drift apart.
> Edit the contract, regenerate, commit both together. Not wired into CI yet — this
> repo has no CI pipeline, so it is a command someone has to run.

## Architecture

**A modular monolith with an asynchronous worker and one extracted inference service.**
Not microservices — the boundaries are drawn around *workload*, not around *domain*.

```
browser ──HTTPS──▶  api :8000  ──▶ postgres        worker ──HTTP──▶ ml :8001
   │                    │                             │                 │
   │                    └──▶ redis ──enqueue──────────┘            /models (mounted)
   └── httpOnly session cookie
```

Six containers, but two are infrastructure (`postgres`, `redis`), one is the frontend
(`web`), and **`api` and `worker` are the same image with a different command**. One
codebase, one schema, one bounded context.

| Style | Where it shows up |
|---|---|
| **Modular monolith** | `apps/api` — module boundaries enforced by import-linter contracts in CI, not by network calls |
| **Layered** | presentation → application/domain → data; dependencies point one way |
| **Pipe and filter** | the scan pipeline: `clone → extract → detect → finalize`, with the cancel check *between* stages |
| **Competing consumers** | API produces one job to Redis; N workers compete. `--scale worker=3` meets PERF-07 with no code change |
| **Write path / read path split** | the worker stores **facts**; the API derives **scores** on every read. This is what lets a profile change re-rank findings with no re-scan |
| **Functional core** | `ScoringEngine` is a pure function — and an import contract makes it stay one |

**Why not microservices.** One bounded context; snapshot finalization must be a single
database transaction (a saga would have to invent a rollback for "half a snapshot",
which FR-6 forbids); Row-Level Security needs one database to key tenant isolation on;
and a dashboard read joins everything at once. Microservices would add failure modes
and coordination cost without adding capability at this size.

**Where `apps/ml` fits.** It is a stateless inference service — no database, no domain,
model artifacts *mounted* rather than baked into the image so swapping a model is a
restart, not a rebuild. It is extracted so that "ML unavailable" is a **degraded mode**
the scan can handle rather than an exception that kills it. Training lives in
`apps/ml/training/` and is never deployed.

## Security

The API is the **Backend-for-Frontend**. Sign-in runs through
[Asgardeo](https://wso2.com/asgardeo/), which federates GitHub, and the exchange
happens server-side:

- the authorization-code exchange (with PKCE) is performed by `apps/api`, never by the browser
- identity tokens stay in the backend — the browser receives only an **httpOnly, Secure,
  SameSite=Lax** cookie holding an opaque session id
- sessions are **server-side rows**, so signing out revokes access on the next request
- every endpoint requires a session except sign-in start, sign-in callback and `/healthz`

Adding Google or a username-and-password login later is a setting in the Asgardeo
console, not new code — which matters because v2 brings viewers and stakeholders who
may not have GitHub accounts. Details: SRS §3.5 (SEC-17 to SEC-20) and SAD §6.4.

## Running it locally

There are three ways to run this, and **they are not interchangeable**. Pick by what you
are trying to do:

| You want to… | Use | Mocking |
|---|---|---|
| Work on a screen, a layout, the scan flow | **`pnpm dev`** with mocking **on** | MSW answers everything |
| Test sign-in, sign-out, or a real endpoint | **`pnpm dev`** with mocking **off**, plus the backend in Docker | Real API |
| Check the whole system as it deploys | **Docker Compose**, all six containers | Always off — see below |

### The one thing that catches everyone

`NEXT_PUBLIC_*` variables are **baked into the JavaScript at build time**, not read when
the container starts. Next.js textually replaces every `process.env.NEXT_PUBLIC_*` with a
string literal during `next build`. So:

* in `pnpm dev`, editing `apps/web/.env.local` and restarting is enough;
* in Docker, the value is already inside the image — changing it means
  **`docker compose build web`**, not `docker compose restart web`.

This was a real bug: the address sat in compose as `environment:` until 20 Aug 2026 and did
nothing at all — every deployed image still pointed at `localhost:8000`.

### 1 · Frontend only, mock backend (fastest loop)

No database, no Python, no Docker. MSW intercepts every call in the browser.

```powershell
cd apps/web
pnpm install
pnpm dev            # http://localhost:3000
```

`apps/web/.env.local` (gitignored — each teammate makes their own):

```ini
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_API_MOCKING=enabled
NEXT_PUBLIC_SESSION_COOKIE_NAME=codesage_session
```

> ⚠️ **You will land on `/login` and be unable to leave — and MSW cannot help.** Since J3.3,
> `src/middleware.ts` redirects any visitor without a session cookie. Middleware runs on the
> **server, before the page is sent**; a service worker lives in the browser and cannot intercept
> it. Measured: `GET /projects` → `307 → /login`; with `Cookie: codesage_session=fake` → `200`.
>
> **To work offline with no backend at all:** set `NEXT_PUBLIC_API_MOCKING=e2e` (this also mocks
> `/api/auth/session`) and add a cookie by hand in DevTools → Application → Cookies →
> `http://localhost:3000`, named `codesage_session`, any value. The cookie is `httpOnly`, so the
> middleware can only check that it *exists* — a seeded one is exactly what it sees after a real
> sign-in. This is what Playwright does; see `apps/web/e2e/session.ts`.
>
> Full detail, including what each mode can and cannot prove:
> **[the three ways to run it](docs/Project%20Management%20&%20Planning/deployment-implementation-log.md#reference--the-three-ways-to-run-it-and-what-each-one-can-prove)**.

**Sign-in and sign-out always go to the real API even with mocking on.** OIDC is a
navigation — the browser physically leaves the page — and a service worker cannot intercept
that. MSW passes through anything it has no handler for, so `/api/auth/*` reaches the backend
either way. That is deliberate: it means you can test sign-in without giving up the mock data.

### 2 · Real backend, frontend in dev (for auth and endpoint work)

Backend in Docker, frontend on your machine so hot reload still works.

```powershell
cd infra
docker compose up -d postgres redis ml api worker
```

Then flip the flag in `apps/web/.env.local` and restart `pnpm dev`:

```ini
NEXT_PUBLIC_API_MOCKING=disabled
```

> **Updated 26 Aug 2026 — most endpoints are real now.** `/api/projects`, `/api/repos/*`
> (branches, health, scans) and `/api/auth/*` all do real work. **Three still answer 501** —
> `GET /api/profiles`, `GET /api/profiles/active`, `PUT /api/profiles/active` — so the Profiles
> screen works only in mode 1. `/readyz` and `/version` answer **501**; they are unfinished stubs
> and the health endpoint is `/api/healthz`.
>
> **Scans work as of 26 Aug 2026** — the Dockerfile fetches and verifies the CK jar itself, so
> `docker compose build api` is all you need.
> And scan a **Java** repository: v1.0 analyses Java only.

Sign-in needs `http://localhost:8000/api/auth/callback` registered in the Asgardeo console,
and `infra/.env` filled in — see the compose file's sign-in block.

### 3 · The whole stack in Docker (closest to deployed)

```powershell
cd infra
docker compose up -d                   # postgres · redis · ml · api · worker · web
docker compose up --scale worker=3     # three concurrent scans (PERF-07)
```

`web` is on <http://localhost:3000>, `api` on <http://localhost:8000>. Postgres, Redis and
`ml` stay on the private network and are **not** published — reach them through the
containers:

```powershell
docker compose exec postgres psql -U codesage_owner codesage
docker compose exec api python -c "import urllib.request; print(urllib.request.urlopen('http://ml:8001/healthz').read())"
```

**Mocking is always off here.** `apps/web/Dockerfile` hardcodes
`ENV NEXT_PUBLIC_API_MOCKING=disabled`, so the image never ships the fake backend — there is
no flag to flip. If you want mock data, use mode 1.

To point the image somewhere other than localhost, set the build argument and rebuild:

```powershell
$env:CODESAGE_WEB_API_BASE_URL = "https://api.codesageai.dev"
docker compose build web
docker compose up -d web
```

See **[apps/web/README.md](apps/web/README.md)** for the test and quality gates, and how the
mock data layer is put together, and **[infra/README.md](infra/README.md)** for the stack itself —
what is published, where the passwords come from, and the two database roles.

For the full comparison — what each of the three modes proves, what it *cannot* prove, and the
list of endpoints that cannot be tested locally — read
**[the three ways to run it](docs/Project%20Management%20&%20Planning/deployment-implementation-log.md#reference--the-three-ways-to-run-it-and-what-each-one-can-prove)**.

## Status

**Frontend** — Phases 0–10.5 complete: app shell, typed contract, static screens,
**mock backend (MSW) with live data hooks**, the interactive scan flow, **Playwright
end-to-end tests**, and the
[CR-001](docs/Change%20Requests/CR-001_2026-07-30_scoring-model-and-finding-ux.md)
migration (`Source` narrowed to `rule | satd`, in-place finding detail, the profile
sliders with an explicit **Apply**).

**Backend** — `apps/api` skeleton: routers, services, Alembic with the first migration,
RLS policies and cross-tenant tests, the Celery app and the scan pipeline are laid out,
with handler bodies still to come. `apps/ml` is the inference service.

**Documents** — SRS and SAD are at **v1.1**. The `.docx` under
`docs/Deliverables/{SRS,SAD}/v1.1/` is the deliverable; the `.md` alongside is a
generated mirror for reading and diffing in the repository.

**Next** — frontend Phase 10.6 (snake_case rename, five categories, Asgardeo sign-in).
Order of work in [the work plan and locked decisions](docs/Project%20Management%20&%20Planning/work-plan-and-locked-decisions-after-progress-eval.md).

## How the health score works

Every finding gets a priority; a file's debt is the sum of its findings; the repo's
0–100 health is that debt measured against the repo's size:

```
finding_priority = base_points × category_weight × source_trust × churn_factor × risk_factor
file_debt        = Σ finding_priority
repo_health      = 100 × (1 − min(1, Σ file_debt / (k × KLOC)))
grade            = A ≥ 85 · B ≥ 70 · C ≥ 55 · D ≥ 40 · E < 40
```

Every term above is either **measured** from the code (base points, churn, risk) or
**set by the user** (the five category weights and the trust slider on the Profiles
page) — except **`k`**, which is chosen by us. It is worth understanding, because it
is the one number that can quietly make every grade meaningless.

**Scores are computed on every read, never stored.** The database keeps the findings;
the scores are re-derived under the active profile each request (~10–50 ms for a full
20-scan history — the detection work was already paid for at scan time). One backend
rule keeps it that way: **do the summation in SQL, not in Python.** `SUM(...) GROUP BY`
is single-digit milliseconds; loading 40,000 finding objects into Python and looping is
the same formula 100× slower.

**What `k` is.** Debt points have no natural meaning — is `847` good? Nothing in the
formula knows. Dividing by **KLOC** first removes repo size from the picture, so you
are comparing debt *density* rather than totals; `k` then converts that density into a
0–100 score. Read it as:

> **`k` = how much debt per 1000 lines counts as "completely rotten" (health 0).**

With `k = 100`, a repo carrying 12 debt points per KLOC scores 88 (an A) and one
carrying 95 scores 5 (an E).

**Why it has to be calibrated.** Nothing measures `k` — it is a judgement about where
the grade boundaries should fall, so someone has to pick it, and a bad pick fails
*silently*:

| If `k` is… | The ratio… | Result |
|---|---|---|
| too small | is huge and clamps at 1 | **every repo grades E** |
| too large | is tiny | **every repo grades A** |

Neither case looks broken. You still get confident, precise, completely uninformative
grades. So `k` is fixed by running the scanner over a few **golden repositories** —
repos we already have an opinion about before measuring (a clean library, a typical
app, a known legacy mess) — and choosing the `k` that puts them where that judgement
says they belong. It is a sanity check against human judgement, not a fit.

⚠️ **`k` is currently uncalibrated.** [CR-001](docs/Change%20Requests/CR-001_2026-07-30_scoring-model-and-finding-ux.md)
changed the scale of `file_debt` (an additive risk term was removed and a multiplier
of up to 2.5× added), so any earlier value is invalid. Method and worked example:
**[apps/ml/README.md](apps/ml/README.md)**; formula in
[the analysis-engine doc §6](docs/Project%20Management%20&%20Planning/code-sage_backend-analysis-engine.md).

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js · TypeScript · Tailwind + shadcn/ui |
| API & worker | FastAPI · Celery · Redis (one image, two commands) |
| Extraction | **CK** (Java metrics, run as a jar) · **Tree-sitter** (comments) · **PyDriller** (process metrics) |
| ML | scikit-learn — **SATDAUG** trains ML-1, **D'Ambros** trains ML-2 |
| Data | PostgreSQL with Row-Level Security |
| Identity | **Asgardeo**, with GitHub federated inside it |
| Deployment | Docker Compose — six containers |

**v1.0 analyses Java only**, because CK is a Java-only extractor. Widening that needs
a Tree-sitter grammar, a per-language rule pack and a recalibration of `k` — it is not
a config change.
