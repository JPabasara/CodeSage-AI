# CodeSage-AI

The Lightweight Technical-Debt & Analytics Dashboard — an AI-assisted tool that scores a
repository's code health, ranks the highest-value refactors first, and shows it on a heat-map
dashboard.

**Live:** <https://codesageai.dev> · API <https://api.codesageai.dev>

---

## Running it locally

Three ways. **They are not interchangeable** — each proves things the others cannot.

| You want to… | Use | Needs |
|---|---|---|
| Work on a screen, layout, or the scan flow | **1 · Frontend + MSW** | Node + pnpm |
| Test a real endpoint, the database, the worker | **2 · Docker Compose** | Docker |
| Check cookies, HTTPS, the demo | **3 · The live site** | a browser |

### 1 · Frontend only, with MSW

No Python, no Docker, no database. MSW (Mock Service Worker) intercepts every `fetch()` in the
browser and answers from fixtures in `apps/web/src/lib/mocks/`.

```powershell
cd apps/web
pnpm install
pnpm dev            # http://localhost:3000
```

`apps/web/.env.local` — gitignored, copy from `.env.example`:

```ini
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_API_MOCKING=e2e
NEXT_PUBLIC_SESSION_COOKIE_NAME=codesage_session
```

> ⚠️ **You will land on `/login` and be unable to leave — and MSW cannot help.**
> `src/middleware.ts` redirects anyone without a session cookie. Middleware runs on the **server**,
> before the page is sent; a service worker lives in the browser and cannot intercept it.
>
> **Fix:** add a cookie by hand — DevTools → Application → Cookies → `http://localhost:3000`, name
> `codesage_session`, **any value**. The cookie is `httpOnly`, so the middleware only checks that it
> *exists*; a seeded one is exactly what it sees after a real sign-in. This is what Playwright does
> (`apps/web/e2e/session.ts`).

**The three mocking modes** (`NEXT_PUBLIC_API_MOCKING`):

| Mode | Data endpoints | `/api/auth/session` | Use for |
|---|---|---|---|
| `e2e` | mocked | **mocked** | offline UI work — no backend at all |
| `enabled` | mocked | **passed through to the real API** | testing a real Asgardeo sign-in with mock data |
| `disabled` | real | real | pointing `pnpm dev` at a running backend |

**Sign-in can never be mocked, in any mode.** A service worker can intercept `fetch()`, but not a
full-page navigation — and OIDC is exactly that: the browser physically travels to Asgardeo and back.
That is why the sign-in button is a plain `<a href>`, never a `fetch`.

### 2 · The whole stack in Docker

```powershell
cd infra
cp .env.example .env      # then fill in the Asgardeo values
docker compose up -d      # ~90s; the worker's start_period alone is 45s
docker compose ps         # all six should read (healthy)
```

`web` → <http://localhost:3000> · `api` → <http://localhost:8000>. Postgres, Redis and `ml` stay on
the private network and are not published.

**Mocking is always off here** — the Dockerfile hardcodes `NEXT_PUBLIC_API_MOCKING=disabled`. An
image built with the fake backend on would demo beautifully and prove nothing.

To scan, use a **Java** repository: v1.0 analyses Java only, so a Python repo scans successfully and
finds nothing — which looks like a bug and isn't.

Details, and the two database roles: **[infra/README.md](infra/README.md)**.

### 3 · The live site

Sign in at <https://codesageai.dev>. Only this proves HTTPS, cross-host cookies, real CORS, and that
the *published image* runs — not your local build.

### What cannot be tested locally

| | |
|---|---|
| `Secure` cookies, cross-host cookie domain, real CORS | `web` and `api` are both `localhost` locally; live they are two hosts |
| HTTPS, certificates, custom-domain routing | no TLS locally |
| Neon pooled vs direct endpoints, Upstash `rediss://` | local Postgres and Redis are plain containers |
| The published image itself | Compose builds from your working tree; Railway pulls what CI built |

**Not implemented anywhere yet** — these fail identically local and live, so don't chase an
environment cause: `GET /api/profiles`, `GET /api/profiles/active`, `PUT /api/profiles/active` return
**501**, so the Profiles screen works only in mode 1. `/readyz` and `/version` return **501**; the
health endpoint is `/api/healthz`.

---

## Architecture

**A modular monolith with an asynchronous worker and one extracted inference service.** Not
microservices — the boundaries are drawn around *workload*, not domain.

```
browser ──HTTPS──▶  api :8000  ──▶ postgres        worker ──HTTP──▶ ml :8001
   │                    │                             │                 │
   │                    └──▶ redis ──enqueue──────────┘            /models (mounted)
   └── httpOnly session cookie
```

Six containers, but two are infrastructure (`postgres`, `redis`), one is the frontend (`web`), and
**`api` and `worker` are the same image with a different command**.

