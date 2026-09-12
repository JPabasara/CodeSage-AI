# Mid-evaluation — what we built, what we did not, and why

*Group 16 · CS3203 · Code Sage AI · revised 28 Aug 2026 · internal revision sheet, not a deliverable.*

**The rule for this document and for the evaluation itself:** nothing is called *done*
when it is a skeleton. Where something is designed and stubbed, it says so. Being caught
overstating costs more than any gap admits.

---

## 1. What the product is, in 30 seconds

**Code Sage AI is a technical-debt dashboard.** You connect a public GitHub repository,
we scan it, and we return:

- a **health score 0–100** and a letter **grade A–E**
- a list of **findings** — specific problems in specific files, ranked worst-first
- a **heat-map** of which files carry the most debt
- a **history** of how the score moved between scans

The point is not "here are 500 problems". The point is **"fix these five first"** — the
ranking is the product.

**v1.0 analyses Java only.** Not a shortcut, a consequence: CK, our metric extractor, is
a Java-only tool. Scanning a Python repo succeeds and finds nothing.

---

## 2. What works today — demonstrate it, do not describe it

**Live now:** <https://codesageai.dev> · API <https://api.codesageai.dev>

The demo is one path, and it runs on a real URL rather than on a laptop:

```
sign in  →  connect a repository  →  pick a branch  →  run a scan  →  see the dashboard
```

Walk it live. What the marker sees actually happen:

| Step | What is real |
|---|---|
| **Sign in** | Real OIDC through Asgardeo with GitHub federated inside it. Real `httpOnly` cookie over real HTTPS |
| **Connect a repo** | A row written to Neon Postgres, isolated by workspace |
| **Pick a branch** | Live branch names fetched from the GitHub API, not a fixture |
| **Run a scan** | Queued to Upstash Redis, picked up by the worker, real `git clone` at an immutable commit, CK metrics, Tree-sitter comments, PyDriller history, rule engine, SATD classification |
| **Watch progress** | Phase from Postgres, percentage from Redis, polled by the browser. Cancel works between stages |
| **See the dashboard** | Score, grade, ranked findings, heat-map, scan history — all from rows the scan wrote |

**Three honest qualifications to state up front, before anyone finds them:**

1. **The scores are not yet calibrated.** The mechanism is complete; the constant `k`
   that converts debt density into 0–100 has never been fitted against repositories we
   have an opinion about. Demonstrate the *ranking*, which does not depend on `k`.
2. **The frontend has rough edges.** Loading flashes, a few layout glitches at narrow
   widths, and dashboard states that are correct but not polished. Known, listed in §12.
3. **This deployment is strategic, not final.** Railway + Neon + Upstash was chosen to
   prove the system runs off a laptop and to unblock the demo. The final hosting
   decision is deliberately still open — see §11.3 for why that is a design property.

---

## 3. What is designed but not built — said plainly

Say these before you are asked. Each costs one sentence and buys the credibility of
everything else in the document.

| Item | Exact status |
|---|---|
| **ML-2, the bug-risk model** | **Trained and evaluated, wired on a branch, not merged and not deployed.** On `main`, `detection/risk/client.py` raises `NotImplementedError`, so `risk_factor` is a constant 1.0 and boosts nothing |
| **The trained SATD artifact in the live `ml` container** | The image ships an **empty `models/` directory** — artifacts are mounted, not baked in. With no volume attached, `/classify` answers from a **keyword fallback**, not the trained model. **Read `model_version` in the response, never the HTTP status** |
| **`/readyz` and `/version`** | Written, documented, **return 501**. Mounted outside `/api` so they are never mistaken for product surface |
| **Score calibration (`k`)** | Formula built, constant unfitted. The calibration method is written down; the golden repositories have never been named |
| **Playwright in CI** | 48 end-to-end tests exist and pass locally. **The CI `web` job runs Vitest only** — E2E is not yet a required check |
| **Worker ↔ ML contract check** | The frontend has `gen:types:check` against the contract. This boundary has no equivalent; `schemas.py` is frozen by agreement, not by a test |
| **Languages beyond Java** | Tree-sitter was chosen so this is grammar work, not a rewrite. No second grammar exists yet |

---

## 4. The architecture, and why

**A modular monolith with an asynchronous worker and one extracted ML service.**
The boundaries are drawn around **workload**, not domain.

```
browser ──HTTPS──▶  api :8000  ──▶ postgres          worker ──HTTP──▶ ml :8001
   │                    │                               │                │
   │                    └──▶ redis ──enqueue────────────┘          /models (mounted)
   └── httpOnly session cookie
```

