# Progress evaluation — preparation

**Group 16 · Project ID 7 · CS3203 · 13 Aug 2026**

Everything you might be asked, with an answer you can defend. Read §0 and §1 first — those two
sections cover most of a viva. The rest is depth to fall back on.

> **Rule for the whole session:** never claim something is done when it is a skeleton. §2 is the
> honest status. Saying *"that part is designed and stubbed, not implemented"* costs you nothing;
> being caught overstating costs you everything.

---

## Contents

| § | Section |
|---|---|
| 0 | [Sixty-second answers](#0-sixty-second-answers) |
| 1 | [Why this product exists](#1-why-this-product-exists) |
| 2 | [Where we actually are today](#2-where-we-actually-are-today) |
| 3 | [Why this architecture](#3-why-this-architecture) |
| 4 | [The six containers](#4-the-six-containers) |
| 5 | [Tool choices — why X and not Y](#5-tool-choices--why-x-and-not-y) |
| 6 | [Design patterns and principles](#6-design-patterns-and-principles) |
| 7 | [How we meet the functional requirements](#7-how-we-meet-the-functional-requirements) |
| 8 | [How we meet the non-functional requirements](#8-how-we-meet-the-non-functional-requirements) |
| 9 | [Defending the thresholds and severities](#9-defending-the-thresholds-and-severities) ← *the hard one* |
| 10 | [Testing strategy](#10-testing-strategy) |
| 11 | [How ML accuracy is measured](#11-how-ml-accuracy-is-measured) |
| 12 | [Scaling and challenges](#12-scaling-and-challenges) |
| 13 | [Known gaps — say these before they find them](#13-known-gaps) |
| 14 | [Quick-fire answer bank](#14-quick-fire-answer-bank) |

---

## 0. Sixty-second answers

If you only memorise one section, memorise this one.

| Question | One-breath answer |
|---|---|
| **What is it?** | A web dashboard that scans a public Java repository and tells a small team *which three files to fix first*, with a one-sentence reason for each. |
| **Why not SonarQube?** | SonarQube tells you *what is wrong* — thousands of issues, one fixed opinion of what matters. We tell you *what to fix first*, under **your** team's priorities, and we read the debt developers admitted in their own comments, which no mainstream tool classifies. |
| **What's the technical novelty?** | Three signals fused into one ranking: deterministic rules, an NLP classifier over code comments (SATD), and an ML bug-proneness model — combined by a **pure scoring function** the user can re-shape instantly without re-scanning. |
| **What architecture?** | A **modular monolith** with an asynchronous worker and one extracted stateless inference service. Split by *workload*, not by domain. Not microservices. |
| **Why not microservices?** | One bounded context, one schema. Our core invariant — a snapshot and its findings commit atomically — is a database transaction. Splitting it makes that a distributed saga for no benefit, and breaks Row-Level Security. |
| **How do you keep the UI responsive?** | The scan never runs in the HTTP request. The API enqueues to Redis, returns a scan ID in under a second, and the client polls once per second while Celery workers do the work. |
| **How can a profile change re-rank without re-scanning?** | The database stores **facts**; every score is **derived on read**. Changing a weight changes six numbers on one row, and the next read recomputes. No snapshot is written. |
| **Can ML override a critical security finding?** | No — and that's provable. The maximum combined ML+churn boost is 5×; the gap between Low (1 point) and Critical (8 points) is 8×. The model can re-order within a severity band, never across one. |
| **How do you test ML?** | Precision, recall, F1 **per class**, plus ROC-AUC for the risk model. Never accuracy — the classes are heavily imbalanced, so accuracy would reward a model that always says "no". |
| **What's your biggest risk?** | The calibration constant `k` in the health formula is still a placeholder, so grades are currently relative, not absolute. It's scheduled, and it's a config value, not a code change. |

---

## 1. Why this product exists

### 1.1 The problem, stated concretely

A small agile team inherits or grows a codebase. Technical debt accumulates invisibly.
When they finally run a quality tool, they get **4,000 issues on the first scan** — and they
do nothing, because 4,000 issues is not a plan. This is the well-documented "wall of issues"
failure: the tool is correct and useless at the same time.

Two things are missing from that experience:

1. **Ranking that reflects the team.** A fintech team and a startup racing to launch should not
   see the same order. Every mainstream tool gives everyone the same quality gate.
2. **The debt developers already told you about.** Every codebase contains
   `// FIXME: this isn't thread-safe` and `// TODO: hardcoded for the demo`. That is the highest-quality
   debt signal that exists — a developer *admitting* the problem, in prose. Mainstream tools treat
   these as a flat regex smell, if at all. They don't ask *what kind* of debt it is.

### 1.2 How we differ — the four claims

| # | Claim | What competitors do | What we do |
|---|---|---|---|
| 1 | **Self-Admitted Technical Debt is classified, not just found** | SonarQube flags `TODO` as a generic code smell via regex | An NLP classifier (ML-1) decides *is this debt* and *what type* — code-design, requirement, documentation, or test — from the comment's natural language, including comments with no marker keyword at all |
| 2 | **Prioritisation is user-shaped** | One fixed quality gate for everyone | Five category weights + one trust slider. A security-led team and a delivery-led team see the **same findings in a different order**, with no re-scan |
| 3 | **Debt is fused with bug-proneness** | Static analysis only — no prediction | An ML model (ML-2) scores each file 0–1 for bug-proneness from CK metrics + git history, and that score **multiplies** the priority of the findings in that file |
| 4 | **Low-noise by construction** | 4,000 issues, unranked | At most 10 findings in the initial view (U-4), ranked by priority, each with a one-sentence plain-English reason (FR-16) |

### 1.3 The honest boundary — say this before they ask

> *"We are not competing with SonarQube on rule coverage. They have hundreds of rules across
> thirty languages; v1.0 has six rules and Java only. Our contribution is the **prioritisation
> layer** — SATD classification, risk fusion, and a user-configurable lens — which is orthogonal
> to rule count. In principle our engine could consume SonarQube's findings as an additional
> source and still add value."*

That sentence turns "you have only six rules" from a weakness into a scoping decision.

### 1.4 Why the one-line reason matters

Every finding carries a sentence generated from a **string template**, never from text generation:

> `charge() has cyclomatic complexity 18, over the limit of 15 — split it into smaller functions.`

Three properties fall out: it is **instant** (no model call), **reliable** (cannot hallucinate),
and **explainable** (the number and the threshold are both visible). This is a deliberate rejection
of an LLM for this job. Say so — it shows judgement rather than technology-chasing.

---

## 2. Where we actually are today

### 2.1 Component status

*Updated 15 Aug 2026 against `origin/chamodh/backend` @ `a1e6e5e`.*

| Component | Branch | State | Evidence |
|---|---|---|---|
| **Frontend** | `docs/srs`, `main` | **Working prototype** against a mock backend | 67 TypeScript files, **25 unit tests across 11 files, all passing**, 3 Playwright E2E specs |
| **Mock backend (MSW)** | same | **Working** — 9 handlers intercept at the network boundary | `src/lib/mocks/handlers.ts` |
| **Backend API** | `chamodh/backend` | **Complete skeleton, not implemented.** Layered, every architectural decision documented in-code | ~90 `raise NotImplementedError` — a contract skeleton awaiting bodies |
| **Database** | `chamodh/backend` | Models **and the first migration** written, covering the whole ERD | `alembic/versions/20260812_0001_complete_erd.py` |
| **Multi-tenancy (RLS)** | `chamodh/backend` | Two-role bootstrap **and** the policies, **plus a cross-tenant test** | `infra/postgres/init/01-init.sql`, `tests/integration/test_rls.py` (166 lines) |
| **Scoring engine** | `chamodh/backend` | Formula + config split done; one unit-test file written | `scoring/formula.py`, `tests/unit/scoring/test_formula.py` |
| **API contract** | `docs/srs` | **Written and verified.** OpenAPI 3.1, 16 operations, generates TypeScript that type-checks | `docs/api/openapi.yaml` |
| **Async pipeline** | `chamodh/backend` | Celery app, cancel and progress modules laid out; the pipeline body is a stub | `apps/api/src/codesage_api/tasks/` |
| **ML models** | — | **Not trained.** Service interface and schemas defined | `apps/ml/models/` is empty |
| **Auth** | `chamodh/backend` | Asgardeo integrated **in the frontend only**. The API is still unauthenticated — being fixed now | `apps/web/proxy.ts` exists; `apps/api` has no session check |
| **Deployment** | `chamodh/backend` | Six-container compose file written with healthchecks | `infra/docker-compose.yml` |
| **Documents** | `docs/srs` | SRS and SAD at **v1.1**; the Markdown copies are generated from the `.docx` | `docs/Deliverables/{SRS,SAD}/v1.1/` |

> **If asked about authentication, say this plainly:** *"Asgardeo is integrated on the
> frontend and the API is not yet protected. We caught it in review, and the fix — moving
> the whole OIDC exchange into FastAPI as the Backend-for-Frontend — is specified in
> SRS v1.1 SEC-17 to SEC-20 and is the current task."* Volunteering it costs nothing;
> being caught by a `curl` costs a lot.

### 2.2 How to frame this in one sentence

> *"We built the frontend first against a frozen data contract with a mock backend, so the UI is a
> working, testable product today. The backend is a complete architectural skeleton — every module,
> every layer boundary, every design decision is in place and machine-enforced — with the handler
> bodies as the remaining work. That order was deliberate: it de-risked the part with the most
> unknowns, the user experience, before committing to backend implementation."*

### 2.3 What you can demo right now

1. **The dashboard** — health card, category pie, trend chart, Refactor-First list, hotspot file tree
2. **A scan** — click Scan, watch the progress state machine, see the result land
3. **Branch switching** — re-scoped trend and findings
4. **The Celery PoC** — `docker compose up`, run `trigger.py`, watch a job enqueue and report live progress
5. **The tests** — `pnpm test:run` (25 green), `pnpm test:e2e`
6. **The architecture enforcement** — `lint-imports` fails the build if scoring imports a database

Item 6 is worth demoing. It is unusual for a student project and it lands well.

---

## 3. Why this architecture

### 3.1 Name it precisely

> **A modular monolith with an asynchronous worker and one extracted stateless inference service.**
> Internally: layered, with a pipe-and-filter pipeline, competing consumers over a message broker,
> and a deliberate write-path / read-path separation.

Do not say "microservices". Do not say "just a monolith". The precise name is the answer.

### 3.2 The five styles, stacked

| Style | Where it shows |
|---|---|
| **Modular monolith** | One codebase (`apps/api`), one schema. `api` and `worker` are **the same image** with a different command. Module boundaries are enforced by import-linter contracts in CI, not by network calls |
| **Layered** | `presentation (apps/web) → application/domain (routers → services → scoring) → data (repositories → Postgres)`. Dependencies point one way, enforced by a `layers` contract |
| **Pipe and filter** | The scan: `clone → extract → detect → finalize`. Each stage transforms and hands on; the cancel check sits *between* filters |
| **Competing consumers** | The API produces one job to Redis; N workers compete for it. This is why "3 concurrent scans" is `--scale worker=3` and not a code change |
| **Read/write path separation** | The worker writes facts and stops. The API derives every score on read. They never meet. Not full CQRS (one database, no event sourcing) but the same principle |

### 3.3 Why not microservices — the four arguments that cannot be waved away

1. **One bounded context.** `Repository → Branch → AnalysisAttempt → Snapshot → Finding` is a single
   tightly-joined graph. Microservices pay off when parts of a business change for different reasons,
   at different rates, owned by different teams. We have one domain and three people.

2. **Our central invariant is a database transaction.** DBR-22 requires the snapshot, findings,
   metrics and predictions to commit **atomically or not at all**. In a monolith that is
   `BEGIN … COMMIT`. Split across services it becomes a distributed saga with compensating actions,
   and we would have to invent a rollback for "half a snapshot" — exactly the state FR-6 forbids.

3. **Row-Level Security needs one database.** Tenant isolation is a Postgres policy keyed on
   `workspace_id`. That works because everything tenant-owned lives under one policy set. Sharded
   across services, RLS stops being one mechanism and becomes five separate correctness arguments.

4. **A dashboard read joins everything at once.** Snapshot + findings + metrics + risk + profile,
   then one in-memory scoring pass. Across services that is a four-way network fan-out, and the
   read-latency risk gets much worse.

Add the organisational point last: *"Microservices solve a team-coordination problem we don't have.
Fowler's own guidance is monolith-first."*

### 3.4 The modularity is machine-enforced — this is the strongest thing you can show

Three contracts in `apps/api/pyproject.toml` fail CI when broken:

```toml
# 1. The scoring engine is a pure function.
name = "scoring is pure — no db, no web, no queue, no io"
forbidden_modules = [db, routers, services, tasks, integrations,
                     sqlalchemy, fastapi, celery, httpx]

# 2. Workers write facts; they never compute scores.
name = "workers never score"
source_modules = [tasks, extractors, detection]
forbidden_modules = [scoring]

# 3. Layers point downward only.
layers = [routers, services, db]
```

Say: *"These aren't comments. They're build failures. Normally 'the scoring function must stay pure'
survives about three sprints. Here it survives because the compiler enforces it."*

---

## 4. The six containers

```
        ┌──────────────┐        ┌──────────────┐
        │     web      │        │    redis     │
        │   Next.js    │        │   broker +   │
        │    :3000     │        │  progress    │
        └──────┬───────┘        └──────┬───────┘
               │ HTTPS/JSON            │ Redis protocol
               ▼                       │  (private network)
        ┌──────────────┐        ┌──────┴───────┐        ┌──────────────┐
        │     api      │───────▶│    worker    │───────▶│      ml      │
        │   FastAPI    │ enqueue│    Celery    │  HTTP  │   FastAPI    │
        │    :8000     │        │  (same image │        │    :8001     │
        └──────┬───────┘        │   as api)    │        └──────┬───────┘
               │                └──────┬───────┘               │
               │        SQL/TLS        │                       │ read-only
               ▼                       ▼                ┌──────┴───────┐
        ┌──────────────────────────────────┐            │   /models    │
        │           postgres               │            │  (mounted    │
        │  facts only — never scores       │            │   volume)    │
        └──────────────────────────────────┘            └──────────────┘

  Published to the host:  web (3000), api (8000)
  Private network only:   postgres, redis, ml
```

| # | Container | Image | Job | Why it exists as its own container |
|---|---|---|---|---|
| 1 | **web** | Next.js | Renders the dashboard. Computes nothing — it maps stored strings to colours and renders numbers the API derived | Frontend is always separately deployed; it's static-servable and scales differently |
| 2 | **api** | FastAPI | Answers HTTP. Owns the **read path**: it runs the scoring engine on every dashboard request. Also the **BFF** — it holds the Asgardeo session server-side | The public surface. Must stay responsive, so it never does long work |
| 3 | **worker** | **same image as api**, different command | Runs the scan pipeline: clone → extract → detect → finalize. Writes facts, never scores | Scans take minutes. Running them in the API would block the request and violate PERF-05. Scaling `--scale worker=3` satisfies PERF-07 |
| 4 | **ml** | FastAPI (separate image) | Inference only: `POST /classify` (ML-1), `POST /risk` (ML-2), `GET /version` | See §4.2 — this is the one worth explaining properly |
| 5 | **postgres** | postgres:16-alpine | Durable truth. Facts, append-only snapshots, RLS tenant isolation | Infrastructure |
| 6 | **redis** | redis:7-alpine | Two jobs: Celery **broker**, and **ephemeral progress** (`NN%`) | Infrastructure |

### 4.1 The detail that shows you understand it

**`api` and `worker` are literally the same image.**

```yaml
api:
  build: ../apps/api
worker:
  build: ../apps/api
  command: celery -A codesage_api.worker worker --concurrency=1
```

That is what makes it a monolith rather than two services: one codebase, one deployment artifact,
two run modes. It is also why "add a scan endpoint" never requires coordinating two releases.

**Phase lives in Postgres, percentage lives in Redis.** Losing a percentage when the broker restarts
costs nothing — the next poll produces a new one. Losing *the fact that a scan failed* would breach
SP-13, which requires the terminal phase and its error message to be recoverable from the database
alone. So each fact lives in the store whose guarantees match its importance.

### 4.2 Why `ml` is a separate container — and why that is *not* microservices

Is it a microservice? **No.** It owns no data, no bounded context, no business capability. It is a
function you happen to call over HTTP.

Four reasons to extract it, honestly ranked:

1. **Degraded mode becomes expressible.** If the ML service is unreachable, the scan still completes
   and persists a valid snapshot — all rule and security findings present, no SATD findings, no risk
   scores. In-process, "ML unavailable" is an exception you catch; across a boundary it is a **mode**
   you design for.
2. **Lifecycle.** Models retrain on a completely different cadence from application code. Artifacts
   are **mounted, not baked in** — swapping a model is dropping a file and restarting, not a rebuild
   (SP-14).
3. **Dependency weight.** scikit-learn and model artifacts stay out of the API image.
4. **Scaling axis.** Inference is CPU-bound and stateless; scans are disk- and IO-bound. Separate
   containers let you scale whichever is actually the bottleneck.

> **Be honest when asked:** *"Doing inference in-process would also have been defensible and is
> simpler to debug. We chose the boundary specifically to make degraded mode real. Reason 4 barely
> matters at our scale — I wouldn't lead with it."*

That answer — giving the strongest counter-argument to your own decision — is what a viva rewards.

**Where the `.pkl` files live:** training happens offline in `apps/ml/training/` and is **never
deployed** (the ML Dockerfile deliberately does not install the training dependencies). The trained
artifact is mounted into the `ml` container at `/models` as a read-only volume. The API image never
sees a model.

---

## 5. Tool choices — why X and not Y

For each: the alternative, the reason we rejected it, and the honest cost of our choice.

### 5.1 PostgreSQL — *not* MySQL, MongoDB, or SQLite

| Alternative | Why not |
|---|---|
| **MySQL** | **No native Row-Level Security.** Tenant isolation (DBR-3) would move into application code, where one forgotten `WHERE workspace_id = …` is a cross-tenant data leak. This single point decided it |
| **MongoDB** | Our data is a joined graph: `Repository → Branch → AnalysisAttempt → Snapshot → Finding`. A document store would force either duplication or `$lookup` everywhere. And DBR-22 needs multi-table atomicity, which is Postgres's home ground |
| **SQLite** | No concurrent writers — multiple workers would serialise. No RLS. Fine for the prototype, wrong for the product |

**Positive reasons:** ACID transactions across tables (DBR-22, REL-05); `JSONB` where we genuinely
want schemaless evidence blobs; mature SQLAlchemy + Alembic tooling; free and self-hostable.

**Honest cost:** one database is the scaling ceiling (§12).

### 5.2 Redis — *not* RabbitMQ, Kafka, or a database queue

| Alternative | Why not |
|---|---|
| **RabbitMQ** | A better *pure* broker — but we don't need AMQP routing. One queue, one task type. And it cannot double as the progress cache, so we'd operate two dependencies |
| **Kafka** | Built for replayable event streams at enormous scale. We have three concurrent jobs. The operational cost (ZooKeeper/KRaft, partitions, retention) buys us nothing |
| **Postgres as a queue** | Would put scan-polling load on the same database serving the dashboard, and we'd hand-roll the retry/ack semantics Celery gives us free |

**Positive reason:** one dependency does two jobs — broker *and* ephemeral progress store.

**Licence note, in case they ask:** we pin **Redis ≤ 7.2 or Valkey (BSD 3-Clause)**. Redis 7.4+ moved
to RSALv2/SSPL. The SRS licensing table records this. Knowing that detail is a good look.

### 5.3 Celery — *not* FastAPI BackgroundTasks, RQ, or Dramatiq

| Alternative | Why not |
|---|---|
| **FastAPI `BackgroundTasks`** | Runs **in the API process**. A minutes-long scan would occupy an API worker and die on restart. Fails PERF-05 and REL-02 outright |
| **RQ** | Simpler, but weaker retry/scheduling and a smaller ecosystem |
| **Dramatiq / arq** | Fine choices; Celery's documentation and maturity mattered more for a student team |

**Positive reasons:** `task_acks_late` (worker crash → job re-queued, not lost); built-in retry with
backoff (REL-04 needs ≥3 retries); horizontal scale by replicas; `task_always_eager` makes it testable
with no broker at all.

### 5.4 FastAPI — *not* Django, Flask, or Node/Express

| Alternative | Why not |
|---|---|
| **Django** | Brings an ORM, admin and template engine we don't need. Its ORM is also less convenient for the per-transaction `SET LOCAL app.workspace_id` that RLS requires |
| **Flask** | Needs half a dozen extensions to reach parity on validation, async and OpenAPI |
| **Node/Express** | Would split the project across two languages. Backend + workers + ML in one language means one toolchain, one set of tests, one skill set |

**Positive reasons:** Pydantic gives us **automatic OpenAPI generation** — and the contract is a
first-class artifact for us, since the frontend's types are generated from it. Native async for
GitHub calls. `mypy --strict` across the whole codebase.

### 5.5 CK — *not* Lizard, and this one is important

We **switched from Lizard to CK**, and the reason is the strongest tool argument we have.

> **ML-2 trains on the D'Ambros bug-prediction dataset, whose feature set *is* CK metrics** — WMC,
> CBO, LCOM, DIT, RFC. If we extracted features with Lizard (which gives CCN and NLOC but no OO
> coupling or cohesion metrics), the training features and the inference features would be
> different. That is **train/serve skew**: the model would return plausible-looking numbers computed
> from the wrong columns, and nothing would fail loudly.

**Honest cost:** CK is Java-only, and that is *why v1.0 is Java-only*. It is a Java `.jar` run as a
subprocess, not a pip package — the Dockerfile installs it. Adding a language means a new metric
extractor, a new Tree-sitter grammar, a per-language rule pack, and a recalibration of `k`.

### 5.6 Tree-sitter — *not* regex, not a Java-specific parser

| Alternative | Why not |
|---|---|
| **Regex** | A regex for `//` matches inside string literals — `String url = "http://example.com";` would be extracted as a comment. Comments must be identified **structurally**, from the AST |
| **JavaParser** | Java-only. Tree-sitter is grammar-per-language, so adding Python later is adding a grammar, not writing a parser |

### 5.7 PyDriller — *not* raw `git log` or GitPython

Gives the four process metrics — churn, author count, file age, recency — as first-class concepts,
and handles renames and merge traversal correctly. Doing it on raw `git log` output is possible and
is exactly the code you don't want to be debugging the week before a demo.

### 5.8 scikit-learn — *not* PyTorch, TensorFlow, or a transformer

| For | Choice | Why not deep learning |
|---|---|---|
| **ML-1 (SATD text)** | TF-IDF → linear classifier | The SATD literature repeatedly shows plain text models perform well here. A transformer adds training cost, a GPU dependency, and inference latency to a service that must not stretch scan time. *CodeBERT is a documented stretch goal, not the v1.0 plan* |
| **ML-2 (risk, tabular)** | Tree ensemble (RF / gradient boosting) | Deep learning does not beat gradient boosting on small tabular data. This is the standard, defensible choice for defect prediction |

**Deployment reason too:** a `.pkl` is a mounted file. A transformer is hundreds of megabytes plus a
GPU, in a container that must start fast.

### 5.9 Asgardeo — *not* our own login, Auth0, or Keycloak

| Alternative | Why not |
|---|---|
| **Build our own** | We would own password hashing, reset emails, verification, lockout policy and breach response. SEC-08, SEC-09 and SEC-10 all become *our* code to defend, to reimplement something that already exists |
| **Auth0** | Commercial pricing past the free tier |
| **Keycloak** | Self-hosted — another container, another database, another thing to operate and back up |

**Positive reasons:** free tier; standards-based (OIDC); **GitHub is federated inside Asgardeo**, so
the application is an OIDC client of one provider and never performs a GitHub OAuth exchange itself.
Adding Google or username/password later is a **console toggle, not new code** — which matters
because v2 brings viewers and stakeholders who may not have GitHub accounts.

**What we store after federation:** `asgardeo_sub`, email, display name, avatar. **No passwords, no
GitHub tokens, no provider secrets.** SEC-08 and SEC-09 become nearly free — you cannot leak a
credential you never hold.

**Honest risk:** it is a hosted dependency. If Asgardeo is down, nobody signs in. REL-01 explicitly
excludes external-service outages, and that exclusion is in the requirement text.

### 5.10 Docker — and why containers are not optional here

The worker needs **Python + git + a JVM** (for CK). The API needs Python. The ML service needs
scikit-learn but explicitly *not* the training stack. Containers turn that into three Dockerfiles
instead of a setup wiki nobody follows. G7 in the SAD requires it, and it is what makes
`--scale worker=3` a one-line answer to PERF-07.

---

## 6. Design patterns and principles

### 6.1 Patterns actually present in the code

| Pattern | Where | Why |
|---|---|---|
| **Repository** | `db/repositories/` — `attempts.py`, `findings.py`, `profiles.py`, `snapshots.py` | Services talk to repositories, never to the ORM directly. Makes the service layer testable without a database |
| **Gateway / Adapter** | `integrations/github.py`, `integrations/ml_service.py`, `detection/satd/client.py` | Every volatile external system sits behind exactly **one** boundary — SP-6. Replacing GitHub with GitLab is a single-file change |
| **Service layer** | `services/` — `analysis.py`, `dashboard.py`, `profiles.py`, `auth.py` | Routers stay thin: parse, authorise, delegate, serialise |
| **Pipe and filter** | `tasks/scan_pipeline.py` — `clone → extract → detect → finalize` | Stages don't know about each other; the cancel check sits between filters |
| **Producer–consumer / competing consumers** | API → Redis → N workers | Concurrency is a deployment parameter, not a code change |
| **Functional core, imperative shell** | `scoring/` is pure; `services/` does the I/O | The core is exactly unit-testable. Enforced by import-linter |
| **Registry** | `detection/rules/registry.py`, `ml/registry.py` | Rules and models are looked up, not hard-wired |
| **Data Transfer Object** | `schemas/*.py` (Pydantic) separate from `db/models/*.py` (ORM) | The wire shape and the storage shape evolve independently |
| **Dependency injection** | FastAPI `Depends` in `deps.py` | Session, current user and workspace context are injected, so tests substitute them |
| **Factory + cached singleton** | `get_settings()` and `load_satd_model()` under `@lru_cache`; the FastAPI app factory in `main.py` | Config read once; a model deserialised once at startup, not per request |
| **Template method (as data)** | `message_template` in `register.yaml` | One template per rule, values interpolated — FR-16 |

### 6.2 Principles, with the concrete evidence

| Principle | Evidence in this project |
|---|---|
| **Single Responsibility** | Each of the five scoring factors is one function answering one question, with exactly one owner |
| **Open/Closed** | **Adding a rule is one YAML row plus one message template — no engine change** (SP-17). Adding a detector is a new `source` value |
| **Dependency Inversion** | Services depend on repository interfaces; the scoring engine depends on nothing at all |
| **Separation of concerns** | Enforced by CI, not convention — the three import contracts |
| **Configuration over code** | Thresholds, base points, presets and `k` all live in YAML. SP-8: *recalibration is a config change, not a release* |
| **Single source of truth** | The data contract crosses frontend, backend and database; the rule register is the one place severity is decided |
| **Immutability / append-only** | Snapshots are never updated. That is what makes the trend chart and `delta` trustworthy |
| **Idempotency** | `PUT /api/profiles/active` carries the complete profile, never a delta — so a retry after a dropped response cannot half-apply |
| **Fail closed** | RLS: the app connects as a **non-superuser, non-owner** role, because a superuser silently bypasses every policy |
| **Least privilege** | GitHub access is read-only; no per-user OAuth token is persisted; the DB role has no DDL rights |

### 6.3 The one principle that defines the product

> **The database stores facts. Every opinion is derived on read.**

`severity` and `category` are facts, written once at detection. `priority`, `debt_score`,
`health_score`, `grade`, `delta` and the category breakdown are **opinions** — functions of the
active profile — and are recomputed on every request.

Why it matters: a stored score would be stale the moment a weight changed, or would have to be
*updated*, which would break the append-only immutability the trend chart depends on. Deriving
removes both failure modes and is precisely why a profile change re-scores with no re-scan.

If you can explain that paragraph clearly, you have explained the architecture.

---

## 7. How we meet the functional requirements

### 7.1 The mechanism for each significant FR

| FR | Requirement | Mechanism |
|---|---|---|
| **FR-1** | Authentication | Asgardeo OIDC (GitHub federated). FastAPI is the BFF: it completes the flow, keeps tokens server-side, hands the browser an httpOnly session cookie |
| **FR-2** | Tenant isolation | `workspace_id` on every tenant-owned table + Postgres RLS keyed on `current_setting('app.workspace_id')`, bound per transaction with `SET LOCAL` |
| **FR-3/4** | Connect + list repositories | `POST /api/projects` validates the URL and reads GitHub metadata. v1.0 is public repos by URL paste |
| **FR-5** | Branch selection | GitHub REST with **ETag-conditional requests**, so a repeat read usually costs no rate-limit quota |
| **FR-6** | Async, cancellable scan | API enqueues to Redis and returns `202` + `scan_id` in <1s. Client polls 1/s. **Cancellation is cooperative** — a Redis flag read *between* pipeline stages, never mid-write |
| **FR-7** | Extraction | CK (product metrics) + PyDriller (process metrics) + Tree-sitter (comments), all from a local clone at the scanned SHA |
| **FR-8** | Rule engine | Six rules in `register.yaml`; two mechanisms (metric-threshold, regex/entropy pattern) in one engine pass |
| **FR-9** | SATD classifier | ML-1 over extracted comments. Predicts **category only**; severity comes from the deterministic marker table |
| **FR-10** | Risk model | ML-2 per file, 0–1. Produces **no findings** — it multiplies the priority of findings already there |
| **FR-11** | Scoring | Pure function, five factors, all constants in YAML. No I/O, no clock |
| **FR-12–18** | Dashboard | One `GET /health` response carries all six outputs, every number derived under the active profile |
| **FR-19** | Scan history | Append-only snapshots; only **successful** scans are addressable |
| **FR-20** | Profiles | Five weights + trust slider. Explicit **Apply**, one idempotent `PUT`, server-side clamp, returns what was stored |
| **FR-21** | Snapshot persistence | Facts stored, scores derived. Enforced by the "workers never score" import contract |
| **FR-24** | Critical-security floor | **Three independent mechanisms** — see §9.4 |

### 7.2 Three FR answers worth rehearsing

**"How does cancellation work if the worker is mid-scan?"**
> Cooperatively. Stop sets a Redis flag and returns immediately — it does not kill the worker. The
> worker checks the flag **between** pipeline stages and stops at the first boundary. Once
> finalization begins it completes, because FR-6 requires the previous snapshot to survive a
> cancellation intact and a killed write would leave a partial one. The cost is that a user who
> presses Stop waits until the current stage ends. That is a deliberate trade: correctness over
> immediacy.

**"How is a re-scan of the same commit reproducible?"**
> The 90-day churn window is anchored to the **scanned commit's committer date**, never to
> `now()`. Wall-clock time is not an input to scoring at all. So scanning the same SHA six months
> later produces the identical score — which is what makes REL-10 testable and the skip-if-unchanged
> optimisation sound.

**"Why does a profile change not create a new snapshot?"**
> A snapshot is keyed by commit SHA and records what the code *was*. A profile is not a commit. If a
> profile change wrote a snapshot, the trend chart would show a step on a day nobody touched the
> code — the line would read *"the codebase got worse"* when it means *"we changed our mind about
> what matters"*. That would invalidate both `delta` and the trend.

---

## 8. How we meet the non-functional requirements

### 8.1 Performance

| ID | Target | How the architecture delivers it |
|---|---|---|
| **PERF-01** | Feedback within 0.1s | Client-side state change on click; no round trip needed to acknowledge |
| **PERF-02** | Non-analysis interaction <1s | Reads are one database round trip + an in-memory scoring pass (a few thousand multiply-adds) |
| **PERF-03** | Job queued within 1s | The API inserts one row and publishes to Redis, then returns. It does no work |
| **PERF-04** | Progress for >10s operations | Poll `GET …/scan/{id}` once per second; phase from Postgres, percentage from Redis |
| **PERF-05** | Non-blocking analysis | Scans run on Celery workers, never in the HTTP request. **This is the architecture's primary driver** |
| **PERF-06** | 50 workspaces | One Postgres, connection pooling, indexed reads |
| **PERF-07** | ≥3 concurrent analyses | `docker compose up --scale worker=3`. Not a code change |
| **PERF-08** | Degraded under load | Queued jobs don't block reads — auth, navigation and history come from Postgres regardless of queue depth |

### 8.2 Reliability — and the availability question

**First, correct the number.** The SRS says **99% monthly** (REL-01), not 99.9%. Do not quote 99.9%
in the room — the document says otherwise and that contradiction is exactly what a panel catches.

| | Downtime allowed per month |
|---|---|
| **99%** (our target) | ~7.2 hours |
| 99.9% | ~43 minutes |

**The defence, in order:**

1. **It is a design target, not a measured SLA.** We have no production traffic to measure against.
   Presenting it as anything else would be dishonest.
2. **The requirement excludes what we don't control.** REL-01 explicitly excludes planned maintenance
   and outages caused by required external services (GitHub, Asgardeo). Those exclusions are in the
   requirement text.
3. **What makes 99% achievable architecturally:**
   - API and workers are **stateless** — they restart cheaply, losing nothing
   - `task_acks_late` means a worker crash **re-queues** the scan rather than losing it
   - REL-02: one repository's failure cannot block others, because each scan is an isolated Celery task
   - REL-04: ≥3 retries on transient faults before an attempt is marked failed
   - Healthchecks on Postgres and Redis; dependent containers wait for them
   - REL-05: results are committed atomically, so a crash mid-scan leaves the previous snapshot intact
4. **Why we did *not* claim 99.9%.** That would need multi-AZ Postgres with automatic failover, at
   least two API replicas behind a load balancer, and Redis Sentinel or clustering. We have none of
   those. Claiming a number the deployment cannot support would be the wrong kind of ambition.

> **The line to use if pushed:** *"99% is what this architecture actually supports today. Reaching
> 99.9% is a deployment change, not an architecture change — HA Postgres and multiple API replicas —
> and we deliberately didn't claim it because we can't currently demonstrate it."*

### 8.3 Security

| ID | Mechanism |
|---|---|
| **SEC-01** | Every endpoint except `/auth/login`, `/auth/callback` and `/healthz` requires a session |
| **SEC-03** | Postgres RLS on `workspace_id` — enforced in the database, not only in application code |
| **SEC-05** | GitHub access is read-only; public clones are anonymous; no per-user token is persisted |
| **SEC-08/09** | No passwords, no OAuth tokens in our database. The httpOnly cookie is unreadable by JavaScript, so an XSS bug cannot steal it |
| **SEC-10** | The session is **server-side**, so sign-out revokes it immediately. A stateless JWT could not be revoked without a denylist — which is most of a session store anyway |
| **SEC-11** | Pydantic validates every request body at the edge |
| **SEC-16** | All error mapping lives in **one file** (`errors.py`), which is what makes "no stack traces, no SQL, no internal hostnames on the wire" auditable rather than aspirational |

### 8.4 Usability, supportability, maintainability

- **U-4 (low noise):** at most 10 findings in the initial view, ranked
- **U-6 (explainability):** ≤140 characters, one sentence, from a template
- **U-7/U-8 (accessibility):** WCAG 2.1 AA contrast; colour is never the sole carrier of meaning — every heat-map tint is accompanied by a numeric score and a letter grade
- **SP-8:** thresholds and weights are configuration, never literals
- **SP-12:** every log line carries the scan ID, so one scan is traceable across API, broker, worker and ML service
- **SP-13:** the terminal phase and error message are written to the **database**, so a user-reported failure is diagnosable without reading logs
- **SP-15:** every snapshot records `model_version`, so trend points before and after a retraining remain comparable

---

## 9. Defending the thresholds and severities

> This is the question you flagged, and it is the one most likely to be pressed. There are four
> layers of defence. Give them in this order — the argument gets stronger, not weaker, as it goes.

### 9.1 The values themselves

| Rule | Threshold | Category | Severity |
|---|---|---|---|
| `complex-function` | WMC > 15 | code-design | Medium |
| `long-method` | function > 80 LOC | code-design | Medium |
| `deep-nesting` | nesting > 4 | code-design | Medium |
| `large-file` | file > 800 LOC | code-design | Low |
| `hardcoded-secret` | regex + entropy | security | **Critical** |
| `sql-concat` | SQL string concatenation | security | High |

**Layer 1 — they are not invented; they are mainstream defaults.** McCabe's original 1976 paper
proposed 10 as a complexity limit, with later practice commonly relaxing to 15; SonarQube's default
threshold for method complexity is in the same range, as is its default nesting limit. We chose the
*upper* end of the accepted band deliberately, because a v1.0 tool that fires on everything defeats
its own low-noise requirement (U-4).

> ⚠️ **Verify before quoting a specific standard by name.** The safe form is *"these are the values
> mainstream tools use as defaults, and we took the conservative end of the range."* Do not invent a
> citation under pressure — "I'd want to check the exact reference" is a perfectly good answer.

### 9.2 Layer 2 — the architectural defence (the strong one)

> *"The honest answer is that no threshold is universally right — complexity 15 is aggressive for a
> parser and lenient for a controller. That's exactly why **the thresholds are configuration, not
> code**. They live in `register.yaml`, and SRS SP-8 requires it: recalibration is a config edit and
> a restart, not a release. So 'is 15 correct?' is an empirical question we can answer later against
> real repositories, and answering it differently costs us nothing."*

This reframes the question from *"did you pick right?"* to *"did you make the choice cheap to
revise?"* — and the answer to the second is demonstrably yes.

### 9.3 Layer 3 — a wrong threshold degrades gracefully

Three properties limit the damage:

1. **Severity is flat per rule.** `complex-function` emits Medium whether WMC is 16 or 45. A file
   simply accumulates *more findings* the worse it gets. So a mis-set threshold changes the *volume*
   of findings, never their *severity*.
2. **Priority is a product of five factors.** A noisy rule's Medium findings (3 base points) still
   sort below Critical security findings (8 points), so noise degrades the tail of the list, not the top.
3. **The user can down-weight the whole category.** If code-design rules are too chatty for a team,
   the `code-design` slider goes to 0.1 and the list re-ranks instantly — with no re-scan.

### 9.4 Layer 4 — where severity comes from, and why ML cannot touch it

**Severity is assigned exactly once, at detection, and is never recomputed.**

| Source | Who assigns severity |
|---|---|
| Rule findings | The rule register (`register.yaml`) — a fixed value per rule |
| SATD findings | The deterministic **marker table** — `FIXME/BUG/XXX` → high, `TODO/HACK/TEMP` → medium, `NOTE/REVIEW/NIT` → low, no marker → medium |
| ML-2 (risk) | **Nothing.** It produces no findings at all |

**Why severity is not learned:** a supervised model can only predict what its training data labels,
and the SATDAUG dataset labels **categories, not severities**. There is no answer key for severity,
so it cannot be learned and must be assigned deterministically. The division of labour is clean:
*the probabilistic component decides what kind of debt this is; the deterministic component decides
how bad it is.*

**The bound proof — memorise this, it settles the question:**

```
maximum combined boost  =  churn 2.0  ×  risk 2.5  =  5×
severity spread         =  Critical 8  ÷  Low 1    =  8×

5 < 8   ⟹   no amount of churn or ML confidence can push a Low finding
            above a Critical one. The model re-orders within a band; it can
            never invert the deterministic ranking.
```

**And the security floor (FR-24) has three independent mechanisms**, so no single setting defeats it:

1. Severity is not user-settable — `hardcoded-secret = critical` is fixed in the register
2. `source_trust` is **always 1.0** for the security category, so no position of the trust slider can
   de-weight security findings
3. Critical security findings are **pinned** into the visible list regardless of computed priority,
   even at the minimum security weight of 0.1 — and the API marks them `pinned_by_floor: true` so the
   UI can say why

### 9.5 The one thing to admit first

> *"The calibration constant `k` in the health formula is still a placeholder — 25.0. FR-11 requires
> it to be calibrated against a reference set of repositories before release, and that hasn't
> happened yet. So today's **grades are relative, not absolute**: they rank files correctly against
> each other, but a 'B' doesn't yet mean anything in the industry sense. It's on the plan, and
> because it's a config value it doesn't affect any code."*

Say this before they find it. Volunteering a known weakness with the mitigation attached reads as
rigour; being caught by it reads as the opposite.

---

## 10. Testing strategy

### 10.1 The pyramid, and what exists today

| Level | Tool | What it covers | Status |
|---|---|---|---|
| **Unit — scoring** | pytest | The five factors, bounds, the "no Low above Critical" guarantee | 1 file written; runs with **no database, no broker, no HTTP** |
| **Unit — rule engine** | pytest | Determinism (SP-11) — same input, same findings, exactly | Planned |
| **Unit — frontend** | Vitest + Testing Library | Every data hook, every dashboard component | **25 tests / 11 files, all passing** |
| **Integration — RLS** | `testcontainers[postgres]` | A cross-tenant `SELECT` returns **zero rows** | Dependency added, test owed |
| **Contract** | CI diff | FastAPI's `/openapi.json` vs the committed `openapi.yaml` | Contract drafted, CI check owed |
| **E2E** | Playwright | Dashboard render, scan lifecycle, branch switch | **3 specs** |
| **ML evaluation** | scikit-learn | Per-class P/R/F1, ROC-AUC on held-out data | Owed — models not trained |
| **Accessibility** | axe-core / Lighthouse | WCAG 2.1 AA contrast, 0 violations (U-7) | Planned |
| **Keyboard** | manual walkthrough | 100% of interactive components operable (U-9) | Planned |

### 10.2 The three testing answers worth rehearsing

**"How do you test a scoring engine that depends on a database?"**
> It doesn't depend on one — that's the point. The `scoring is pure` import contract makes it a
> build failure for the scoring package to import SQLAlchemy, FastAPI, Celery or httpx. So scoring
> tests run in milliseconds against plain data classes. The purity isn't a convention we hope holds;
> CI enforces it.

**"How do you test multi-tenant isolation?"**
> With a real Postgres in a container, via testcontainers. Create two workspaces, insert data into
> both, set the RLS context to workspace A, and assert that a `SELECT` returns **zero** of B's rows.
> That test matters more than it looks: RLS is silently bypassed by superusers and table owners, so
> a mis-configured connection makes isolation *appear* to work in development and fail in review.
> We already split the roles (`codesage_owner` vs `codesage_app`) for exactly this reason.

**"How do you test the frontend without a backend?"**
> Mock Service Worker intercepts at the **network boundary**, not by stubbing our own code. The same
> handlers serve development, unit tests and E2E. So the components under test are the real
> components making real `fetch` calls — and switching to the real backend is a base-URL change, not
> a rewrite. That's SP-10, and it's why we could build the whole frontend before the backend existed.

### 10.3 Traceability

SRS Appendix A maps each requirement to a test case: TC-01 (sign-in), TC-06 (scan lifecycle including
cancel and skip-if-unchanged), TC-07 (same-SHA re-scan reproduces an identical snapshot), TC-11
(the bound check — no Low outranks a Critical in the same category), TC-20 (preset seeds sliders,
weights clamp, re-score without a scan), TC-24 (a critical security finding stays visible at the
minimum security weight).

If asked *"how do you know the requirements are testable?"* — that matrix is the answer.

---

## 11. How ML accuracy is measured

### 11.1 The targets

| Model | Metric | Target | Source |
|---|---|---|---|
| **ML-1** SATD classifier | F1 on the **positive (debt) class**, binary debt / non-debt | **≥ 0.80** | REL-11 |
| **ML-1** per category | Precision, recall, F1 **per class**, with support counts | reported, not gated | REL-11, FR-25 |
| **ML-2** risk model | **ROC-AUC** | **≥ 0.70** | REL-12 |
| **ML-2** | Precision, recall, F1 | reported | REL-12 |

### 11.2 Why accuracy is banned — say this proactively

> *"We never report accuracy for either model, and that's deliberate. In the SATD corpus roughly
> 85% of comments are not debt. A model that answers 'not debt' to everything scores 85% accuracy
> and is completely worthless. The same holds for the risk model — defective files are rare, so
> accuracy rewards a model that never predicts a defect. We report precision, recall and F1 per
> class, with the support count for each, plus ROC-AUC for the risk model."*

This one answer demonstrates ML literacy better than any result you could quote.

### 11.3 The evaluation protocol

1. **Held-out test set** — split before any training, never touched during model selection
2. **Per-class reporting** — a macro- or weighted average would conceal near-total failure on the
   smallest categories, which is exactly the failure mode we need to see
3. **Baseline comparison (FR-25)** — ML-1 is compared against the **deterministic rule baseline**.
   The honest scientific question is: *does the classifier beat a plain marker regex?* If it doesn't,
   we should not ship it. That comparison is the point of having both
4. **Model versioning** — every snapshot records `model_version` (SP-15), so trend points computed
   before and after a retraining stay comparable. Without it, retraining silently corrupts history
5. **Reports are versioned artifacts** — written to `apps/ml/training/reports/` per model version,
   before deployment

### 11.4 Where the data comes from

| Model | Dataset | Note |
|---|---|---|
| **ML-1** | **SATDAUG** (augmented SATD dataset) | Four categories: code-design, requirement, documentation, test. **No `defect_debt` label** — which is exactly why our taxonomy has five categories, not six |
| **ML-2** | **D'Ambros** bug-prediction dataset | Its feature set is CK metrics, which is why we extract with CK (§5.5) |

Both are **offline**. They are downloaded once per training artifact. **No dataset and no external
API is contacted during a scan.**

### 11.5 If asked "what if the models perform badly?"

> *"The product still works. The rule engine is deterministic and independent — it produces all the
> security and code-design findings on its own. The ML models add the SATD category prediction and
> the risk multiplier. In fact the system is designed to run **without them**: if the ML container
> is unreachable, a scan still completes and persists a valid snapshot with rule findings only. That
> degraded mode is a designed behaviour, not a fallback we bolted on. And FR-25 requires us to
> publish the ML-versus-baseline comparison either way — including if the answer is unflattering."*

---

## 12. Scaling and challenges

### 12.1 The scaling path, in the order we would actually do it

| # | Step | Addresses | Cost |
|---|---|---|---|
| 1 | `--scale worker=N` | Scan throughput (PERF-07) | ~2 GB scratch disk per concurrent scan |
| 2 | Index tuning on the read path | Dashboard latency (DBR-32) | Free |
| 3 | Denormalised score cache | Repeat dashboard reads | Must be **stamped with the profile** that produced it and recomputed when the active profile differs (DB-8) |
| 4 | Postgres read replicas | Read-heavy load | Replication lag on the trend chart |
| 5 | `--scale ml=N` | Inference throughput | Only if inference becomes the bottleneck, which it isn't yet |
| 6 | Partition snapshots by workspace | Very large tenants | Migration |
| 7 | Extract a service | Only if a genuine bounded context emerges | High — see §3.3 |

**The honest ceiling:** adding workers does **not** scale the single Postgres. That is the real
limit, and steps 2–4 and 6 exist because of it.

**The accelerator worth mentioning (DB-8):** per snapshot, storing two sums per `(category, source)`
group — `Σ base×churn` and `Σ base×churn×risk` — lets us re-score an entire 20-scan history in a few
hundred operations instead of iterating every finding, because the profile factors are **constant
within a group**. That's the answer to "doesn't deriving on read get expensive?"

### 12.2 Challenges — state these as understood risks, with mitigations

| # | Challenge | Why it's hard | Mitigation |
|---|---|---|---|
| 1 | **`k` is uncalibrated** | The health score is meaningless in absolute terms until it's set against reference repositories | Scheduled; it's a config value, so no code changes |
| 2 | **Cold-start scan time** | Clone + CK + PyDriller over full history is minutes. PyDriller over a long history is the slow part | Skip-if-unchanged on the head SHA; a bounded history window; per-repo clone caching |
| 3 | **GitHub rate limits** | Anonymous REST is ~60 requests/hour per IP — thin for branch metadata | ETag-conditional requests (already designed in); one project-owned service token if needed. **Not** a user token — that stays out under federation |
| 4 | **Class imbalance** | Even after augmentation, debt is a minority class | Never report accuracy; per-class metrics mandatory (§11.2) |
| 5 | **Java-only** | CK constrains us, and CK is the right choice for ML-2 (§5.5) | Honest scoping. Adding a language = extractor + grammar + rule pack + recalibration |
| 6 | **Train/serve skew** | If feature order at inference differs from training, the model returns plausible numbers from the wrong columns — and nothing fails loudly | `risk/features.py` owns the ordering and **both sides import it** |
| 7 | **Derived-on-read latency** | FR-21 means every dashboard read recomputes every score. This is the load-bearing performance risk of the whole design | §12.1 steps 2–4, plus the two-sums accelerator. **Gap: the SRS has no read-latency requirement** — see §13 |
| 8 | **RLS is a footgun** | A superuser or table-owner connection bypasses every policy *silently*, so isolation appears to work in dev and fails in review | Two-role bootstrap already written; the cross-tenant test is what actually proves it |
| 9 | **Hosted auth dependency** | Asgardeo down = nobody signs in | REL-01 excludes external-service outages; sessions already established stay valid |

---

## 13. Known gaps

Say these before they are found. Each has a mitigation or a plan attached.

| Gap | Status | What to say |
|---|---|---|
| **`k` is a placeholder (25.0)** | Config value | "Grades are relative until calibration. It's a YAML edit, not a code change." |
| **92 `NotImplementedError` in the backend** | By design at this stage | "It's a contract skeleton. Every layer boundary and design decision is in place and CI-enforced; the handler bodies are the remaining work." |
| ~~No Alembic migration yet~~ | **Done** | The first migration creates the whole ERD and its RLS policies. |
| ~~RLS policies not written~~ | **Done** | Policies and a cross-tenant integration test both exist. This is the strongest thing to demo. |
| **No trained models** | Owed | "The service interface and schemas are defined, and the system runs in degraded mode without them by design." |
| **Frontend types predate CR-001** | Owed | "The contract changed — five categories, two `source` values, a `cancelled` phase. The frontend migration is a scheduled phase, and once types are generated from the OpenAPI file the compiler finds every site for us." |
| **Auth is frontend-only** | Decided, half-integrated | "Asgardeo protects the Next.js pages. The API is not protected yet — that is the current task, and it is specified rather than improvised." |

| ~~OpenAPI contract not in the repo~~ | **Done** | `docs/api/openapi.yaml`; `pnpm gen:types` generates the frontend types from it. |
| **No read-latency NFR** | **Fixed in SRS v1.1** | PERF-11: dashboard read within 2 s at p95 under the PERF-06 capacity. |
| **The API is unauthenticated** | Being fixed | Asgardeo landed on the frontend only. Moving the exchange into FastAPI is the current task; SRS v1.1 SEC-17 to SEC-20 specify it. |

> **Framing for the whole table:** *"We prioritised getting the architecture right and provable
> before writing implementation, because the architectural mistakes are the expensive ones to
> reverse. The skeleton encodes every decision, and CI enforces the ones that matter."*

---

## 14. Quick-fire answer bank

Short answers to short questions.

**"Is this just SonarQube with extra steps?"**
No — SonarQube tells you what is wrong. We tell you what to fix first, under your team's weighting,
and we classify the debt developers admitted in prose, which SonarQube treats as a flat regex smell.

**"Why five categories, not six?"**
The taxonomy is fixed by what the training data can actually label. SATDAUG has no `defect_debt`
label, so a `defect` category could never be predicted. We removed it rather than ship a category
the model can't produce.

**"Why is `security` a category and not a source?"**
Because `source` answers *who found this* and `category` answers *what kind of debt is it* — two
orthogonal axes. Security patterns run inside the rule engine, so a security finding is
`source=rule, category=security`. A `security` source value would correlate perfectly with the
category and collapse two axes into one.

**"Why doesn't the risk model create findings?"**
Because then a red file could open to an empty detail panel — exactly the un-actionable noise this
product exists to remove. Every point of debt must trace to a finding a user can open. Risk stays
visible as its own badge and multiplies the priority of findings already there.

**"Why PUT and not PATCH for the profile?"**
The body is the complete profile, never a delta, so applying it twice is applying it once. That
matters because the client fires a dependent read immediately after — a retry on a dropped response
must not leave three weights updated and two not.

**"Why does the trend redraw when I change profile?"**
Every point on a line is computed under the currently active profile, so the whole history is
comparable. A line whose points came from different profiles would be unreadable — you couldn't tell
a code change from a settings change. The chart is labelled with the profile name for the same reason.

**"What happens if the ML service is down?"**
The scan completes. All rule and security findings are present, no SATD findings, no risk scores —
`risk_score` comes back as `null`, which is deliberately different from `0.0`. `null` means *not
assessed*; `0.0` would mean *measured as safe*. A valid partial snapshot is more useful than none.

**"Why is the frontend built before the backend?"**
It de-risks the part with the most unknowns — the user experience — and MSW intercepts at the network
boundary, so the components under test are the real components making real `fetch` calls. Moving to
the real backend is a base-URL change.

**"What's the hardest technical problem in this project?"**
Making prioritisation honest. Anyone can multiply numbers together; the hard part is guaranteeing
that a machine-learning model can never override a deterministic security judgement. We solved it
with a bound: the maximum combined ML+churn boost is 5×, and the severity spread is 8×, so the
inversion is arithmetically impossible rather than merely unlikely.

**"What would you do differently?"**
Calibrate `k` earlier — it's a config value but it gates any meaningful demo of the health score.
And we should have written the OpenAPI contract before the frontend types rather than after; the
drift between them cost us a migration phase.

---

*Prepared 13 Aug 2026 from: SRS v1.0 and SAD v1.0 (`docs/Deliverables/`), `origin/chamodh/backend` @ `3303019`, `origin/feature/setup-celery-redis` @ `d6aaa24`, and the current frontend on `docs/srs`.*
