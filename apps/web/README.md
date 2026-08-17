# Code Sage AI — Web (frontend)

The Next.js (App Router) dashboard for Code Sage AI. Runs today against a **mock
backend (MSW)** — no FastAPI, no database required. When the real backend ships,
one env flag flips it over with no component or test changes.

## Prerequisites

- **Node.js** v20+ (LTS)
- **pnpm** (via `corepack enable`, or `npm i -g pnpm`)

## Setup

```powershell
pnpm install
```

### ⚠️ Required: create `.env.local`

The mock backend is turned on by an env flag that is **gitignored** (so it is not
in a fresh clone). Create `apps/web/.env.local` with:

```
NEXT_PUBLIC_API_MOCKING=enabled
```

Without it, the app has no data source and the screens render empty.

## Run

```powershell
pnpm dev            # dev server at http://localhost:3000 (Fast Refresh)
pnpm build          # production build (also the strongest gate — renders every route)
pnpm start          # serve the production build
```

## Test & quality gates

```powershell
pnpm test:run              # component + hook tests (Vitest), once
pnpm test                  # same, watch mode
pnpm test:e2e              # Playwright end-to-end (Phase 10)
pnpm exec tsc --noEmit     # type-check
pnpm exec eslint src       # lint
pnpm format                # Prettier write
pnpm gen:types             # regenerate src/lib/types/api.ts from the API contract
pnpm gen:types:check       # fails if that file is stale — run before you commit
```

### Regenerating the API types

`docs/api/openapi.yaml` is the **contract** — the single source of truth for every
shape crossing the browser/backend boundary. `src/lib/types/api.ts` is **generated
from it** and must never be hand-edited:

```
docs/api/openapi.yaml ──pnpm gen:types──> src/lib/types/api.ts
```

Edit the contract, then run `pnpm gen:types` and commit both together.
`pnpm gen:types:check` regenerates in memory and compares, so it exits 1 the moment
the two drift apart — which is the only thing stopping a contract change from
silently not reaching the frontend. It is **not wired into CI yet** (this repo has
no CI pipeline), so today it is on you to run it.

`api.ts` is listed in `.prettierignore`: Prettier would reformat generated output
and `gen:types:check` could then never pass.

### Watching the E2E tests run

`pnpm test:e2e` runs Playwright headless. To watch a real browser drive the app:

```powershell
pnpm exec playwright test --headed                  # run in a visible browser
pnpm exec playwright test --ui                      # UI mode: pick tests, step, time-travel (DOM snapshots)
pnpm exec playwright test e2e/scan.spec.ts --debug  # step through one spec in the Inspector
pnpm exec playwright show-report                    # open the HTML report from the last run
```

Runs are slowed for visibility via `launchOptions.slowMo` in `playwright.config.ts`;
note that applies to **every** run, including the headless `pnpm test:e2e` gate. In
VS Code, the **Playwright Test for VSCode** extension adds ▶ buttons next to each `test(...)`.

## How the data layer works (the mock backend)

```
component → hook (src/hooks) → client (src/lib/api/client.ts) → fetch("/api/…")
                                                                     │
                                              intercepted by MSW (src/lib/mocks)
                                                                     │
                                                       fixtures (src/lib/mocks/fixtures.ts)
```

- **`src/lib/types`** — the shapes the components use. **`api.ts` in this folder is
  generated** from `docs/api/openapi.yaml` (the actual contract) by `pnpm gen:types`;
  the other files here are hand-written and are being replaced by it in Phase 10.6.
  Until that phase lands, components still import the hand-written ones — which is
  why they are still camelCase while the contract is snake_case.
- **`src/lib/mocks/handlers.ts`** — the fake API endpoints. The **same handlers**
  power the dev app (browser worker), the tests (Node server), and E2E.
- **`src/lib/api/client.ts`** — thin `fetch` functions. Final code; unaware the
  backend is mocked. Points at `NEXT_PUBLIC_API_BASE_URL` (empty in dev).
- **`src/hooks`** — `useProjects`, `useBranches`, `useHealthReport`, all built on a
  shared `useQuery` that returns `{ data, loading, error }`.

**Going live (Phase 12):** set `NEXT_PUBLIC_API_MOCKING=disabled`, point
`NEXT_PUBLIC_API_BASE_URL` at the real API — the components and tests don't change.

### The frontend never computes a score

`healthScore`, `grade`, `delta`, per-file debt and finding order all arrive
**already derived** in the `HealthReport`. The web app formats and colours them; it
never runs the scoring formula. Two things follow:

- **The scores in `fixtures.ts` are illustrative, not calibrated.** They were chosen to
  give the heat map red, amber and green nodes to render — they are not the output of
  any formula, so don't reason about the scoring model from them.