Six containers locally, but count them honestly: `postgres` and `redis` are
infrastructure; `web` is the frontend; **`api` and `worker` are the same image started
with a different command**; `ml` is inference.

### Why not microservices

Four reasons, and they are reasons rather than preferences:

1. **One bounded context.** Repository, scan, finding and score are one story. Splitting
   them would mean maintaining the same shapes on both sides of a network boundary.
2. **Finishing a scan must be one transaction.** A half-saved snapshot is forbidden.
3. **Row-Level Security needs one database** to key tenant isolation on.
4. **A dashboard read joins everything at once** — findings, files, metrics, profile.

We split where the *workload* differs, which is exactly twice: scanning is long-running
so it became a worker, and inference is optional so it became a service. Nothing else.

### The two ideas worth memorising

**1. Store facts, derive opinions.** The worker stores what was *true* of the code: this
file, this finding, this severity, this category. It never stores a score. **Scores are a
function of facts and a profile**, so changing your weighting re-ranks everything with no
re-scan.

> **Refinement shipped 27 Aug:** deriving on *every* read was too slow on large repos, so
> a derived score is now computed once per `(snapshot, profile_fingerprint)` and cached in
> `SNAPSHOT_SCORE`. The principle is unchanged — the cache is keyed by the profile, so
> moving a slider produces a different fingerprint and a fresh calculation. Facts are
> still the only thing stored; the opinion is memoised, not persisted as truth.

**2. Pipe and filter, with a cancel check between stages.**

```
clone → extract → detect → finalize
```

A scan is never "analyse this URL". The API first creates an **attempt row**; the worker
then carries out that attempt. That is what makes a cancelled scan *structurally* unable
to produce a snapshot.

---

## 5. Decisions we reversed, and why

Each of these is written down in the repository, with a date. Present them as evidence
that the design was tested rather than assumed.

| Reversal | Why | Record |
|---|---|---|
| **Sign-in moved out of the browser and into the backend** | Running Asgardeo inside Next.js protected the *pages* and left the *API* wide open — anyone could call the API directly. FastAPI now completes the whole code-for-token exchange | `deployment-implementation-log.md` |
| **Six debt categories became five** | `defect_debt` exists in the real dataset but **not in SATDAUG**, so the model can never predict it. We removed the category rather than ship one nothing could populate | `satd/labels.py`, `model-evaluation-notes.md` §3 |
| **Profiles stopped being versioned** | A row per Apply was write amplification with no reader — the contract cannot express or return a version. Applying now updates one row in place; the `version` column was dropped | `data-model-decisions.md` D-4 (16 Aug) |
| **`WORKSPACE.active_profile_id` became `SCORING_PROFILE.is_active`** | The foreign-key version made a profile switch satisfy **two** RLS policies at once. A partial unique index does the same job in one table | `data-model-decisions.md` locked decision 11 |
| **Railway must not build from the repository** | Building from source discards the exact images CI tested, so what runs would not be what passed. CI publishes; CI then tells Railway to pull | `team-plan-to-mid-evaluation.md` §5 |
| **ML-2 reported ROC-AUC was corrected *downward*, by us** | The first run mapped AEEEM columns onto our feature vector by position. Code churn is not `wmc`; version count is not `dit`. Correcting it dropped mean ROC-AUC from 0.7086 to **0.6183** | `risk_architecture_rationale.md` |
| **The SATD evaluation was thrown out and redone** | 0.99 F1 was data leakage. See §10 — this is the strongest single item we have | `model-evaluation-notes.md` |

> The last two are worth leading with. **We are the ones who found them, and we published
> numbers that went down.** That is what separates a measured result from a reported one.

---

## 6. How the work is divided

| Folder | Owner | What it is |
|---|---|---|
| `apps/web/` | **Janidu** | The Next.js dashboard |
| `apps/api/` | **Chamodh** | FastAPI, the scan worker, the database, scoring |
| `apps/ml/` | **Nathasha** | The models, training and the inference service |
| `infra/`, `.github/`, **all Dockerfiles** | **Janidu** | Deployment and CI |

**The rule that makes parallel work possible: two people never edit the same file.**
Dockerfiles live inside `apps/api/` and `apps/ml/` but belong to whoever does deployment.

**There is exactly one shared file — `docs/api/openapi.yaml`, the API contract.** Nobody
edits it alone; a change to it is its own pull request with no code in it, approved by
both other people.

