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
```

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

- **`src/lib/types`** — the data **contract**. One source of truth for every shape
  that flows between the frontend, the mock, and the future real backend.
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
  [root README](../../README.md#how-the-health-score-works); method in
  [apps/ml/README.md](../ml/README.md).

Changing a **scoring profile** doesn't change this: the Profiles page `PUT`s the
profile, then re-reads `HealthReport` — the numbers are re-derived server-side and no
scan runs. See Phase 10.5 in the build guide.

### Pending contract change — CR-001 (Phase 10.5)

Two shapes in `src/lib/types` change before Phase 11. Details and rationale:
[CR-001](../../docs/Change%20Requests/CR-001_2026-07-30_scoring-model-and-finding-ux.md);
step-by-step in Phase 10.5 of the
[build guide](../../docs/Project%20Management%20&%20Planning/frontend_build_stepbystep.md).

| Type | From | To |
|---|---|---|
| `Source` | `"rule" \| "satd" \| "security" \| "ml-risk"` | `"rule" \| "satd"` |
| `Category` | 5 values | **6 values** — `defect` added (`"code-design" \| "requirement" \| "defect" \| "documentation" \| "test" \| "security"`) |
| `ScoreProfile` | `weights { security, codeDesign, satd, duplication }` + `wMl` | `weights` keyed by the six **categories** + `trust` (`s`, 0–1) |

`security` duplicated `category` exactly (security patterns run inside the rule
engine, so such a finding was always both) and `ml-risk` was unreachable — the risk
model writes `FileScore.riskScore`, never a `Finding`. The old weight vector mixed
axes: `satd` is a *source*, `duplication` is a *rule*, and three real categories had
no weight at all — which becomes a slider the user can drag with no effect once
Phase 10.5 ships the Profiles page.

`defect` is a **new sixth category**, confirmed against the SATD dataset on 31 Jul
(472 labelled comments — more than `test` and `documentation` combined). It closes
decision **D5**, so the enum is now frozen. `non_debt` in the dataset is the
negative class of the debt/not-debt decision and is **not** a category — it must
never appear in `Category`.

Until that phase lands, the fixtures still use the old values; `pnpm tsc` will
locate every site once the types are edited.

## Layout

```
src/
├── app/                 # routes (App Router). (auth) = login, (app) = the shell
├── components/          # dashboard/ projects/ layout/ + ui/ (shadcn)
├── hooks/               # data hooks over useQuery
├── lib/
│   ├── api/client.ts    # network calls
│   ├── mocks/           # MSW handlers + fixtures (deleted at go-live)
│   ├── types/           # THE CONTRACT
│   └── utils.ts         # colour helpers (grade/severity/health), cn, shortSha
└── test/setup.ts        # jsdom polyfills + MSW node server for tests
```

Build guide and architecture live in [`docs/Project Management & Planning/`](../../docs/Project%20Management%20%26%20Planning/).
