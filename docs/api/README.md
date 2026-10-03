# The API contract

`openapi.yaml` is **normative**. It is the single source of truth for every shape
that crosses the browser/backend boundary.

## Who consumes it

| Side | How |
|---|---|
| **Frontend** | `apps/web/src/lib/types/api.ts` is **generated** from this file. Never hand-edit it. |
| **Backend** | Pydantic models must match. `apps/api/tests/unit/schemas/test_contract.py` checks that the app serves every endpoint in this file. |
| **Mocks** | MSW handlers are typed with the generated schemas, so the fake backend cannot return a shape the real one could not. |

## Regenerating the frontend types

```powershell
cd apps/web
pnpm gen:types          # → src/lib/types/api.ts
```

Run it after any change to `openapi.yaml`. Then `pnpm tsc` shows you every call site
that no longer agrees with the contract — which is the whole point: a backend field
change the frontend has not absorbed becomes a **compile error**, not a runtime
surprise at the demo.

`pnpm gen:types:check` regenerates in memory and compares the result with the
committed `api.ts`. CI runs it on every push, so the contract and the frontend types
cannot drift apart unnoticed.

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

All of these are settled decisions.

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
critical-security floor rather than by its computed priority carries
`pinned_by_floor: true`, so the UI can say why a row is there even at the minimum
`security` weight of 0.1.

## Path conventions

**Auth paths are provider-neutral.** `/api/auth/login`, `/api/auth/callback`,
`/api/auth/session` and `/api/auth/logout` carry no provider segment, because which
sign-in method a user picks is Asgardeo's business.

**Past snapshots.** `GET /api/repos/{repo_id}/health?snapshot_id=` loads a stored
snapshot into the dashboard. `GET /api/healthz` is an operational liveness probe,
outside the product surface.

Path parameters are **snake_case** (`{repo_id}`), matching every other field name on
the wire.

## Implementation status

The backend enforces the contract:

- session-cookie authentication, with only `/auth/login`, `/auth/callback` and
  `/healthz` public (`security: []` in the spec marks exactly those three)
- `{ detail, code, errors[] }` on every error, with `code` drawn from the `ErrorCode` enum
- snake_case field names on the wire

A rendered view of the contract is in [openapi.html](openapi.html).