That contract is why the frontend was built *before* the backend answered. It already
says what every field is called and what every endpoint returns. It defines **16
operations**, and it is machine-checked in CI on the frontend side.

---

## 7. Janidu — frontend, authentication, containers, CI, deployment

### 7.1 The frontend

| | |
|---|---|
| Framework | **Next.js** (App Router) + **TypeScript** |
| Styling | **Tailwind** + **shadcn/ui** · Charts **Recharts** |
| Mocking | **MSW** (Mock Service Worker), three modes |
| Tests | **Vitest** (111 unit tests) + **Playwright** (48 E2E across 8 journeys) |

**Screens shipped:** login, projects, dashboard, finding detail, scan history, profiles.

Three things to be able to say:

1. **Types are generated, never hand-written.** `pnpm gen:types` produces
   `src/lib/types/api.ts` from `openapi.yaml`, and CI runs `gen:types:check` **first**,
   before tests. The build fails the moment the frontend and the contract disagree. You
   cannot drift from the contract by accident.
2. **MSW let the frontend ship before the backend existed.** A service worker intercepts
   every `fetch()` and answers from fixtures. Three modes: fully mocked, mocked data with
   real sign-in, fully real.
3. **Sign-in can never be mocked.** A service worker can intercept `fetch()` but **not a
   full-page navigation** — and OIDC is exactly that. The sign-in button is therefore a
   plain `<a href>`, never a `fetch`.

**Every view has four states** — loading skeleton, data, empty, error with a working
Retry. Getting all four right is what separates a demo from a prototype. Where the demo
still shows glitches (§12), it is polish on top of four working states, not a missing state.

### 7.2 Authentication — the section most likely to be probed

**The API is the Backend-for-Frontend.** Sign-in runs through **Asgardeo**, which has
**GitHub federated inside it**.

> **FastAPI completes the sign-in exchange. Not Next.js. Not the browser.**

```
browser ──▶ /api/auth/login ──▶ Asgardeo ──▶ GitHub ──▶ /api/auth/callback
                                                              │
              the code-for-token exchange happens HERE, server-side, with PKCE
                                                              │
browser ◀── httpOnly cookie holding only an opaque session id ┘
```

Because GitHub is federated *inside* Asgardeo, **we never run a GitHub OAuth exchange and
never hold a GitHub token.** Adding Google or password login later is a setting in the
Asgardeo console, not new code.

| Control | Why it exists |
|---|---|
| Code exchange **server-side, with PKCE** | The client secret never reaches the browser |
| Tokens **stay in the backend** | No token ever touches client JavaScript |
| Cookie is **httpOnly** | An XSS bug cannot steal the session |
| Cookie is **Secure** | Never sent over plain HTTP |
| Cookie is **SameSite=Lax** | Another site cannot make the browser send it — our CSRF defence |
| Sessions are **database rows** | Sign-out **deletes the row**, so revocation is immediate. A signed token could not be revoked |
| **Postgres Row-Level Security** | One workspace can never read another's rows |

**Two things that sound like security and are not:**

**The Next.js middleware is not authorization.** It redirects anyone without a session
cookie — but the cookie is `httpOnly`, so the edge can only check that it **exists**.
*The middleware is a redirect for the common case; the API is the security boundary*, and
it checks the session on every single request. Say that sentence exactly.

**Unauthenticated routes — only three:** `/api/auth/login`, `/api/auth/callback`,
`/api/healthz`. Everything else returns **401** without a valid cookie.

**RLS, the subtle part.** Every tenant table has RLS enabled and `FORCE`d. The trap we
avoided: *RLS is silently ignored for a table owner.* If the application connected as the
database owner, isolation would do nothing while appearing to work perfectly. So there are
**two roles** — migrations run as the owner, the application connects as a **non-owner**.

### 7.3 Containers, CI and deployment

**The idea that shaped everything:** *get the project deployable anywhere, and the choice
of host becomes a small decision you can change later.* If a clean machine that has never
seen your laptop can build and run the images, any host can. If it only builds on your
machine, you do not have a deployment — you have a laptop.

```
push → CI: web · api · ml tests → build 3 images → push to GHCR → tell Railway to pull
```

**Hosting:** Railway (`web`, `api`, `worker`, `ml`) · **Neon** (Postgres) · **Upstash**
(Redis). Migrations run as a pre-deploy command; a merge to `main` deploys.

**Two deployment lessons worth repeating:**