| Style | Where it shows up |
|---|---|
| **Modular monolith** | `apps/api` — boundaries enforced by import-linter contracts in CI, not by network calls |
| **Pipe and filter** | the scan pipeline: `clone → extract → detect → finalize`, cancel check *between* stages |
| **Competing consumers** | API enqueues one job to Redis; N workers compete. `--scale worker=3` meets PERF-07 with no code change |
| **Write path / read path split** | the worker stores **facts**; the API derives **scores** on every read — which is what lets a profile change re-rank findings with no re-scan |
| **Functional core** | `ScoringEngine` is a pure function, and an import contract makes it stay one |

**Why not microservices.** One bounded context; snapshot finalization must be a single transaction
(FR-6 forbids "half a snapshot"); Row-Level Security needs one database to key tenant isolation on;
a dashboard read joins everything at once.

**Where `apps/ml` fits.** A stateless inference service — no database, no domain, artifacts *mounted*
rather than baked in. Extracted so that "ML unavailable" is a **degraded mode** the scan handles
rather than an exception that kills it. Training lives in `apps/ml/training/` and is never deployed.

---

## Security

The API is the **Backend-for-Frontend**. Sign-in runs through
[Asgardeo](https://wso2.com/asgardeo/), which federates GitHub, and the exchange happens server-side:

- the authorization-code exchange (with PKCE) is performed by `apps/api`, never by the browser
- identity tokens stay in the backend — the browser gets only an **httpOnly, Secure, SameSite=Lax**
  cookie holding an opaque session id
- sessions are **server-side rows**, so signing out revokes access on the next request
- every endpoint requires a session except sign-in start, sign-in callback and `/healthz`
- Postgres **Row-Level Security** keys tenant isolation, and the app connects as a non-owner role so
  the policies actually apply

Adding Google or a password login later is a setting in the Asgardeo console, not new code. Details:
SRS §3.5 (SEC-17–20), SAD §6.4.

---

## How the health score works

```
finding_priority = base_points × category_weight × source_trust × churn_factor × risk_factor
file_debt        = Σ finding_priority
repo_health      = 100 × (1 − min(1, Σ file_debt / (k × KLOC)))
grade            = A ≥ 85 · B ≥ 70 · C ≥ 55 · D ≥ 40 · E < 40
```

Every term is **measured** from the code or **set by the user** on the Profiles page — except **`k`**,
which we choose.

**Scores are computed on every read, never stored.** The database keeps findings; scores are
re-derived under the active profile each request. One rule keeps it fast: **do the summation in SQL,
not in Python.**

**What `k` is:** how much debt per 1000 lines counts as "completely rotten" (health 0). Dividing by
KLOC removes repo size, so you compare debt *density*; `k` turns density into a 0–100 score.

⚠️ **`k` is currently uncalibrated**, and a bad value fails *silently* — too small and every repo
grades E, too large and every repo grades A. Neither looks broken. It is fixed by scanning **golden
repositories** we already have an opinion about and choosing the `k` that puts them where judgement
says they belong. Method: **[apps/ml/README.md](apps/ml/README.md)**.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js · TypeScript · Tailwind + shadcn/ui |
| API & worker | FastAPI · Celery · Redis (one image, two commands) |
| Extraction | **CK** (Java metrics, a jar) · **Tree-sitter** (comments) · **PyDriller** (process metrics) |
| ML | scikit-learn — **SATDAUG** trains ML-1, **D'Ambros** trains ML-2 |
| Data | PostgreSQL with Row-Level Security |
| Identity | **Asgardeo**, GitHub federated inside it |
| Deployed on | Railway (`web`, `api`, `worker`, `ml`) · Neon (Postgres) · Upstash (Redis) |

**v1.0 analyses Java only**, because CK is a Java-only extractor. Widening it needs a Tree-sitter
grammar, a per-language rule pack and a recalibration of `k`.

---

## Repository layout

```
apps/web/     Next.js frontend
apps/api/     FastAPI + Celery — API process and scan worker (one image, two commands)
apps/ml/      ML inference service (:8001) + offline training for ML-1 and ML-2
infra/        docker-compose stack — see infra/README.md
docs/api/     openapi.yaml — the contract; frontend types are generated from it
docs/         Deliverables (SRS, SAD), Diagrams, Change Requests, planning
```

**The contract generates the frontend's types.** `apps/web/src/lib/types/api.ts` is produced from
[`docs/api/openapi.yaml`](docs/api/openapi.yaml) by `pnpm gen:types` and must never be hand-edited.
CI runs `pnpm gen:types:check`, which fails the moment the two drift apart.

**Change Requests.** Once a deliverable is written, a decision that contradicts it is recorded — as a
CR, or as a revision-history row in the deliverable — never silently edited in.

---

## Where to read next

| | |
|---|---|
| Decisions that are locked, and the order of work | [work plan and locked decisions](docs/Project%20Management%20&%20Planning/work-plan-and-locked-decisions-after-progress-eval.md) |
| What is deployed, how, and what broke on the way | [deployment log](docs/Project%20Management%20&%20Planning/deployment-implementation-log.md) |
| Who owns what, and the plan to mid-evaluation | [team plan](docs/Project%20Management%20&%20Planning/team-plan-to-mid-evaluation.md) |
| The local stack, in detail | [infra/README.md](infra/README.md) |
| Frontend tests and the mock layer | [apps/web/README.md](apps/web/README.md) |
