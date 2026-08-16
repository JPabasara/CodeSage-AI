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
├── NEXT_STEPS.md               # ← the current working plan and the locked decisions
├── api/openapi.yaml            # the REST contract. Frontend types are generated from it
├── Deliverables/               # SRS and SAD — .docx is the deliverable, .md is a generated mirror
├── Diagrams/UMLs/              # draw.io sources for every figure in the SAD
├── Change Requests/            # accepted changes to the deliverables, with rationale
│   └── CR-001_2026-07-30_scoring-model-and-finding-ux.md
├── Templates/                  # the blank course templates (inputs only)
├── tools/                      # the scripts that build the deliverables — see its README
└── Project Management & Planning/
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

> **Start here:** [docs/NEXT_STEPS.md](docs/NEXT_STEPS.md) carries the decisions that are
> locked and the order of work. Read it before changing anything — several decisions
> were reversed after the deliverables were written.

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

## Getting started (frontend)

```powershell
cd apps/web
pnpm install
# create apps/web/.env.local with: NEXT_PUBLIC_API_MOCKING=enabled
pnpm dev            # http://localhost:3000
```

See **[apps/web/README.md](apps/web/README.md)** for full setup (including the
required `.env.local`), the test/quality gates, and how the mock data layer works.

## Getting started (full stack)

```powershell
cd infra
docker compose up -d              # postgres · redis · ml · api · worker · web
docker compose up --scale worker=3   # three concurrent scans (PERF-07)
```

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
Order of work in [docs/NEXT_STEPS.md](docs/NEXT_STEPS.md).

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
