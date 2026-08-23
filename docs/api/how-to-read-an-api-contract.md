# How to read an API contract

*A general guide, using our own `openapi.yaml` as the example. Not a deliverable.*

---

## What a contract is

**One file that says what every request and every answer looks like** — written before either side is finished.

It is not code. Nothing runs it. It is an agreement, so the frontend can be built before the backend answers, and the backend knows what to build without asking.

Ours is `docs/api/openapi.yaml`. Read it in a browser rather than as raw YAML:

```bash
npx @redocly/cli build-docs docs/api/openapi.yaml -o docs/api/openapi.html
```

---

## The file has two halves

| Half | What lives there |
|---|---|
| **`paths:`** | The endpoints — every URL you can call |
| **`components:`** | The reusable shapes — objects, enums, standard errors |

The second half exists so a shape is written **once** and pointed at from many places.

---

## An endpoint = a path + a method

```
GET /api/repos/{repo_id}/health
└┬┘ └──────────┬───────────────┘
 │             └─ the path (which thing)
 └─ the method (what you want to do to it)
```

The same path with a different method is a **different endpoint**:

| | |
|---|---|
| `GET /api/profiles/active` | read the active profile |
| `PUT /api/profiles/active` | replace the active profile |

The four you will meet: **GET** read · **POST** create or start · **PUT** replace · **DELETE** remove.

---

## Anatomy of one endpoint

Our dashboard endpoint, taken apart line by line:

```yaml
/api/repos/{repo_id}/health:         # the path. {repo_id} is a blank you fill in
  get:                               # the method
    operationId: get_health_report   # unique name; code generators use it
    summary: The full dashboard payload    # the one-line title in the docs
    description: |                         # the long explanation
      Every score here is computed on this request...
    parameters:
      - name: branch
        in: query                    # goes in the URL after ?
        required: true               # you MUST send it
      - name: snapshot_id
        in: query
        required: false              # optional
    responses:
      '200': ...                     # what you get when it works
      '401': ...                     # when you are not signed in
      '404': ...                     # when it does not exist
```

Called for real, that becomes:

```
GET /api/repos/8f3a.../health?branch=main
```

### Two kinds of parameter

| Kind | Where it goes | Example |
|---|---|---|
| **path** | inside the URL itself | `{repo_id}` → `/api/repos/8f3a.../health` |
| **query** | after the `?` | `?branch=main&snapshot_id=...` |

Path parameters are always required — they are part of the address. Query parameters may be optional.

---

## Response codes — the three-digit numbers

Read the **first digit** first:

| Starts with | Meaning | Whose fault |
|---|---|---|
| **2xx** | It worked | — |
| **3xx** | Go somewhere else | — |
| **4xx** | Your request was wrong | **the caller** |
| **5xx** | The server broke | **the server** |

The ones our API actually uses:

| Code | Means | Example from our API |
|---|---|---|
| **200** | OK, here is the data | The dashboard payload |
| **201** | Created | A repository was connected |
| **202** | Accepted — started, not finished | A scan was queued; poll for the result |
| **204** | Done, nothing to return | Signed out |
| **302** | Go to this other address | Sign-in redirects you to Asgardeo |
| **400** | Your request was malformed | |
| **401** | You are not signed in | Every endpoint but three |
| **403** | Signed in, but not allowed | Someone else's workspace |
| **404** | Not found | No such repository or branch |
| **409** | Conflicts with the current state | A scan is already running |
| **422** | Understood, but the values are invalid | A weight of `9.0` |
| **429** | Too many requests | GitHub rate limit hit |
| **503** | A service we depend on is down | Asgardeo or GitHub unreachable |

**401 vs 403** is the pair people confuse:
*401 = I do not know who you are.* *403 = I know who you are, and no.*

**202 is the interesting one.** It means "I have started, come back later". Our scan endpoint returns it with a `scan_id`, and the client polls until the phase becomes `done`, `error` or `cancelled`.

---

## The error shape

**Every non-2xx response in our API has the same three fields.** That is deliberate — one shape to handle, not a surprise per endpoint.

