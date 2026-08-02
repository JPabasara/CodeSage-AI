# CodeSage-AI

The Lightweight Technical-Debt & Analytics Dashboard — an AI-assisted tool that
scores a repository's code health, ranks the highest-value refactors first, and
shows it all on a heat-map dashboard.

## Repository layout

```
apps/
├── web/     # Next.js frontend (App Router + shadcn). Runs on a mock backend today.
└── ml/      # SATD classifier (ML-1), risk model (ML-2), feature extraction, calibration
docs/
├── Deliverables/               # SRS, SAD (formal documents)
├── Change Requests/            # accepted changes to the deliverables, with rationale
│   └── CR-001_2026-07-30_scoring-model-and-finding-ux.md
└── Project Management & Planning/
    ├── frontend_build_stepbystep.md   # the execution recipe (phase by phase)
    ├── frontend_prototype_plan.md     # architecture & design decisions
    ├── code-sage_backend-analysis-engine.md
    ├── data-model-decisions.md        # DB / multi-tenancy / RLS decisions
    └── release-roadmap.md
```

> **Change Requests.** Once a deliverable is written, a decision that contradicts it is recorded as a **CR** rather than silently edited in. Each CR states the problem, the decision and the *why*, then lists every document it touches — so a reader six months later can tell the difference between a considered change and a drifting document.

> The backend (`apps/api` — FastAPI + Celery + Redis + PostgreSQL) is planned but
> not yet in this repo. The frontend is built against a typed **data contract**
> and a **mock backend (MSW)**, so it runs and is fully testable with no backend.

## Getting started (frontend)

```powershell
cd apps/web
pnpm install
# create apps/web/.env.local with: NEXT_PUBLIC_API_MOCKING=enabled
pnpm dev            # http://localhost:3000
```

See **[apps/web/README.md](apps/web/README.md)** for full setup (including the
required `.env.local`), the test/quality gates, and how the mock data layer works.

## Status

Frontend build is progressing through the phased guide: the app shell, the typed
contract, the static screens, the **mock backend (MSW) with live data hooks**, the
interactive scan flow and the **Playwright end-to-end tests** are in place
(Phases 0–10 complete).

Next up is **Phase 10.5**, which lands
[CR-001](docs/Change%20Requests/CR-001_2026-07-30_scoring-model-and-finding-ux.md):
the `Source` enum narrows to `rule | satd`, the scoring profile becomes six
category weights plus a rules-versus-model trust slider (applied with an explicit
**Apply** button — one `PUT /api/profiles/active`, no re-scan), and the finding
detail moves from a slide-over into the dashboard itself. Phase 11 (polish and
Definition of Done) follows.

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
**set by the user** (the six category weights and the trust slider on the Profiles
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

## Planned stack

Next.js / TypeScript / Tailwind + shadcn (frontend) · FastAPI / Celery / Redis
(backend) · Python / scikit-learn + Lizard + PyDriller (analysis/ML) · PostgreSQL
(data) · Docker.
