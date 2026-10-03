# CodeSage AI

An AI-assisted technical-debt analytics dashboard for small agile teams. CodeSage scans a Java
repository on GitHub, scores its code health, ranks the findings worth fixing first, and shows the
result on a dashboard with a trend chart and a file-level heat map.

**Live:** <https://codesageai.dev> · API <https://api.codesageai.dev>

CS3203 Software Engineering Project · Group 16 · Project ID 7

---

## What it does

- **Connects public GitHub repositories** and scans any branch on demand, with live progress and a
  Stop control.
- **Finds technical debt** with a rule engine and PMD (design and security rules), and with an ML
  classifier that reads code comments for self-admitted technical debt (SATD).
- **Predicts bug-prone files** with a second ML model trained on class metrics and change history.
- **Scores health from 0 to 100 with a grade from A to E**, and ranks findings in a Refactor-First
  list. Scoring profiles let a team weight debt categories differently without re-scanning.
- **Keeps every scan as an immutable snapshot**, so history, trends and deltas are always reproducible.
- **Supports teams**: workspaces with four roles (Org Admin, Manager, Developer, Viewer), email
  invitations, and finding triage.

---

## Architecture

A modular monolith with asynchronous workers and one separate inference service.

```
browser ──HTTPS──> web (Next.js) ──> api (FastAPI) ──> PostgreSQL (Row-Level Security)
                                        │
                                        └──> Redis ──> worker (scans) ──HTTP──> ml (inference)
                                                   └──> score-worker (score cache)
```

| Part | What it is |
|---|---|
| `web` | Next.js dashboard. Holds no tokens; the session travels as an httpOnly cookie |
| `api` | FastAPI backend and Backend-for-Frontend for sign-in |
| `worker` | Celery worker running the scan pipeline: clone, extract, detect, finalise |
| `score-worker` | Celery worker that pre-computes scores after a scan or a profile change |
| `ml` | Stateless inference service for the SATD classifier and the bug-risk model |
| PostgreSQL | Findings and snapshots; tenant isolation enforced by Row-Level Security |
| Redis | Task queue, scan progress and cancellation flags |

`api`, `worker` and `score-worker` are one image started with different commands. The scan pipeline
checks for cancellation between stages, and a snapshot is written in a single transaction, so a
failed or stopped scan never leaves partial results.

### Deployment

| Environment | Where |
|---|---|
| Production | Single-node k3s cluster on Linode; KEDA scales the scan workers on queue length (1 to 3) |
| Database | Neon PostgreSQL |
| Staging | Railway |
| Images | GitHub Container Registry |

Every push to `main` runs the CI pipeline in `.github/workflows/ci.yml`: web, API and ML tests,
image builds, a staging deploy with a smoke test, then a production deploy with a smoke test.
Deployment details: [infra/README.md](infra/README.md) and
[infra/k3s/linode/README.md](infra/k3s/linode/README.md).

---

## Running it locally

There are three ways to run it, and each one proves something the others cannot.

| You want to | Use | Needs |
|---|---|---|
| Work on a screen, layout or the scan flow | Frontend with mock API (MSW) | Node 22 and pnpm |
| Test real endpoints, the database and the workers | Docker Compose | Docker |
| Check cookies, HTTPS and the deployed build | The live site | A browser |

### Frontend only, with a mock API

No Python, Docker or database. Mock Service Worker answers every request from fixtures in
`apps/web/src/lib/mocks/`.

```powershell
cd apps/web
pnpm install
copy .env.example .env.local   # set NEXT_PUBLIC_API_MOCKING=e2e
pnpm dev                       # http://localhost:3000
```

The middleware sends anyone without a session cookie to `/login`, and a service worker cannot
intercept that. Add a cookie named `codesage_session` with any value for `http://localhost:3000` in
DevTools, which is what the Playwright tests do. More in [apps/web/README.md](apps/web/README.md).

### The whole stack in Docker

```powershell
cd infra
copy .env.example .env      # fill in the Asgardeo values
docker compose up -d
docker compose ps           # every service should report (healthy)
```