- **We bought a real domain early, and it was not cosmetic.** Every `*.up.railway.app`
  address is on the **public suffix list**, so a frontend and backend on two Railway
  subdomains are two *sites* to a browser — and a `SameSite=Lax` cookie would never have
  been sent between them. **The domain was a prerequisite for authentication working at all.**
- **The CK jar bug.** The jar was gitignored, so the published image could not run a scan
  even though every build was green. *CI checked what the code says and never checked what
  the artefact does.* It now fetches and smoke-tests the jar at build time.

---

## 8. Chamodh — the API, the scan pipeline, the database, scoring

**FastAPI** for the API, **Celery + Redis** for the worker, **PostgreSQL** for data.

### 8.1 The endpoints that matter

| Endpoint | What it does |
|---|---|
| `GET`/`POST /api/projects` | list / connect a repository |
| `GET /api/repos/{id}/branches` | real branch names from GitHub |
| `POST /api/repos/{id}/scan` | queue a scan, returns **202** and an id |
| `GET /api/repos/{id}/scan/{scan_id}` | poll phase and percentage |
| `POST .../scan/{scan_id}/stop` | cancel between stages |
| `GET /api/repos/{id}/health` | the dashboard — score, grade, ranked findings |
| `GET /api/repos/{id}/scans` | scan history, across branches |
| `GET`/`PUT /api/profiles/active` | the weighting profile — **implemented, no longer 501** |

### 8.2 The four rules the code obeys

1. **Detection and scoring happen on the server.** If a number on screen cannot be traced
   to a database row or a function of those rows, it does not go on screen.
2. **Store facts, derive opinions** — §4.
3. **Scoring is a pure function.** No database, no I/O, no clock. Enforced by
   **import-linter contracts that run in CI** — the architecture is a test, not a promise.
4. **Severity is system-owned; weights are user-owned.** A user changes how much a
   category *counts*, never how bad a finding *is*.

### 8.3 The scan pipeline, end to end

`clone` at an immutable commit into an isolated directory → `extract` (CK product metrics,
Tree-sitter comments, PyDriller process metrics) → `detect` (metric rules, method-level
rules, security rules loaded from the database, then SATD classification) → `finalize`
(one transaction writing the snapshot).

Two details that are easy to get wrong and worth knowing:

- **Phase comes from PostgreSQL, percent comes from Redis, neither comes from Celery.**
  The task result backend is deliberately switched off: a scan outcome is the attempt row
  and its snapshot, not a task return value.
- **Rule definitions and security rules load from the database**, so tuning a rule is a
  data change, not a release.

**Degraded mode is implemented, not aspirational.** `scan_pipeline.py` wraps the SATD call
in a handler that logs *"SATD classifier unavailable; completing scan in degraded mode"*
and continues with an empty prediction list. The scan still completes and still writes a
valid snapshot.

### 8.4 The database

Postgres with Alembic migrations, a **single migration head guarded by a CI check** (we
hit a duplicate-revision merge and added the guard), RLS on every tenant table with the
non-owner application role, and a security audit table. Reproducible analysis-tool
versions are recorded on each scan, so a result can be correlated with what produced it.

### 8.5 Where the API is honestly incomplete

- `/readyz` and `/version` return **501**
- `detection/risk/client.py` raises `NotImplementedError` on `main` (ML-2 unmerged)
- `detection/satd/client.py` uses a hardcoded `timeout=30.0` and never reads
  `settings.ml_timeout_seconds`
- `ruff` on `apps/api` is **advisory** in CI, with roughly 31 findings outstanding

---

## 9. Nathasha — the models

Two models, one container, on `:8001`. **`ml` is called only by the worker** — never by
the API process, never by the browser.

| | **ML-1 — SATD classifier** | **ML-2 — bug risk** |
|---|---|---|
| Question | "Is this comment admitting debt, and what kind?" | "How bug-prone is this file?" |
| Input | a batch of code comments | per-file metric vectors |
| Output | `is_debt` + one of four categories + confidence | `risk_score` 0–1 |
| Dataset | the real SATD corpus, plus **SATDAUG** for training | **D'Ambros / AEEEM** |
| Technique | Tree-sitter → TF-IDF → calibrated Linear SVM | Random Forest + probability calibration |
| Status | **trained; wired into the pipeline; artifact not in the live image** | **trained and evaluated; wired on an unmerged branch** |

**SATD = Self-Admitted Technical Debt** — debt the developer confessed to in a comment,
like `// TODO: this is a hack, fix before release`.

