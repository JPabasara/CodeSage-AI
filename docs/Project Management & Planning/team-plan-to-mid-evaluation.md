# Team plan — now to mid-evaluation (Tue 25 Aug 2026)

*Working plan · written 17 Aug 2026 · Group 16. Not a deliverable. Nine days.*

---

## The goal

By Tuesday the 25th, three things should be true:

1. **It runs on a real URL**, not on a laptop.
2. **One complete path works end to end** — sign in, connect a repository, run a scan, see the dashboard.
3. **Every merge is checked automatically**, so "it works" is something a marker can verify rather than take our word for.

Anything that does not serve those three waits until after the 25th.

---

## 1. Who owns what

The whole point of the split is that **two people never edit the same file**.

| Folder | Owner | What it is |
|---|---|---|
| `apps/web/` | **Janidu** | The Next.js dashboard |
| `apps/api/` | **Chamodh** | FastAPI, the scan worker, the database |
| `apps/ml/` | **Nathasha** | The model service and training |
| `infra/`, `.github/`, **all Dockerfiles** | **Janidu** | Deployment and CI |
| `docs/` | shared | One person per file, agreed in the group chat |

> **Note the last row of Janidu's column.** Dockerfiles live inside `apps/api/` and `apps/ml/`, but they belong to whoever does deployment. Chamodh and Nathasha do not edit them. If one needs changing, ask.

### The one file everyone shares

`docs/api/openapi.yaml` — the API contract.

**Nobody edits it alone.** A change to it is its own pull request, with no code in it, and both other people approve it. That file is why three folders can be worked on at once without constant talking: it already says what every field is called and what every endpoint returns, so the frontend can be built before the backend answers, and the other way round.

If you find yourself wanting to change it mid-task, stop and raise it in the group. Changing the contract quietly is how the last merge became painful.

---

## 2. Rules that stop the merge mess repeating

The last merge had eight conflicting files. Every one was a shared file two branches touched.

1. **Branch names say who and what:** `web/janidu/profiles-page`, `api/chamodh/scan-endpoints`, `ml/nathasha/satd-service`.
2. **Only touch your own folder.** Need something in someone else's? Ask them to do it.
3. **Pull `main` into your branch every morning.** Ten small merges are painless; one nine-day merge is not.
4. **Small pull requests, often.** One a day is a good target. A pull request nobody can read does not get reviewed, it gets waved through.
5. **Never run `git add -A` from the top folder.** `apps/ml/data/raw/` is a git repository inside our git repository and would be committed as a broken link. Add paths by name.

---

## 3. Why Janidu goes first

Some work touches files in *everyone's* folder — the Dockerfiles, the compose file, the CI setup. If that happens while Chamodh and Nathasha are mid-flight, we get the same merge mess again.

So the order is:

```
Mon 17 – Tue 18    Janidu only, on the shared files.  One pull request.
                   Chamodh and Nathasha may start branches, but do not
                   touch any Dockerfile, infra/ or .github/ — ever.

Tue 18 evening     That pull request merges.  ← green light
                   Everyone pulls main and carries on.

Wed 19 onward      All three working in parallel, in separate folders.
```

After that one pull request, **Janidu never edits `apps/api/` or `apps/ml/` again.**

---

## 4. What we found when we checked the deployment — **all resolved**

Three things were assumed to work and did not: there was no `apps/web/Dockerfile`, the frontend's API
address was set as a runtime variable when Next.js freezes it at *build* time, and
`docker compose up` had never been run end to end. All three were Phase 0, and all three are done.

A fourth surfaced much later and was the same species: the **CK jar was gitignored**, so the image CI
published could not run a scan even though every build was green. Fixed in Phase 4. The lesson is the
one this section keeps teaching — *CI checked what the code says and never checked what the artefact
does.*


## 5. The idea that shapes the whole deployment

> **Get the project deployable *anywhere*, and the choice of host becomes a small decision you can
> change later.**

If a clean machine that has never seen your laptop can build and run the images, any host can run
them. If it only builds on your machine, you do not have a deployment — you have a laptop.

**That is what CI is really for here.** CI does exactly what a hosting platform does: check out the
code fresh, build the images, run the tests. Then it pushes those images to GitHub Container
Registry, so deploying anywhere is "pull this image and run it".

**And it is why we do not let Railway build from the repository.** That would discard the images CI
tested, so what runs would not be what passed. CI publishes; CI then tells Railway to pull.

### Where we stand — complete