```json
{
  "detail": "A scan is already running for this branch.",
  "code": "SCAN_ALREADY_RUNNING",
  "errors": [ { "field": "weights.security", "detail": "must be 0.1-3.0" } ]
}
```

| Field | For | Rule |
|---|---|---|
| `detail` | **humans** | Show it on screen. The wording may change at any time |
| `code` | **your code** | A fixed constant. Its meaning never changes |
| `errors` | forms | Only on validation failures — says which field was wrong |

### The one rule worth memorising

> **Switch on `code`, never on `detail`.**

```javascript
if (error.code === "SCAN_ALREADY_RUNNING") { ... }    // safe forever
if (error.detail === "A scan is already running")     // breaks on a typo fix
```

`detail` is a sentence someone will reword. `code` is a promise.

### Our error codes

```
NOT_AUTHENTICATED        FORBIDDEN               NOT_FOUND
INVALID_REPOSITORY_URL   REPOSITORY_NOT_PUBLIC   REPOSITORY_UNREACHABLE
ALREADY_CONNECTED        SCAN_ALREADY_RUNNING    SCAN_NOT_CANCELLABLE
VALIDATION_FAILED        RATE_LIMITED            UPSTREAM_UNAVAILABLE
INTERNAL_ERROR
```

New ones may be added. Existing ones never change meaning — so handling an unknown code gracefully is your job, not the server's.

---

## Response schema — the shape of the answer

A **schema** describes an object: which fields exist, their types, and which are guaranteed.

```yaml
required: [id, name, weights, trust_s, is_preset, is_active]
additionalProperties: false
properties:
  id:       { type: string, format: uuid }
  trust_s:  { type: number, minimum: 0, maximum: 1 }
```

Three words that matter:

| Word | Meaning |
|---|---|
| **`required`** | This field is **always** there. Anything not listed may be missing |
| **`additionalProperties: false`** | No extra fields, ever. If it is not listed, it does not exist |
| **nullable** (`type: [number, "null"]`) | The field is there, but its value may be empty |

**"Missing" and "null" are not the same thing**, and our contract uses the difference deliberately:

```
risk_score: 0.0     the model ran and found no risk
risk_score: null    the model did not run at all
```

Reporting `0.0` when you meant "we do not know" is a lie the dashboard cannot detect.

---

## `$ref` — "the shape defined over there"

```yaml
schema: { $ref: '#/components/schemas/HealthReport' }
'401':  { $ref: '#/components/responses/NotAuthenticated' }
```

`$ref` means **reuse**. `HealthReport` is written once and pointed at from wherever it is returned. Change it in one place and every endpoint using it changes with it.

In the HTML docs you never see `$ref` — the viewer expands it for you.

---

## Security — who may call what

Ours is one line at the top of the file:

```yaml
security:
  - sessionCookie: []
```

That means **every endpoint requires a valid session cookie**, unless it says otherwise. Exactly three opt out with `security: []`:

- begin sign-in
- the sign-in callback
- the health check

You cannot require a session on the endpoints whose job is to create one.

Browser callers must send `credentials: "include"` on every request — a cross-origin `fetch` drops cookies unless you ask for them. Forget it and everything returns 401.

---

## Reading one endpoint, start to finish

Use this order on any endpoint you meet:

1. **Path and method** — what am I doing to what?
2. **Summary** — one line: is this the one I want?
3. **Parameters** — what must I send, and where does it go?
4. **Request body** — only on POST and PUT
5. **200 response** — what shape comes back when it works?
6. **The other codes** — what can go wrong, and what will I get?

Worked example:

```
GET /api/repos/{repo_id}/health?branch=main

I must send:  repo_id in the path, branch in the query, and the session cookie
I get back:   200 with a HealthReport
Can fail as:  401 not signed in - 403 not my workspace - 404 never scanned
```

That is the whole endpoint. Nothing else to know before writing the call.

---

## Why the contract is worth the discipline

- The frontend is built against it **before the backend answers** — nobody waits.
- `pnpm gen:types` turns it into TypeScript types, so a field the backend renamed becomes a **compile error**, not a blank space on screen during the demo.
- `pnpm gen:types:check` fails the moment the file and the generated types disagree.

The contract is the agreement. Change it in its own pull request, with both other people looking — never quietly alongside code.
