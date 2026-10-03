# CodeSage AI — Web

The Next.js (App Router) frontend of CodeSage AI: projects, the health dashboard, findings, scan
history, scoring profiles, workspace and team management, the guided tour and the help centre.

The web app never computes a score and never holds a token. Scores arrive already derived from the
API, and the session is an httpOnly cookie set by the API.

## Prerequisites

- Node.js 22
- pnpm (`corepack enable`)

## Setup

```powershell
pnpm install
copy .env.example .env.local
```

`.env.local` is gitignored. The settings that matter:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | Where the API lives. Sign-in and sign-out always go here |
| `NEXT_PUBLIC_API_MOCKING` | `enabled`, `e2e` or `disabled` (see below) |
| `NEXT_PUBLIC_SESSION_COOKIE_NAME` | Must match the API's session cookie name |

### Mocking modes

| Mode | Data endpoints | `/api/auth/session` | Use for |
|---|---|---|---|
| `enabled` | mocked | real API | UI work while testing a real sign-in |
| `e2e` | mocked | mocked | offline UI work and Playwright |
| `disabled` | real | real | running against a real backend |

Sign-in can never be mocked: it is a full-page navigation to Asgardeo, which a service worker cannot
intercept. In `e2e` mode, add a cookie named `codesage_session` (any value) for
`http://localhost:3000` in DevTools to get past `/login`.

## Run

```powershell
pnpm dev      # http://localhost:3000
pnpm build    # production build
pnpm start    # serve the production build
```

## Test and quality checks

```powershell
pnpm test:run          # Vitest component and hook tests
pnpm test:e2e          # Playwright end-to-end and axe accessibility tests (Chromium)
pnpm typecheck         # tsc --noEmit
pnpm lint              # ESLint
pnpm format            # Prettier
pnpm gen:types         # regenerate src/lib/types/api.ts from docs/api/openapi.yaml
pnpm gen:types:check   # fail if the generated types are out of date
pnpm verify            # typecheck, lint, format check, unit tests and build in one go
```

CI runs the type contract check, type check, lint, unit tests and end-to-end tests on every push.

To watch the end-to-end tests in a browser:

```powershell
pnpm exec playwright test --headed
pnpm test:e2e:ui                      # Playwright UI mode
pnpm test:e2e:report                  # open the last HTML report
```

Set `E2E_SLOWMO=300` to slow each action down. `pnpm test:smoke:deployment` runs the deployment smoke
test against a live environment.

## The API contract

`docs/api/openapi.yaml` is the single source of truth for every request and response. The file
`src/lib/types/api.ts` is generated from it and must never be edited by hand:

```
docs/api/openapi.yaml ──pnpm gen:types──> src/lib/types/api.ts
```

Change the contract, run `pnpm gen:types`, and commit both files together. `src/lib/types/index.ts`
maps the generated types to the shapes the components use.

## How the data layer works

```
component → hook (src/hooks) → client (src/lib/api/client.ts) → fetch
                                                                  │
                                       real API, or MSW handlers in src/lib/mocks
```

- `src/lib/api/client.ts` holds every network call and sends the session cookie with
  `credentials: "include"`.
- `src/hooks` wraps the calls in a small shared `useQuery` cache returning `{ data, loading, error }`.
- `src/lib/mocks` contains the MSW handlers and fixtures. The same handlers serve the dev app, the
  unit tests and the end-to-end tests.
- Errors arrive as `{ detail, code, errors[] }`; the UI branches on `code`, never on the message.

## Layout

```
src/
├── app/            routes: (auth)/login, (app)/projects, dashboard, profiles, workspace,
│                   help, support; plus onboarding, invitations, guide and privacy
├── components/     dashboard, projects, history, profiles, workspace, layout, tour,
│                   support, auth, and ui (shadcn/ui primitives)
├── hooks/          data and selection hooks
├── lib/            api client, mocks, generated types, help-centre content, role helpers
└── middleware.ts   redirects to /login when there is no session cookie
e2e/                Playwright specs
```