### 9.1 Five design decisions to be able to defend

1. **It is a service, not a library.** No database, no domain logic, one caller.
2. **Feature extraction is not in it.** CK, Tree-sitter and PyDriller all run in the
   worker. The ML service receives comments and numbers and returns labels and scores.
3. **Artifacts are mounted, not baked into the image.** Replacing a model is "drop the
   file in, restart" — no rebuild, no code change. *The cost of that choice is the gap in
   §3: with nothing mounted, the service silently falls back to a keyword matcher.*
4. **Training is offline and never deployed.** The Dockerfile omits the training
   dependencies entirely. The deployed service **cannot train, by construction**.
5. **Degraded mode — the best answer in this document.** If `ml` is down, **the scan still
   completes and still stores a valid snapshot.** Every rule finding is present, no SATD
   findings appear, no risk score is recorded, and scoring treats a missing score as
   neutral. **Less information, not a failure.** That degradation is *the reason it is a
   separate container* — across a network boundary "unavailable" is a **mode the pipeline
   handles**; in-process it would be an exception that takes the worker down with it.

**Consequence for the plan: the ML work never blocked the demo.**

### 9.2 Two invariants worth stating

**A missing score is `null`, never `0.0`.** `null` means *never assessed*; `0.0` would
mean *assessed and found safe*. Collapsing the two would let the dashboard paint an
unassessed file with the confidence of a measured one.

**`security` is never predicted.** The classifier has four categories; the product has
five. `security` comes only from the rule engine, because it is not in the training data.

### 9.3 Why each tool was chosen

- **Tree-sitter** parses to a syntax tree rather than searching for `//`, so a `//` inside
  a string literal is not mistaken for a comment. It also has grammars for many languages,
  which is what makes "add Python" grammar work rather than a rewrite.
- **TF-IDF** weights discriminative tokens — `todo`, `fixme`, `workaround` — above common
  ones, and produces the sparse high-dimensional vectors a linear model handles best.
- **Linear SVM**, chosen by measurement rather than preference (§10.3), wrapped in
  `CalibratedClassifierCV` **because the API contract requires a `confidence` in 0–1** and
  a bare `LinearSVC` emits an unbounded decision distance instead. *Picking an algorithm
  is an interface decision, not only an accuracy one.*

---

## 10. Model results so far — per class, with counts. Never accuracy.

### 10.1 The data-leakage finding — lead with this

Our first SATD model reported **97% accuracy and F1 of 0.99**. Those numbers were not real,
and **we are the ones who found that out.**

**What happened.** The real corpus is badly imbalanced. SATDAUG fixes this by
*augmentation* — rewording 54 documentation-debt comments into 2,701 machine-generated
copies. That is a legitimate technique, and building SATDAUG was not the mistake.

**The mistake was splitting the data after padding.** `train_test_split` shuffled all
68,512 rows, so **about 44 copies of one sentence went into training and about 11 copies
of that same sentence went into the test set.** The model was graded on reworded versions
of sentences it had already studied. It measured memory, not ability.

**How we proved it — the part worth telling:**

| Class | Real rows | Padding | F1 reported |
|---|---|---|---|
| `code/design_debt` | 2,703 | **none** | **0.72** |
| `requirement_debt` | 757 | 3× | 0.84 |
| `test_debt` | 85 | 31× | 0.98 |
| `documentation_debt` | 54 | 55× | **0.99** |

**More padding gave a higher score, every time, in exact order.** That ordering is
impossible if the model is genuinely learning — rare, messy classes should score *worst*.
The one class with no padding scored 0.72, the only honest number in the table, and it
matches what published SATD research reports.

**Never report accuracy on imbalanced data.** 85% of that test set was `non_debt`, so a
model that always answers "not debt" and never thinks scores **0.850**. Our 0.97 was a
gain of **+0.12**, not a triumph.

> **One line to remember:** *augmentation is a training technique; it must never appear in
> a test set.*

### 10.2 The fix, and it is the stronger version

`training/satd/train.py` now splits with **`GroupShuffleSplit` grouped by `projectname`**,
and filters the test set to `status == 'ori'`. So:

- train and test share **no project**, let alone no sentence
- the test set contains **only real, untouched developer comments**
- the training half keeps its augmented rows, which is where they belong

Training on some projects and testing on projects the model has never seen is exactly what
happens in production when a user connects a new repository.

**The real class counts, which is what honesty here looks like:**