`web` runs on <http://localhost:3000> and `api` on <http://localhost:8000>. Short version:
[LOCAL_SETUP.md](LOCAL_SETUP.md). Full version: [infra/README.md](infra/README.md).

Scan a **Java** repository. CodeSage analyses Java only, so other languages scan successfully but
produce no findings.

---

## Testing

| Suite | Command | Size |
|---|---|---|
| Web components and hooks (Vitest) | `cd apps/web; pnpm test:run` | 519 tests |
| End-to-end and accessibility (Playwright, axe-core) | `cd apps/web; pnpm test:e2e` | 146 tests |
| API unit and integration (pytest, PostgreSQL via Testcontainers) | `cd apps/api; pytest` | 686 tests |
| ML service (pytest) | `cd apps/ml; pytest` | 24 tests |
| Load test (k6) | `k6 run -e MODE=load tests/load/dashboard.js` | 50 virtual users |

All automated suites run in CI on every push. Results of the final test cycle, including load,
security and usability testing: [docs/Testing/](docs/Testing/).

---

## Security

- Sign-in runs through [Asgardeo](https://wso2.com/asgardeo/) (OpenID Connect). The authorisation-code
  exchange with PKCE happens in the API, never in the browser.
- The browser only receives an httpOnly, Secure, SameSite=Lax cookie holding an opaque session id.
  Sessions are server-side rows, so signing out revokes access on the next request.
- Every endpoint requires a session except sign-in start, sign-in callback and `/api/healthz`.
- Every operation is checked against the caller's role in the workspace
  ([permission matrix](docs/RBAC_PERMISSION_MATRIX.md)), and PostgreSQL Row-Level Security keeps
  workspaces apart even if an application check were missed.

---

## How the health score works

```
finding_priority = base_points × category_weight × source_trust × churn_factor × risk_factor
file_debt        = Σ finding_priority
repo_health      = 100 × (1 − min(1, Σ file_debt / (k × KLOC)))
grade            = A ≥ 85 · B ≥ 70 · C ≥ 55 · D ≥ 40 · E < 40
```

A scan stores findings, not scores. Scores are derived from those findings under the active profile
and cached per profile by the score-worker, which is why changing a profile re-ranks findings
without a new scan.

`k` is how much debt per thousand lines counts as a health of zero. It is set to **100**, calibrated
on a pilot corpus of open-source Java repositories; the method is recorded in
`apps/api/src/codesage_api/scoring/config/calibration.yaml`.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS, shadcn/ui, Recharts |
| Backend | FastAPI, SQLAlchemy, Alembic, Celery, Redis |
| Analysis | CK (Java metrics), PMD, Tree-sitter (comments), PyDriller (change history) |
| ML | scikit-learn: TF-IDF with Linear SVM (SATD), Random Forest (bug risk) |
| Data | PostgreSQL 16 with Row-Level Security |
| Identity | Asgardeo |
| Infrastructure | k3s, KEDA, Docker, GitHub Actions, Neon, Railway |

---

## Repository layout

```
apps/web/        Next.js frontend
apps/api/        FastAPI API and Celery workers (one image)
apps/ml/         ML inference service and offline training
infra/           Docker Compose stack and k3s manifests
tests/load/      k6 load test
docs/api/        openapi.yaml, the API contract; frontend types are generated from it
docs/Deliverables/  Proposal, Feasibility Study, SRS, SAD, Gantt chart
docs/Diagrams/   UML diagrams by version
docs/Testing/    Master Test Plan, test results, usability study
```

`apps/web/src/lib/types/api.ts` is generated from [docs/api/openapi.yaml](docs/api/openapi.yaml) by
`pnpm gen:types` and must not be edited by hand. CI fails if the two drift apart.

---

## Team

| Index | Name |
|---|---|
| 230432G | Nethmini R.M.N. |
| 230435T | Nethsara U.D.K.C. |
| 230451M | Pabasara H.H.J. |

Mentor: Mr. Anju Chamantha
