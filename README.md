# CodeSage-AI

The Lightweight Technical-Debt & Analytics Dashboard — an AI-assisted tool that
scores a repository's code health, ranks the highest-value refactors first, and
shows it all on a heat-map dashboard.

## Repository layout

```
apps/
└── web/     # Next.js frontend (App Router + shadcn). Runs on a mock backend today.
docs/
├── Deliverables/               # SRS, SAD (formal documents)
└── Project Management & Planning/
    ├── frontend_build_stepbystep.md   # the execution recipe (phase by phase)
    ├── frontend_prototype_plan.md     # architecture & design decisions
    ├── code-sage_backend-analysis-engine.md
    ├── data-model-decisions.md        # DB / multi-tenancy / RLS decisions
    └── release-roadmap.md
```

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
contract, the static screens, and the **mock backend (MSW) with live data hooks**
are in place. Next: wiring the interactive scan flow, then end-to-end tests.

## Planned stack

Next.js / TypeScript / Tailwind + shadcn (frontend) · FastAPI / Celery / Redis
(backend) · Python / scikit-learn + Lizard + PyDriller (analysis/ML) · PostgreSQL
(data) · Docker.