| Class | Real comments |
|---|---|
| `non_debt` | 58,204 |
| `code/design_debt` | 2,703 |
| `requirement_debt` | 757 |
| `defect_debt` (dropped — absent from SATDAUG) | 472 |
| `test_debt` | **85** |
| `documentation_debt` | **54** |

**Say this out loud:** *documentation debt cannot be evaluated reliably — only 54 real
examples exist, across 6 projects.* That is a finding, not a failure. The 0.99 was hiding it.

**Still outstanding:** the per-class report from the corrected run is **not yet checked
into `training/reports/`**. Do not quote a corrected per-class F1 until it is.

### 10.3 ML-1 model selection — measured, on unaugmented data

Three candidates, 62,275 real comments, 80/20 split:

| Candidate | Precision | Recall | **Macro F1** | Weighted F1 | Train | Inference / 1k |
|---|---|---|---|---|---|---|
| Logistic Regression | 0.73 | 0.68 | 0.71 | 0.94 | 3.4 s | 1.5 ms |
| **Linear SVM (selected)** | **0.78** | **0.73** | **0.75** | **0.95** | **2.1 s** | **1.2 ms** |
| Random Forest | 0.62 | 0.49 | 0.58 | 0.91 | 48.2 s | 82.0 ms |

**Read macro F1, not weighted F1.** Weighted F1 is 0.94–0.95 for everything because
`non_debt` dominates. Macro F1 is the number that reflects the minority debt classes,
which are the ones the product exists to find.

### 10.4 ML-2 — bug risk, evaluated leave-one-project-out

**D'Ambros / AEEEM:** 5,371 classes, **853 defective (15.9%)**. Split
leave-one-project-out, so every test project is entirely unseen.

| Held-out project | Classes | Defective | ROC-AUC | PR-AUC | F1 @0.5 | Brier | Latency |
|---|---|---|---|---|---|---|---|
| `equinox` | 324 | 129 (39.8%) | 0.6773 | 0.5218 | 0.0000 | 0.3117 | 35.0 ms |
| `jdt` | 997 | 206 (20.7%) | 0.6723 | 0.4295 | 0.0000 | 0.1553 | 38.8 ms |
| `lucene` | 691 | 64 (9.3%) | 0.6579 | 0.2828 | 0.0000 | 0.0861 | 34.8 ms |
| `mylyn` | 1,862 | 245 (13.2%) | 0.5251 | 0.1391 | 0.0000 | 0.1155 | 56.8 ms |
| `pde` | 1,497 | 209 (14.0%) | 0.5588 | 0.1645 | 0.0000 | 0.1217 | 47.5 ms |
| **Mean** | **5,371** | **853 (15.9%)** | **0.6183** | **0.3075** | **0.0000** | **0.1581** | **42.6 ms** |

**Three things to say, in this order:**

1. **Mean ROC-AUC 0.6183 is a modest prototype signal, not production-grade defect
   prediction.** 0.5 is a coin flip. We are above it, and not by much.
2. **F1 at the default 0.5 threshold is 0.0000, and we are not hiding it.** The product
   consumes the *continuous ranking* score, not a binary label — but this model must not
   be presented as a useful binary classifier until a threshold is chosen on validation data.
3. **Why it is weak is known, specifically.** Our AEEEM mirror has no CK product metrics,
   no 90-day commit count and no recency. Only **2 of the 13 features** — author count and
   file age — have matching production semantics; the other 11 positions are neutral.
   **We refused to fill them with lookalike AEEEM columns**: code churn is not `wmc`, and
   version count is not `dit`. Doing exactly that is what produced the earlier, wrong 0.7086.

That last point is the whole answer to "why is it only 0.62": **the model is honest about
being fed two features, rather than dishonest about being fed thirteen.**

---

## 11. The health score, deployment and scaling

### 11.1 The formula

```
finding_priority = base_points × category_weight × source_trust × churn_factor × risk_factor
file_debt        = Σ finding_priority
repo_health      = 100 × (1 − min(1, Σ file_debt / (k × KLOC)))
grade            = A ≥ 85 · B ≥ 70 · C ≥ 55 · D ≥ 40 · E < 40
```

Five factors, five separate questions, each with exactly one owner, so nothing is counted
twice:

| Factor | The question | Who decides |
|---|---|---|
| `base_points` | how bad is it? | the system (rule register) |
| `category_weight` | what type is it? | the user (5 sliders) |
| `source_trust` | rule or model? | the user (1 slider) |
| `churn_factor` | how hot is this file? | measured from git history |
| `risk_factor` | how fragile is this file? | the ML model — **currently 1.0, ML-2 unmerged** |

