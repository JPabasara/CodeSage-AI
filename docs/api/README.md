# The API contract

`openapi.yaml` is **normative**. It is the single source of truth for every shape
that crosses the browser/backend boundary (SRS SP-4, SRS Appendix B).

## Who consumes it

| Side | How |
|---|---|
| **Frontend** | `apps/web/src/lib/types/api.ts` is **generated** from this file. Never hand-edit it. |
| **Backend** | Pydantic models must match. CI diffs FastAPI's `/openapi.json` against this file. |
| **Mocks** | MSW handlers should be validated against these schemas so the fake backend cannot lie. |

## Regenerating the frontend types

```powershell
cd apps/web
pnpm gen:types          # → src/lib/types/api.ts
```

Run it after any change to `openapi.yaml`. Then `pnpm tsc` shows you every call site
that no longer agrees with the contract — which is the whole point: a backend field
change the frontend has not absorbed becomes a **compile error**, not a runtime
surprise at the demo.

`pnpm gen:types:check` generates to nowhere and is the CI-friendly form — it fails if
the contract is invalid without writing anything.

### Using the generated types

```ts
import type { components } from "@/lib/types/api";

type HealthReport = components["schemas"]["HealthReport"];
type Finding      = components["schemas"]["Finding"];
type Category     = components["schemas"]["Category"];
```

Re-export the ones you use often from `lib/types/index.ts` so components import from
one place, exactly as they do today.

## Validating the contract

```powershell
python -m pip install openapi-spec-validator
python -c "from openapi_spec_validator import validate; from openapi_spec_validator.readers import read_from_filename; validate(read_from_filename('docs/api/openapi.yaml')[0]); print('valid')"
```

## The conventions it encodes

All of these are settled decisions — see [the work plan and locked decisions](../Project%20Management%20&%20Planning/work-plan-and-locked-decisions.md).

| Convention | Detail |
|---|---|
| **snake_case** | Every field name **and** every path parameter (`{repo_id}`, `{scan_id}`). One name survives from PostgreSQL to the browser. |
| **Session cookie** | FastAPI is the BFF. It completes the Asgardeo OIDC flow and hands the browser an httpOnly cookie — never a token. Clients must send `credentials: "include"`. |
| **Five categories** | `code-design` · `requirement` · `documentation` · `test` · `security`. No `defect` — SATDAUG has no such label. |
| **Six numbers** | A profile is five weights plus `trust_s`. |
| **Derived on read** | Every score is computed per request under the active profile. **No endpoint takes a profile parameter.** |
| **Error envelope** | `{ detail, code, errors[] }`. Clients switch on `code`, never on `detail`. |
| **Clamp vs reject** | Out-of-range weights are **clamped and returned** with `200`. A malformed body is `422`. Those are different failures. |

## Two things worth knowing

**`risk_score` is nullable, and `null ≠ 0.0`.** `null` means the ML service was
unreachable when the snapshot was taken, so no estimate exists. `0.0` is a measured
"this file looks safe". Render `null` as *not assessed* — never as a zero-risk badge.
This is what makes degraded mode expressible in the contract rather than implied by
the code.

**`pinned_by_floor` explains itself.** A finding held in the visible list by the
critical-security floor (FR-24) rather than by its computed priority carries
`pinned_by_floor: true`, so the UI can say why a row is there even at the minimum
`security` weight of 0.1.

## Relationship to SRS Table 3.106

**They agree.** SRS v1.1 was corrected to match this contract, so Table 3.106 and
`openapi.yaml` can be read side by side. Three things were fixed to get there, and
they are worth knowing because the first one also explains a bug in the backend:

**1. The four auth rows were rotated.** In SRS v1.0 each path carried the *next*
row's purpose:

| v1.0 path | v1.0 purpose | Actually belongs to |
|---|---|---|
| `GET /api/auth/github` | Begin sign-in | ✅ correct |
| `GET /api/auth/github/login` | "GitHub's redirect target…" | the callback |
| `GET /api/auth/github/callback` | "Return the signed-in user…" | the session endpoint |
| `POST /api/auth/session` | "End the session…" | logout |

`apps/api/.../routers/auth.py` reproduces the **same** off-by-one, because it was
implemented faithfully from the table. That is a documentation bug that became a code
bug — worth remembering next time a table looks slightly wrong.

**2. The auth paths are provider-neutral.** `/api/auth/login`, `/api/auth/callback`,
`/api/auth/session`, `/api/auth/logout` — no `/github/` segment, because which
provider a user picks is Asgardeo's business. A user may sign in with Google or a
password and the endpoint is the same.

**3. Two additions.** `GET /api/repos/{repo_id}/health?snapshot_id=` is required by
FR-19 ("selecting a past scan loads that snapshot into the dashboard") but was absent
from the table. `GET /api/healthz` is an operational liveness probe, outside the
product surface.

Path parameters are **snake_case** on both sides now (`{repo_id}`), matching every
other field name on the wire.

## What the backend still has to do

The contract is finished; the implementation is not. Until these land, the contract
describes an API that does not yet enforce itself:

- session-cookie authentication, with only `/auth/login`, `/auth/callback` and
  `/healthz` public (`security: []` in the spec marks exactly those three)
- `{ detail, code }` on every error, with `code` drawn from the `ErrorCode` enum
- snake_case responses — the Pydantic base still converts to camelCase

Steps 3a to 3f of [the work plan and locked decisions](../Project%20Management%20&%20Planning/work-plan-and-locked-decisions.md) cover all of it.