- **Real scores depend on a constant called `k`** that converts internal debt points
  into the 0–100 scale, and it is **not yet calibrated** (CR-001 changed the scale of
  `file_debt`). Expect real grades to move once it is. Background in the
  [root README](../../README.md#how-the-health-score-works); training and evaluation
  rules in [apps/ml/training/README.md](../ml/training/README.md).

Changing a **scoring profile** doesn't change this: the Profiles page `PUT`s the
profile, then re-reads `HealthReport` — the numbers are re-derived server-side and no
scan runs. See Phase 10.5 in the build guide.

### Contract change — CR-001 (Phase 10.5) ✅ landed

| Type | From | To |
|---|---|---|
| `Source` | `"rule" \| "satd" \| "security" \| "ml-risk"` | `"rule" \| "satd"` |
| `ScoreProfile` | `weights { security, codeDesign, satd, duplication }` + `wMl` | `weights` keyed by **category** + `trust` (`s`, 0–1) |

`security` duplicated `category` exactly (security patterns run inside the rule
engine, so such a finding was always both) and `ml-risk` was unreachable — the risk
model writes a per-file risk score, never a `Finding`. The old weight vector mixed
axes: `satd` is a *source*, `duplication` is a *rule*, and real categories had no
weight at all.

### ⚠️ Next contract change — CR-002 (Phase 10.6)

**The contract stops being hand-written.** `src/lib/types` will be **generated** from
`docs/api/openapi.yaml`, so a backend field change the frontend hasn't absorbed
becomes a type error rather than a runtime surprise. Everything below follows from
that. Step-by-step in Phase 10.6 of the
[build guide](../../docs/Project%20Management%20&%20Planning/frontend_build_stepbystep.md);
locked decisions in [the work plan and locked decisions](../../docs/Project%20Management%20&%20Planning/work-plan-and-locked-decisions.md).

| What | From | To |
|---|---|---|
| Field naming | camelCase (`riskScore`, `commitSha`) | **snake_case** (`risk_score`, `commit_sha`) — ~244 usages, 15 files |
| `Category` | 5 values incl. `defect` | **5 values, `defect` removed** — `code-design`, `requirement`, `documentation`, `test`, `security` |
| `ScoreProfile` | six weights | **five weights + `s`** = six numbers |
| `ScanPhase` | ends at `error` | adds **`cancelled`** — `idle` is now only the pre-scan resting state |
| Sign-in | mocked `POST /api/auth/github` | a link to **`GET {API}/api/auth/login`** — a real browser navigation, the one thing MSW cannot mock |
| Every `fetch` | default credentials | **`credentials: "include"`** — the session travels as a cookie, and a cross-origin fetch drops cookies unless you ask for them |
| Errors | `Error("409 Conflict")` | `{ detail, code, errors[] }` — branch on `code`, never on the text |

**Sign-in is not an `@asgardeo/nextjs` integration.** The API is the
Backend-for-Frontend: it performs the whole OIDC exchange and hands the browser an
httpOnly session cookie, so the frontend holds no token and needs no identity SDK.
Signing in is a link; signing out is one `POST`. See
[the work plan and locked decisions](../../docs/Project%20Management%20&%20Planning/work-plan-and-locked-decisions.md) step 3 and SAD §6.4.

**`defect` is removed, reversing the 31 Jul decision.** The SATD corpus changed to
**SATDAUG**, which carries no `defect_debt` label — so ML-1 cannot predict that
category and it cannot exist in the product. `non_debt` remains the negative class of
the debt/not-debt decision and is **not** a category.

Two endpoints are also missing from `lib/api/client.ts` and land in the same phase:
`POST /api/projects` (connect a repo — the form exists, the call does not) and
`GET /api/profiles/active` (seeds the Profiles sliders).

Until Phase 10.6 lands the fixtures still use the current values; run the type
generation first and `pnpm tsc` will locate every site for you.

## Layout

```
src/
├── app/                 # routes (App Router). (auth) = login, (app) = the shell
├── components/          # dashboard/ projects/ layout/ + ui/ (shadcn)
├── hooks/               # data hooks over useQuery
├── lib/
│   ├── api/client.ts    # network calls
│   ├── mocks/           # MSW handlers + fixtures (deleted at go-live)
│   ├── types/           # api.ts = GENERATED from docs/api/openapi.yaml (the contract)
│   └── utils.ts         # colour helpers (grade/severity/health), cn, shortSha
└── test/setup.ts        # jsdom polyfills + MSW node server for tests
```

Build guide and architecture live in [`docs/Project Management & Planning/`](../../docs/Project%20Management%20%26%20Planning/).