Those are the **six numbers** on the Profiles page. **Dividing by KLOC** removes repo size
so you compare debt *density*; `k` is *the debt-per-1000-lines at which health hits zero*.

**Be honest about `k`.** It is uncalibrated, and **a bad `k` fails silently** — too small
and every repo grades E, too large and every repo grades A, and neither looks like a bug.
The method is written down: scan a handful of **golden repositories** we have an opinion
about *before* measuring them, then solve for the `k` that puts them where our judgement
says they belong. It is a **sanity check against human judgement**, not an optimisation.

> **Do not quote a health score as meaningful until `k` is recalibrated.** The mechanism is
> built and the constant is pending — a much stronger answer than a confident number you
> cannot defend. **The ranking does not depend on `k`, and the ranking is the product.**

### 11.2 Scaling — three concurrent scans is a setting, not a rewrite

| Concern | How it is handled |
|---|---|
| Many scans at once | **Competing consumers.** The API enqueues one job to Redis; N workers compete for it. `--scale worker=3` gives three concurrent scans **with no code change** |
| Services keep no state | Sessions are **database rows**, not memory — any instance serves any request |
| Dashboard reads stay fast | The summation runs **in SQL, not in Python**, and the derived score is cached per `(snapshot, profile)` |
| A slow scan blocking the UI | Scanning is **asynchronous** — 202 immediately, then the browser polls |
| Swapping a model | Artifacts are **mounted** — a file drop and a restart |
| Recalibrating the score | Every constant is **loaded from config** — a config change, not a release |

### 11.3 Why "strategic, not final" is a design property

Railway, Neon and Upstash were chosen to get a real URL fast. **Nothing in the code knows
about any of them.** Every setting comes from an environment variable, nothing reads
`os.environ` directly, images are published to GHCR and pullable by `latest` and
`sha-<commit>`, and the platform's only integration point is "pull this image, run this
command, then run migrations".

Moving to a different host is a configuration exercise. **That was the goal, and it is met** —
which is precisely why the final hosting decision can stay open without costing anything.

---

## 12. Quality — what CI checks, and what it does not

**A red pull request cannot be merged.** Six required checks, one review, no bypass.

| Job | What it actually runs |
|---|---|
| `web` | **contract check first** (`gen:types:check`), then typecheck, lint, 111 Vitest unit tests |
| `api` | single-migration-head guard, **import-linter layer contracts**, migrations + constraints + tenant-isolation tests against a real Postgres, 134 tests, ruff (advisory) |
| `ml` | tests, ruff (advisory) |
| `images` | builds `web`, `api`, `ml`; the `api` build **fetches and smoke-tests the CK jar** |
| `deploy` | on `main` only — tells Railway to pull, `api` first because it migrates |

**What the tests cover:** the scoring engine as a pure function, rule evaluation and
fingerprinting, CK and process-metric parsing, clone isolation and cleanup, scan lifecycle
and cancellation, RLS tenant isolation against a real database, the dashboard read side,
and 48 Playwright journeys covering auth, projects, branches, scan, dashboard, history,
profiles and navigation.

**What they do not cover, plainly:**

- **Playwright does not run in CI.** The 48 E2E tests are a local gate, not a merge gate.
- **No test asserts an end-to-end scan on the deployed stack.** CI proves the images build
  and the code passes; it does not prove the deployed worker produced a correct snapshot.
- **No contract test between the worker and the ML service.**
- **No calibration test**, because there is no calibrated `k` to assert against.
- **`ruff` on `apps/api` is advisory**, so roughly 31 style findings can still merge.

**The lesson we keep re-learning, and it is the CK jar again:** *CI checked what the code
says and never checked what the artefact does.* Every gap above is a version of that.

---

## 13. What is next, and what we deliberately deferred

**Next, in order:**

1. **Merge `improve/ml2-risk-model`**, so `risk_factor` stops being a constant 1.0.
2. **Mount the trained SATD artifact** on the live `ml` service, and verify by reading
   `model_version` — not the HTTP status.
3. **Check in the corrected per-class SATD report**, so the honest numbers are quotable.
4. **Calibrate `k`** against named golden repositories, and name them in the repo.
5. **Reconstruct the missing ML-2 features** — CK metrics and commit-anchored process
   metrics — which is the single largest available model-quality gain.
