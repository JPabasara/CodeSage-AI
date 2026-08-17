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

## 4. What we found when we checked the deployment

Three things were assumed to work and do not. All three are Janidu's Phase 0.

| Finding | Why it matters |
|---|---|
| **There is no `apps/web/Dockerfile`** | `infra/docker-compose.yml` says to build the web app from that folder, but the file does not exist. **The six-container stack cannot be built today.** Nobody noticed because the frontend has only ever been run with `pnpm dev` |
| **The frontend's API address is frozen when the image is built** | Next.js replaces `NEXT_PUBLIC_API_BASE_URL` with plain text at build time — it does *not* read it when running. Setting it in the compose file does nothing to a built image. Deploy it anywhere and it still points at `localhost:8000` |
| **`docker compose up` has never been run end to end** | We have never seen all six containers build and talk to each other. Whatever is wrong, we want to know now, not on the 24th |

**One earlier worry turned out to be fine:** the API image already installs Java for the CK tool ([apps/api/Dockerfile:25](../../apps/api/Dockerfile#L25)) and sets `CODESAGE_CK_JAR`. Nothing to do.

---

## 5. The idea that shapes the whole deployment

> **Get the project deployable *anywhere*, and the choice of host becomes a small decision you can change later.**

Concretely: if a clean machine that has never seen your laptop can build and run the images, then any host can run them. If it only builds on your machine, you do not have a deployment — you have a laptop.

**That is what CI is really for here.** CI does exactly what a hosting platform does: check out the code fresh, build the images, run the tests. If CI is green, the app is portable, proven rather than assumed.

Then one extra step makes it real: **CI pushes the built images to GitHub Container Registry** (free for public repositories). After that, deploying anywhere is "pull this image and run it" — Railway, a rented server, DigitalOcean, all identical. Build once, run anywhere.

This is why deployment work comes before frontend work, and why it does not block anyone.

### Where we stand on being deployable anywhere

| Needed | Status |
|---|---|
| API image builds, with Java for CK | ✅ done |
| ML image builds | ✅ done |
| Every setting comes from an environment variable | ✅ nothing reads the environment directly |
| The required variables are written down | ✅ `apps/api/.env.example` |
| Database migration is a step you can run | ✅ alembic |
| A health endpoint for the platform to check | ✅ `/api/healthz` |
| Services keep nothing in memory | ✅ sessions live in the database |
| **Web image builds** | ❌ Phase 0 |
| **Frontend API address is configurable** | ❌ Phase 0 |
| **CI** | ❌ Phase 0 |
| **Images published** | ❌ Phase 0 |

---

## 6. Janidu — deployment, CI, then frontend

### Phase 0 — the shared files (Mon 17 – Tue 18). One pull request.

| # | Step | Done when |
|---|---|---|
| J0.1 | Write `apps/web/Dockerfile` | It builds the production Next.js app |
| J0.2 | Pass the API address in as a **build argument**, not a runtime setting | Building with a different address produces an image that points somewhere else |
| J0.3 | Run `docker compose up` and make all six containers build and start | Six containers healthy at the same time, first time ever |
| J0.4 | Fix whatever step 3 reveals | Step 3 passes from a clean checkout |
| J0.5 | CI: on every pull request run frontend tests, type check, contract check, backend tests, layer check | A pull request that breaks any of them shows red |
| J0.6 | CI: build all three images | The build runs on a clean machine, not just yours |
| J0.7 | CI: push the images to GitHub Container Registry | The images are pullable by tag |
| J0.8 | Make failing checks block merging (branch protection on `main`) | A red pull request cannot be merged |

**Merge this, then tell the group. That is the green light.**

### Phase 1 — deploy (Wed 19)

| # | Step | Done when |
|---|---|---|
| J1.1 | Create a Neon account, get a Postgres database | You can connect to it |
| J1.2 | Run the database migration against Neon | Tables exist — check them in Neon's web console |
| J1.3 | Create an Upstash account, get a Redis address | It responds |
| J1.4 | Deploy the four containers to Railway from the published images | All four running |
| J1.5 | Fill in every setting in the Railway dashboard | Nothing secret is in the repository |
| J1.6 | Add the live callback address in the Asgardeo console | It matches the deployed address exactly, character for character |
| J1.7 | Check `/api/healthz` answers | 200 |
| J1.8 | **Check `/api/projects` returns 401 when signed out** | This is the security working — do not skip it |
| J1.9 | Sign in on the live site | You reach the dashboard |
| J1.10 | Set a spending limit of about $15 | Not $5 — see section 8 |

### Phase 2 — frontend (Thu 20 – Sun 23)

This is Phase 10.6 from the build guide. Do it in this order — the first step generates the errors that find the rest.

| # | Step | Done when |
|---|---|---|
| J2.1 | `pnpm gen:types` | Types regenerate from the contract |
| J2.2 | Rename every field to snake_case | Type check passes. About 244 places; the compiler lists every one |
| J2.3 | Category filter: five chips, `defect` removed | Five categories show |
| J2.4 | Profiles page: five weights plus the trust slider | Six numbers, and Apply saves them |
| J2.5 | Add `cancelled` to the scan states | A stopped scan shows correctly |
| J2.6 | Sign-in button points at the real backend | It is a plain link, never a fetch — the browser has to leave the page |
| J2.7 | Add `credentials: "include"` to every request | Without this no request carries the session and everything returns 401 |
| J2.8 | Update the mock handlers to the new shapes | Tests still run with no backend |
| J2.9 | Redeploy and walk the whole path on the live URL | It works there, not just locally |

---

## 7. Chamodh — the API and the worker

Start on Monday in `apps/api/src/`. Pull `main` after Janidu's Phase 0 lands on Tuesday evening.

### Phase A — make the read endpoints return real data (Mon 17 – Wed 19)

The frontend needs these to have anything to show.

| # | Step | Done when |
|---|---|---|
| C1.1 | `GET /api/projects` | Returns the workspace's repositories |
| C1.2 | `POST /api/projects` | Connecting a public GitHub repository adds it, and it survives a refresh |
| C1.3 | `GET /api/repos/{id}/branches` | Real branch names from GitHub |
| C1.4 | `GET /api/repos/{id}/scans` | Scan history for a branch |
| C1.5 | `GET /api/profiles` and `GET /api/profiles/active` | Returns the six numbers |
| C1.6 | `PUT /api/profiles/active` | See the warning below |
| C1.7 | Tests: signed out gives 401, signed in gives data, one workspace cannot see another's rows | Tests pass |

> ⚠️ **On applying a profile.** The database guarantees *at most* one active profile — **not at least one**. Clearing the old row and setting the new one must happen in a single transaction. A clear that commits on its own leaves the workspace with no active profile at all. Also remember profiles are **not versioned**: the same row is updated in place.

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