| Needed | |
|---|---|
| All three images build on a clean machine | ✅ |
| Every setting comes from an environment variable | ✅ nothing reads `os.environ` directly |
| The required variables are written down | ✅ `apps/api/.env.example` |
| Migration is a step you can run — and now runs itself on deploy | ✅ |
| A health endpoint for the platform to check | ✅ `/api/healthz` |
| Services keep nothing in memory | ✅ sessions are database rows |
| Images published, and pullable by tag | ✅ `latest` and `sha-<commit>` |
| The published `api` image can actually run a scan | ✅ Phase 4 — the CK jar is fetched and smoke-tested at build |
| All four containers deployed | ✅ Phase 4 |
| A merge to `main` deploys | ✅ Phase 4 — **unproven until a merge exercises it** |
| A red pull request cannot be merged | ✅ Phase 4 — six correctly-named required checks, 1 review, no bypass |


## 6. Janidu — deployment, CI, then frontend

| Phase | | |
|---|---|---|
| **0** — shared files | web Dockerfile, build-arg API address, six containers up, CI, images published | ✅ |
| **1** — first deploy | domain, Neon, Upstash, `web` + `api` on Railway, sign-in works live | ✅ |
| **2** — frontend against the real contract | snake_case, five categories, session cookie on every request | ✅ |
| **3** — finish the slice, then polish | PR A merged; **PR B in progress** — see §6c | ⏳ |
| **4** — finish the deployment | `worker`, `ml`, CK jar, migrations on deploy, auto-deploy, branch protection | ✅ |

**The one thing Phase 4 has not proved: a real Java scan on the live site.** Everything else was
verified; that check is what confirms the CK work actually landed on the deployed worker.

Detail for Phases 1 and 4 is in **[the deployment log](deployment-implementation-log.md)**, which is
the live record. §6a below is the summary.


## 6a. Phase 1 and Phase 4 — the deployment itself

The full step-by-step, every setting, every trap and every thing that broke, lives in
**[the deployment log](deployment-implementation-log.md)** — it is the record, and it is kept
current. This section is the summary.

**Phase 1 (20–21 Aug)** put `web` and `api` live on Railway behind `codesageai.dev`, with Neon and
Upstash. Buying the domain came first and was not cosmetic: `*.up.railway.app` is on the public
suffix list, so a frontend and backend on two Railway addresses are two *sites* to a browser and a
`SameSite=Lax` session cookie would never have been sent between them.

**Phase 4 (26 Aug)** finished it — `worker` and `ml` deployed, the CK jar fetched into the image,
migrations run as a pre-deploy command, and a merge to `main` now deploys.

The four things worth carrying into any future work on this:

1. **A failed deployment leaves the previous container serving.** A 200 from the URL proves the *old*
   build is alive. Trust the deployment badge.
2. **`/api/healthz` never touches the database**, so signing in is the first request that opens a
   connection — every database misconfiguration stays invisible until then.
3. **`NEXT_PUBLIC_*` is baked in at build time.** Changing the API address means rebuilding `web`,
   not restarting it.
4. **A browser saying "CORS" usually means something else.** It is what Chrome reports whenever a
   cross-origin request fails for any reason, including the server erroring or not answering.


## 6b. Phase 2 — frontend against the real contract — **DONE**

J2.1–J2.8 and J2.10 complete: types generated from the contract, every field renamed to snake_case
(~244 call sites), five category chips, five weights plus the trust slider, `cancelled` added to the
scan states, sign-in as a plain `<a href>`, `credentials: "include"` on every request, mock handlers
updated, and connect-a-repository built.

J2.9 — walking the whole path on the live URL — found the sign-out bug that became J3.0.


## 6c. Phase 3 — finish the slice, then polish

**PR A is merged.** J3.0 (sign-out ends the Asgardeo session, not just ours), J3.1 (finding detail
renders in place, per CR-001), J3.2 (`GET /api/auth/session`), J3.3 (`middleware.ts` route
protection) and J3.5 (Team v2 nav item removed) are all done and covered by E2E.

> The middleware only checks that the session cookie **exists** — it is `httpOnly`, so the edge
> cannot read it. That is the right split: middleware is a redirect for the common case, and **the
> API is the security boundary**, checking the session on every request. A middleware check is never
> authorization.


### PR B — what is left, in order (re-planned 25 Aug 2026)

PR A is merged and every J3.0–J3.5 row above is done and covered by E2E. Re-running the build
guide's audit against the shipped code changed the picture, so the old seven-item polish list is
replaced by this:

- **five items are already done** — A1 metadata, A3 `.env.example`, A9 the dead Account stub, A10
  the repo-id-vs-name mismatch, and the branch-select + dashboard-empty rows fixed by J-CR9
- **one item is not polish at all** — below `md` the app has **no navigation**, because nothing
  ever mounts a `SidebarTrigger`. It ships as a fix, not in the polish PR
- **one item is a feature** — Scan History is still the word *"(Placeholder.)"* on a rail item
- **Profiles is already built**, so the old "two placeholder pages" problem is now one