6. **Put Playwright in CI**, and add a smoke scan against the deployed stack.
7. **Implement `/readyz` and `/version`**, and clear the ruff backlog.

**Deliberately deferred, with the reason:**

| Deferred | Why it was the right call |
|---|---|
| Languages beyond Java | CK is Java-only. A second language needs a grammar, a rule pack **and** a fresh `k` — a whole release, not a feature |
| Transformer models for SATD | Adds training cost, inference latency and a GPU dependency to a service that must not stretch a scan. TF-IDF plus a linear model is what SATD research supports |
| Team management / multi-user workspaces | The nav item was removed rather than left as a dead stub. RLS already keys on workspace, so the data model is ready when the feature is |
| Versioned profiles | Write amplification with no reader — §5 |
| A final hosting decision | §11.3 — the portability is the deliverable; the host is a setting |
| Polishing the dashboard before the pipeline was real | A polished view of fabricated numbers proves nothing |

---

## 14. Questions we expect, with the answers

**"What actually works right now?"**
Sign in, connect a repo, pick a branch, run a real scan, watch progress, cancel, see the
dashboard — on `codesageai.dev`, end to end. What is *not* trustworthy yet is the absolute
score, because `k` is uncalibrated, and the risk factor, because ML-2 is unmerged.

**"Why not microservices?"**
One bounded context; finishing a scan must be one transaction; RLS needs one database; a
dashboard read joins everything at once. We split on *workload*, not domain — which is why
the worker and the ML service are separate and nothing else is.

**"Why are `api` and `worker` the same image?"**
They share the domain model, the ORM and the data contract. Splitting them means
maintaining the same shapes on both sides of a network boundary for no benefit.

**"Where is authentication actually enforced?"**
In the API, on every request. The Next.js middleware only redirects; it cannot validate an
`httpOnly` cookie and is never the security boundary.

**"What stops one customer seeing another's data?"**
Postgres Row-Level Security, with the app connecting as a **non-owner** role so the
policies are not silently bypassed for the table owner.

**"What if the ML service goes down?"**
The scan completes and stores a valid snapshot with rule findings only. Less information,
not a failure — and that is implemented, not planned. It is why `ml` is a separate container.

**"How accurate is your model?"**
Decline the framing, politely: accuracy is the wrong metric on data that is 85% one class.
Then give per-class figures with counts, the ML-2 LOPO table, and the leakage we found and
fixed. **This is our strongest material, not our weakest.**

**"Your ML-2 ROC-AUC is only 0.62."**
Correct, and we published that number after correcting our own earlier 0.71. Our AEEEM
mirror supports only 2 of 13 features with matching production semantics, and we refused
to fill the rest with lookalike columns. Reconstructing those features is the next
model-quality task, and we know exactly what it is and why it comes first.

**"Why don't you store the score?"**
It is an opinion, not a fact. Storing it would mean re-scanning every time a user moved a
slider. We store facts and derive the score, cached per `(snapshot, profile)`.

**"Why Java only?"**
CK is Java-only. Adding a language needs a Tree-sitter grammar, a per-language rule pack,
and a recalibration of `k`.

**"How would you scale to many users?"**
Add workers — competing consumers, no code change. Nothing is kept in memory, so instances
are interchangeable. `--scale worker=3` is a setting.

**"Is this the final deployment?"**
No, and deliberately. Every setting is an environment variable, images are published to a
registry, and nothing in the code knows it is on Railway. Moving hosts is configuration.

**"What is the weakest part?"**
Two things. `k` is uncalibrated, so the absolute score is not defensible yet — but the
*ranking* does not depend on `k`, and the ranking is the product. And ML-2 is a modest
prototype signal, for a reason we can name precisely.

---

## 15. If you remember only five sentences

1. **We store facts and derive opinions** — scores are a function of facts and a profile,
   so changing a profile re-ranks instantly with no re-scan.
2. **The API is the Backend-for-Frontend** — it runs the whole sign-in exchange, keeps the
   tokens, and the browser gets only an `httpOnly` session id.
3. **The ML service is separate so that "unavailable" is a mode, not an exception** — the
   scan completes without it, and that is implemented rather than planned.
4. **Our first model 0.99 was data leakage, we proved it by showing the scores tracked the
   padding ratio exactly, and we published corrected numbers that went down.**
5. **CI builds the images, tests them, publishes them, and Railway pulls them** — so what
   runs is exactly what passed, and the host is a setting rather than a dependency.