| # | Step | Ships as | Why here |
|---|---|---|---|
| **P0** | Add `pnpm verify` to `package.json` | **B1** | The plan's gate command does not exist yet. Two minutes |
| **P1** | Format the repo, alone, one commit | **B1** | 97 files fail `prettier --check`. Do it first or every later diff is unreviewable |
| **P2** | Navigation bugs: `SidebarTrigger`, and stop the rail hardcoding the demo repo id | **B2** | No navigation below `md`, and "Dashboard" jumps to the wrong repo. Behaviour, not polish |
| **P3** | Build the Scan History page | **B3** | A v1.0 claim the UI does not honour. Endpoint, fixture and client already exist, so it is about an hour |
| **P4** | Loading / empty / error trio + a working Retry | **B4** | The biggest win, and the only step that touches a hook every view shares |
| **P5** | Colour that carries meaning: pie palette + legend, grade and severity contrast, coloured delta | **B4** | The demo lives on the dashboard and colour *is* the meaning there |
| **P6** | Keyboard and screen readers: focusable list rows, `aria-live`, per-route titles | **B4** | The core triage flow is mouse-only, so a keyboard evaluator cannot use the product |
| **P7** | Legibility and responsive, then the sign-off table | **B4** | Finish-line detail |

Four PRs, because P2 and P3 change behaviour and do not belong in a polish PR:

| PR | Steps | Issue | Title |
|---|---|---|---|
| B1 | P0, P1 | [#86](https://github.com/JPabasara/CodeSage-AI/issues/86) | `chore(web): add pnpm verify and format the repo` |
| B2 | P2 | [#87](https://github.com/JPabasara/CodeSage-AI/issues/87) | `fix(web): make navigation reachable and repo-correct` |
| B3 | P3 | [#88](https://github.com/JPabasara/CodeSage-AI/issues/88) | `feat(web): scan history page` |
| B4 | P4–P7 | [#69](https://github.com/JPabasara/CodeSage-AI/issues/69) | `polish(web): v1.0 Definition of Done` |

**#86, #87 and #88 are new (created 25 Aug).** #69 was one issue covering all of Phase 11; it has
been narrowed to the polish steps P4–P7, because P1 is a chore that must land alone, P2 is a
behaviour bug and P3 is a feature. None of those three belong in a polish PR.

#### Scan History — decision recorded

**Build it (Option A).** The build guide asked for an A/B/C choice on the two placeholder pages and
it was never written down. Profiles got built in the meantime, so only Scan History is left. The
mock endpoint (`*/api/repos/:repoId/scans`), the fixture (`mockScanHistory`) and the client function
(`getScanHistory`) all already exist, so this is a `Table` plus a `useQuery` one-liner. The demo
script has an evaluator clicking every rail item, and Scan History is a v1.0 claim in the roadmap —
shipping "Coming soon" over a working endpoint would invent a gap we do not have.

Full detail: **[frontend_build_stepbystep.md §11.M, §11.2b](frontend_build_stepbystep.md)**.

> **One thing to settle with Chamodh before the demo.** `GET /repos/{id}/health` is still
> `raise NotImplementedError` → **500**, so a never-scanned repository renders the *error* state
> rather than the *empty* one that J-CR9 added. The frontend is correct as written; the empty state
> switches on when the endpoint returns a proper **404** for an unscanned branch.

---

## 7. Chamodh — the API and the worker

Start on Monday in `apps/api/src/`. Pull `main` after Janidu's Phase 0 lands on Tuesday evening.

### Phase A — make the read endpoints return real data (Mon 17 – Wed 19)

The frontend needs these to have anything to show.

| # | Step | Done when |
|---|---|---|
| C1.1 | `GET /api/projects` | Returns the workspace's repositories |
| C1.2 | `POST /api/projects` **(demo-critical)** | Connecting a public GitHub repository adds it, and it survives a refresh |
| C1.3 | `GET /api/repos/{id}/branches` | Real branch names from GitHub |
| C1.4 | `GET /api/repos/{id}/scans` | Scan history for a branch |
| C1.5 | `GET /api/profiles` and `GET /api/profiles/active` | Returns the six numbers |
| C1.6 | `PUT /api/profiles/active` | See the warning below |
| C1.7 | Tests: signed out gives 401, signed in gives data, one workspace cannot see another's rows | Tests pass |

> ⚠️ **On applying a profile.** The database guarantees *at most* one active profile — **not at least one**. Clearing the old row and setting the new one must happen in a single transaction. A clear that commits on its own leaves the workspace with no active profile at all. Also remember profiles are **not versioned**: the same row is updated in place.

> **C1.2 is demo-critical and was not marked as such.** It is step 2 of the four-step
> demo path — sign in → *connect a repository* → run a scan → see the dashboard. Every
> later step (C2.x) needs a connected repository to act on, so nothing downstream can be
> demonstrated until this returns real data. Janidu's **J2.10** is the matching frontend
> half; the two can be built in parallel against the mock.

### Phase B — the scan (Thu 20 – Sun 23)

| # | Step | Done when |
|---|---|---|
| C2.1 | `POST /api/repos/{id}/scan` creates an attempt and queues it | Returns 202 with an id |
| C2.2 | `GET .../scan/{id}` reports phase and percentage | The frontend can poll it |
| C2.3 | `POST .../scan/{id}/stop` | The scan stops between stages |
| C2.4 | Progress published to Redis | Percentage moves during a scan |
| C2.5 | Scan pipeline: clone → extract → detect → save | A real repository produces stored findings |
| C2.6 | Rule engine — the four rules already defined | Real findings on real Java files |
| C2.7 | The scoring calculation | `GET /api/repos/{id}/health` returns a real grade |
| C2.8 | Do the summing in SQL, not in Python | Dashboard responds quickly |

### Phase C — demo preparation (Mon 24)

| # | Step | Done when |
|---|---|---|
| C3.1 | Pick a small Java repository that produces good findings | It scans in under two minutes and shows a mix of severities |
| C3.2 | Scan it on the live site and check the dashboard | It looks right |

---

## 8. Nathasha — the model service

Start on Monday in `apps/ml/src/`. Pull `main` after Tuesday evening.

> **Important, and good news: your work is not blocking the demo.** The system is designed to keep working when the model service is unreachable — the scan still finishes, all rule findings appear, and risk comes back as "not measured". So if training runs late, the demo still works. Nobody should re-plan around waiting for models.

### Phase A — the service answers (Mon 17 – Wed 19)

| # | Step | Done when |
|---|---|---|
| A1.1 | The service starts and its health endpoint answers | The API's worker can reach it |
| A1.2 | The SATD endpoint accepts comments and returns predictions, in the shape the contract expects | Even a simple model is fine this week — the shape matters more than the accuracy |
| A1.3 | The risk endpoint accepts metric vectors and returns a score | Same |
| A1.4 | Tests for both endpoints | They pass in CI |

### Phase B — real models (Thu 20 – Sun 23)

| # | Step | Done when |
|---|---|---|
| A2.1 | Train the SATD classifier on SATDAUG | A saved model file exists |
| A2.2 | Evaluate it **per class, with counts** | Numbers written down |
| A2.3 | Serve the trained model instead of the placeholder | Real predictions over HTTP |
| A2.4 | Bug-risk model on the D'Ambros data | Only if time allows |
| A2.5 | Record which model version produced what | Written to the model version table |

> **Never report accuracy**, for either model. Most comments are not debt, so a model that answers "not debt" every time scores well and is useless. Report precision, recall and F1 per class, with how many examples each class had. For the risk model, add AUC.

### Phase C — write-up (Mon 24)

| # | Step | Done when |
|---|---|---|
| A3.1 | Write the model results section of the evaluation document | Per class, with counts, and honest about what is not trained yet |

---

### Where your contract actually is

**Not in `docs/api/openapi.yaml`.** That file is the browser-to-API contract and says
nothing about the model service. Yours is defined in three places:

| Where | What it gives you |
|---|---|
| SRS §3, interfaces table | One sentence: *"Batched comments in, SATD label and category out; per-file numeric feature vector in, risk score 0–1 out"* |
| SAD, component + deployment views | Prose: the container is reached by the **worker only**, never by the browser |
| **`apps/ml/src/codesage_ml/schemas.py`** | **The real contract** — `ClassifyRequest`, `ClassifyResponse`, `RiskRequest`, `RiskResponse`, `VersionResponse` |

Run the service and FastAPI publishes a machine-readable version of those shapes at
`/docs` and `/openapi.json`. **That is the page to send Chamodh** when he wires the worker.

> **A gap to close early.** `apps/api/src/codesage_api/integrations/ml_service.py` is a
> single line — `#TO BE IMPLEMENTED`. Nothing yet checks that the two sides agree, and
> there is no equivalent of the frontend's `gen:types:check` guarding this boundary. If
> you change a field name in `schemas.py`, nothing will tell Chamodh. **Agree the shapes
> with him in week one and treat `schemas.py` as frozen** unless you both change it together.

---

### The steps, explained

#### A1.1 — The service starts and answers

`apps/ml/src/codesage_ml/main.py` already exists with four routes wired
(`/classify`, `/risk`, `/version`, `/healthz`). Only `/healthz` returns anything; the
rest `raise NotImplementedError`.

**Do:** get it running and reachable from the worker container.

```bash
cd apps/ml
uvicorn codesage_ml.main:app --port 8001
curl localhost:8001/healthz          # {"status":"ok"}
```

**Why the health check has no model in it:** the same reason the API's does not touch
the database. A dead model must not make an orchestrator kill a process that is
otherwise fine — it should degrade, not restart.

#### A1.2 / A1.3 — The endpoints answer in the right shape

**This is the week's real deliverable, and accuracy is not part of it.** Return a
constant, or a keyword match, or a coin flip — as long as the *shape* is exact.

`/classify` takes `{comments: [{id, text}]}` and returns
`{predictions: [{id, is_debt, category, confidence}], model_version}`.

Three rules the shape enforces:

- `id` is echoed back. The worker uses it to put each prediction back on the right
  comment — **never rely on list order.**
- `category` is `null` whenever `is_debt` is false. Not `"none"`, not an empty string.
- `category` is **never `"security"`.** Security findings come from the rule engine.
  The classifier has four categories; the product has five.

`/risk` takes `{files: [{path, metrics}]}` and returns
`{scores: [{path, risk_score}], model_version}`, with `risk_score` between 0 and 1.

**Why shape first:** Chamodh can write and test the entire worker pipeline against a
placeholder that returns constants. If you deliver accuracy in week two but the shape
changed, his week is wasted. If you deliver the shape now and accuracy later, he never
notices the swap.

#### A1.4 — Tests for both endpoints

FastAPI's `TestClient` — no server, no network:

```python
from fastapi.testclient import TestClient
from codesage_ml.main import app

def test_classify_echoes_every_id():
    r = TestClient(app).post("/classify", json={"comments": [{"id": "a", "text": "TODO: fix"}]})
    assert r.status_code == 200
    assert [p["id"] for p in r.json()["predictions"]] == ["a"]
```

Worth pinning now, because each one is a promise Chamodh is relying on:

- [ ] every input `id` comes back, exactly once
- [ ] `category` is `null` when `is_debt` is false
- [ ] `category` is never `"security"`
- [ ] `risk_score` is within 0–1
- [ ] `model_version` is present on every response
- [ ] an empty input list returns an empty list, not an error

#### A2.1 — Train the SATD classifier on SATDAUG

The label mapping is already written for you in
`apps/ml/src/codesage_ml/satd/labels.py`, and it carries the class counts:

| Dataset label | Product category | Examples |
|---|---|---|
| `code/design_debt` | `code-design` | 2,703 |
| `requirement_debt` | `requirement` | 2,271 |
| `test_debt` | `test` | 2,635 |
| `documentation_debt` | `documentation` | 2,701 |
| `non_debt` | *(negative class)* | **58,204** |

**Train on the dataset's own label strings and apply the mapping to the output.** Doing
the rename before training would put the product's vocabulary inside the model and make
a future rename a retraining job.

**The number that shapes everything: 58,204 vs ~10,310.** Roughly five out of six
comments are not debt at all. Two consequences you must plan for, not discover:

- A model that answers "not debt" every single time scores about **85% accuracy** and
  is completely useless. This is why accuracy is banned below.
- Use a **stratified** train/test split, or a small class can end up almost absent from
  your test set and its score becomes noise.

Start simple — TF-IDF plus logistic regression is a legitimate baseline and trains in
seconds. A weak baseline you can explain beats a strong one you cannot.

#### A2.2 — Evaluate per class, with counts

**Never report a single accuracy figure.** Not in the document, not in the slides, not
in conversation. See the reasoning above — it is the one number that makes a useless
model look good.

Report, for each of the five classes including `non_debt`:

| | |
|---|---|
| **Precision** | when it said this class, how often was it right |
| **Recall** | of all the real ones, how many did it find |
| **F1** | the two combined |
| **Support** | how many test examples that class had ← **the one people forget** |

`sklearn.metrics.classification_report(y_true, y_pred)` prints exactly this table.
Also save the confusion matrix — it shows *which* classes get confused with each other,
which is the interesting question and the one an evaluator will ask.

For the risk model add **AUC** (Area Under the Curve — the chance the model ranks a
random buggy file above a random clean one; 0.5 is a coin flip).

#### A2.3 — Serve the trained model

`registry.py` already defines how this works: models load **once at startup**, cached,
never per request. A scan classifies tens of thousands of comments, so re-loading per
batch would dominate the cost.

Swapping a model is meant to be *drop an artifact, set the version, restart* — with no
code change anywhere, and nothing in `apps/api` knowing what algorithm is inside. Keep
it that way: no training code, no dataset paths and no scikit-learn imports in the
serving path.

#### A2.4 — Bug-risk model (only if time allows)

Explicitly optional, and the system is designed to run without it: when the service is
unreachable every `risk_score` falls back so that ranking is unaffected — the dashboard
shows rule findings and SATD findings exactly as normal.

If you do not get to it, say so plainly in the write-up. **A missing model honestly
reported is a better result than a rushed one presented as finished.**

#### A2.5 — Record which model version produced what

Every response already carries `model_version`, and `HealthReport.model_version` carries
it through to the dashboard — `null` when a snapshot was taken with no ML available.

This is what makes a result reproducible: six months from now, "why did this file score
0.8?" is answerable only if you know which model said so.

#### A3.1 — The write-up

Per class, with counts, and honest about what is not trained yet. Include the confusion
matrix and one paragraph on what the model is bad at — evaluators trust a report that
names its own weaknesses far more than one that does not.

---

### The one thing that protects your schedule

Your work is **not** on the demo's critical path, and that is by design: when the model
service is unreachable the scan still completes, every rule finding still appears, and
risk comes back as "not measured". Nobody should re-plan around waiting for models.

**But that only holds if A1.2 and A1.3 land on time.** The moment the endpoints answer
in the right shape, Chamodh is unblocked whether or not a real model exists behind them.
Ship the shape early, and the accuracy whenever it is ready.

---

## 9. Deployment plan

### The shape

| Piece | Where | Cost |
|---|---|---|
| Postgres | **Neon** | Free tier |
| Redis | **Upstash** | Free tier |
| web, api, worker, ml | **Railway** | $5 plan, used carefully |

Railway's advantage for us: it has no fixed idea of what a service must be. You give it an image and a command, so the Celery worker — which serves no web traffic and just pulls jobs forever — simply runs. Some platforms have no category it fits into.

### Keeping it inside $5

$5 is a **minimum spend, not a limit**. Four containers running all the time cost roughly $10–20 a month, so $5 buys about **ten days of full uptime**.

Three ways to stay inside it:

1. **Do not run it continuously.** Stopped services cost nothing. Deploy on the 19th, check it, stop it. Restart on the 23rd and leave it up through the evaluation.
2. **Leave the ML container off until needed.** It is the heaviest of the four, and the system is built to work without it. Start it for Nathasha's part of the demo.
3. **Set modest memory limits** on each service. Generous defaults are money spent on nothing.

> **Set the spending cap at about $15, not $5.** When a hard limit is reached Railway *stops your services*. A cap at exactly $5 could take the site down mid-demo. Control the money by controlling when things run; use the cap only as a safety net against something stuck in a loop overnight.

*Check current prices yourself before committing — these pages change.*

### Turning it off and on

You can stop or delete the Railway services whenever you like. The configuration lives in the repository, so bringing it back is minutes.

- **Neon and Upstash stay up** — they are free, and they hold the data. Your database survives Railway being switched off entirely.
- **Secrets live in the Railway dashboard, not in git.** Deleting services means re-entering them. `apps/api/.env.example` lists every one, so keep it accurate.

### Scaling — worth being able to explain

| Part | How it scales | Why |
|---|---|---|
| Web | Add copies | Holds no state |
| API | Add copies | The session is in the database, so any copy can serve any request |
| **Worker** | **Add copies** | The important one. Each worker runs one scan at a time on purpose, because a scan needs its own clone and its own disk space |
| Postgres | A bigger instance | |
| Redis | Rarely the bottleneck | It only holds progress percentages and cancel flags |

The sentence worth saying out loud at the evaluation: **three concurrent scans is a number we change in a dashboard, not a code change.** That falls straight out of the architecture.

### Storage note

Each running scan clones a repository and needs roughly 2 GB of scratch space. **Do not put that on a paid storage volume** — clones are thrown away when the scan ends, so ordinary container disk is right. Keep paid storage for the database only.

---

## 10. Testing and CI

### What runs on every pull request

| Check | What it protects |
|---|---|
| Frontend tests | The dashboard still renders and behaves |
| Type check | Nothing refers to a field that no longer exists |
| Contract check | The contract and the generated types have not drifted apart |
| Backend tests | Database shapes and the scoring formula are still correct |
| Layer check (`lint-imports`) | Scoring stays pure; the worker never calculates scores |
| Lint | |
| **Image build** | It builds on a clean machine, not just on a laptop |

**A red pull request does not get merged.** Turn on branch protection so this is enforced by GitHub, not by good intentions — otherwise it is theatre.

### What to add this week

- **Backend:** tests for the endpoints in Chamodh's Phase A — signed out gives 401, signed in gives data, one workspace cannot see another's rows.
- **Frontend:** the existing tests must survive the rename. They are the safety net for a 244-place change; without them it is guesswork.
- **End to end:** one Playwright test that walks the whole demo path. If that passes, the demo passes.

### Deploying automatically

Once CI is green and steady, have a merge to `main` redeploy. Do this **after** the first manual deploy works — automating something you have never done by hand only hides the failure.

> **This is J4.5, and the manual deploy now works.** The full workflow job, the Railway project
> token, and the two things to verify before trusting it are in
> **[deployment log, Entry 5, Step 6](deployment-implementation-log.md#step-6--auto-deploy-on-main)**.
> Do **J0.8 (branch protection)** first — auto-deploy without required checks means a red pull
> request can reach the live site.

### What CI still does not check

| Not checked | Why it matters |
|---|---|
| **Playwright** | The `web` job runs `pnpm test:run`, which is vitest only. The end-to-end suite that walks the demo path is a local gate, not a merge gate |
| **The CK jar** | No test exercises the extractor with a real jar, which is why an image that cannot scan has been published green since 20 Aug |
| **Ruff on `apps/api`** | Advisory — 31 pre-existing findings, log Entry 3 |
| **Prettier** | 97 files fail `--check`. PR B1 (P1) formats the repository, and the check can be added after |

---

## 11. GitHub Project — milestones and issues

### Set it up in this order

**1. Create the labels** (Issues → Labels → New label):

`web` · `api` · `ml` · `infra` · `docs` · `blocked` · `demo-critical`

**2. Create three milestones** (Issues → Milestones → New milestone):

| Milestone | Due | Done when |
|---|---|---|
| **M1 — Buildable and checked** | Tue 18 Aug | All six containers build; CI blocks a failing pull request |
| **M2 — Deployed** | Wed 19 Aug | Live URL; signed-out requests return 401; sign-in works |
| **M3 — One path end to end** | Sun 23 Aug | Scan a real repository on the live site and see the dashboard |
| **M4 — Evaluation ready** | Tue 25 Aug | Rehearsed three times; document finished |

**3. Create a Project board** (Projects → New project → Board):

Columns: `Backlog` · `This week` · `In progress` · `In review` · `Done`

**4. Create one issue per row** in the tables below. Each needs an assignee, a milestone, a label, and one line saying **how we know it is done** — copy the "Done when" column.

**5. Link pull requests to issues.** Put `Closes #12` in the pull request description and GitHub closes the issue when it merges. This is what makes the board update itself instead of rotting.

**6. Anything not needed by the 25th goes in `Backlog` with no milestone.** Being able to show a marker "here is what we deliberately deferred, and why" is worth more than a board where everything looks urgent.

### The issues

| # | Issue | Who | Milestone | Label |
|---|---|---|---|---|
| 1 | Write `apps/web/Dockerfile` | Janidu | M1 | web, infra |
| 2 | API address as a build argument, not a runtime setting | Janidu | M1 | web, infra |
| 3 | Make all six containers build and start together | Janidu | M1 | infra |
| 4 | CI: run tests, type check, contract check, layer check | Janidu | M1 | infra |
| 5 | CI: build all three images | Janidu | M1 | infra |
| 6 | CI: publish images to GitHub Container Registry | Janidu | M1 | infra |
| 7 | Branch protection — a red pull request cannot merge | Janidu | M1 | infra |
| 8 | Neon database created and migrated | Janidu | M2 | infra |
| 9 | Upstash Redis created | Janidu | M2 | infra |
| 10 | Four containers deployed to Railway | Janidu | M2 | infra |
| 11 | Asgardeo callback address set for the live site | Janidu | M2 | infra |
| 12 | Signed-out request returns 401 on the live site | Janidu | M2 | infra, demo-critical |
| 13 | Spending cap set | Janidu | M2 | infra |
| 14 | Regenerate types from the contract | Janidu | M3 | web |
| 15 | Rename every field to snake_case | Janidu | M3 | web |
| 16 | Category filter shows five chips | Janidu | M3 | web |
| 17 | Profiles page: five weights and the trust slider | Janidu | M3 | web |
| 18 | Add `cancelled` to the scan states | Janidu | M3 | web |
| 19 | Sign-in points at the real backend | Janidu | M3 | web, demo-critical |
| 20 | Every request sends the session cookie | Janidu | M3 | web, demo-critical |
| 21 | Mock handlers updated to the new shapes | Janidu | M3 | web |
| 22 | List and connect projects | Chamodh | M2 | api |
| 23 | List branches | Chamodh | M2 | api |
| 24 | Scan history | Chamodh | M2 | api |
| 25 | Read and apply a profile, in one transaction | Chamodh | M2 | api |
| 26 | Endpoint tests: 401, data, tenant isolation | Chamodh | M2 | api |
| 27 | Start a scan | Chamodh | M3 | api, demo-critical |
| 28 | Poll scan status | Chamodh | M3 | api, demo-critical |
| 29 | Stop a scan | Chamodh | M3 | api |
| 30 | Progress published to Redis | Chamodh | M3 | api |
| 31 | Scan pipeline end to end | Chamodh | M3 | api, demo-critical |
| 32 | Rule engine produces real findings | Chamodh | M3 | api, demo-critical |
| 33 | Scoring calculation and the dashboard read | Chamodh | M3 | api, demo-critical |
| 34 | Choose a demo repository | Chamodh | M4 | api, demo-critical |
| 35 | Model service health endpoint | Nathasha | M2 | ml |
| 36 | SATD endpoint returns predictions in the contract's shape | Nathasha | M2 | ml |
| 37 | Risk endpoint returns a score | Nathasha | M2 | ml |
| 38 | Tests for both endpoints | Nathasha | M2 | ml |
| 39 | Train the SATD classifier on SATDAUG | Nathasha | M3 | ml |
| 40 | Evaluate per class, with counts | Nathasha | M3 | ml |
| 41 | Serve the trained model | Nathasha | M3 | ml |
| 42 | Record model versions | Nathasha | M3 | ml |
| 43 | Bug-risk model (only if time allows) | Nathasha | Backlog | ml |
| 44 | Write the model results section | Nathasha | M4 | docs |
| 45 | End-to-end test of the demo path | Janidu | M4 | web |
| 46 | Automatic redeploy when `main` changes | Janidu | Backlog | infra |
| 47 | Update the Gantt chart | Janidu | M4 | docs |
| 48 | Write the mid-evaluation document | all | M4 | docs |
| 49 | Add `pnpm verify`, then format the repo (#86) | Janidu | M4 | web |
| 50 | Navigation unreachable below `md`; rail jumps to the wrong repo (#87) | Janidu | M4 | web, bug, demo-critical |
| 51 | Build the Scan History page (#88) | Janidu | M4 | web |

> **Rows 49–51 added 25 Aug 2026.** They came out of #69 when the frontend audit was re-run: a
> chore that must land alone, a behaviour bug, and a feature. #69 keeps only the polish (P4–P7).
> The numbers in this table are row numbers, not issue numbers — the issue is in brackets.


---

## 12. The mid-evaluation document

Create `docs/Progress Evaluations/progress_evaluation_02_2026-08-25.md`, in the same style as the last one:

1. **What works today** — with the live URL. Demonstrate, do not describe.
2. **What is designed but not built** — say it plainly. "Designed and stubbed, not implemented" costs nothing; being caught overstating costs everything.
3. **The architecture, and why** — a modular monolith rather than microservices, and the reasons.
4. **Decisions we reversed, and why** — this is a strength, not an admission. Sign-in moved from the browser to the backend. Six debt categories became five when the dataset turned out to have no label for the sixth. Profiles stopped being versioned. Each one has a written record.
5. **How the work is divided** — folder ownership, and the contract that makes parallel work possible.
6. **Quality** — what CI checks on every pull request, what the tests cover, what they do not.
7. **Model results so far** — per class, with counts. Never accuracy.
8. **Deployment and scaling** — how three concurrent scans is a setting, not a rewrite.
9. **What is next, and what we deliberately deferred.**

**Rule for the whole session:** never claim something is done when it is a skeleton.

---

## 13. Honest risks

| Risk | Likely | What we do |
|---|---|---|
| The first deployment eats a whole day | High | Which is why it is on day three, not day eight |
| Sign-in works locally, fails on the live site | High | Almost always the callback address not matching Asgardeo exactly. Check on the first deploy |
| The frontend rename takes longer than planned | High | It is mechanical and the compiler finds every place. Start Thursday, not Saturday |
| The scan pipeline is not finished by the 23rd | Medium | Demo on a small repository. Five files prove the same pipeline as five hundred |
| Models not trained in time | Medium | **Already handled by the design.** The scan finishes without them |
| Railway bill grows unnoticed | Medium | Cap at $15; keep it stopped when not needed |
| Something breaks on the 24th | Medium | Code freeze Monday midday. After that, only fixes for broken things |

---

## 14. The Gantt chart needs updating

Three things on it no longer match reality:

- **"Implement Multi-tenancy, Auth & RBAC" shows as not started.** Multi-tenancy and sign-in are done. Role-based access is a version 2 feature we decided not to build — it should be removed, not left looking unfinished.
- **There is no row for deployment and none for CI.** Both are happening this week. Work that is not on the chart looks like work that was not planned.
- **The dates run behind.** Better to move them and explain why than to present a chart everyone can see is wrong.

A chart that matches reality is evidence of managing the project. One that does not is evidence of the opposite.
