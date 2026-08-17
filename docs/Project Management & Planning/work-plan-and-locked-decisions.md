# What to do next — one working day

*Working plan · 15 Aug 2026 · Group 16. Not a deliverable. Delete it when the list is done.*

Work through this **top to bottom**. Each step is finished before the next one starts,
because later steps depend on earlier ones. When you reach the end you can start
frontend **Phase 10.6** and keep going without stopping to ask anyone a question.

Nobody else is pushing while you do this, so you can edit any branch freely.

| # | Step | Time | Why it is here |
|---|---|---|---|
| 0 | [Set up](#step-0--set-up-5-min) | 5 min | Know what you are starting from |
| 1 | [Refresh SRS and SAD in Word](#step-1--refresh-the-two-documents-in-word-15-min) | 15 min | v1.1 is written; Word must renumber it |
| 2 | [Fix the diagrams](#step-2--fix-the-diagrams-2-hours) | 2 h | The documents now say things the pictures contradict |
| 3 | [Fix the backend](#step-3--fix-the-backend-about-4-hours) | 4 h | The API has **no authentication at all** today |
| 4 | [Close the Celery branch](#step-4--close-the-celery-branch-15-min) | 15 min | It duplicates work that already exists elsewhere |
| 5 | [Check the API contract](#step-5--check-the-api-contract-20-min) | 20 min | It is the input to Phase 10.6 |
| 6 | [Start Phase 10.6](#step-6--start-frontend-phase-106) | — | The finish line |

---

## Step 0 — Set up (5 min)

```bash
git fetch --all
git status          # your own work is uncommitted; that is expected
```

**Where things stand right now.**

| Thing | State |
|---|---|
| SRS v1.1 and SAD v1.1 (`.docx`) | **Written.** In `docs/Deliverables/SRS/v1.1/` and `docs/Deliverables/SAD/v1.1/` |
| SRS and SAD Markdown copies | **Written.** Generated from the `.docx`, so they cannot drift |
| API contract `docs/api/openapi.yaml` | **Written and verified.** No changes needed |
| The 16 UML diagrams | **Out of date.** Step 2 |
| `origin/chamodh/backend` | Database and migration good. **Authentication is frontend-only — the API is open.** Step 3 |
| `origin/feature/setup-celery-redis` | Superseded. Step 4 |
| Frontend | Working against the mock backend. Waiting on Phase 10.6 |

> **Nothing in this list is committed for you.** Review, then commit in your own words.

> ⚠️ **Do not run a bare `git add -A` from the repository root.**
> `apps/ml/data/raw/GHPR_dataset` is a **git repository inside this git repository**.
> The 359 MB of data is correctly ignored, but the folder itself would be committed
> as a broken submodule pointer that no one else can clone. Add paths explicitly
> (`git add docs README.md apps/web`), or delete the nested `.git` folder if you do
> not need that dataset's own history.

---

## Step 1 — Refresh the two documents in Word (15 min)

The v1.1 files are already written. Word still needs to renumber them, because the
table of contents, the list of tables and every "Table 3.10x" caption are **fields** —
Word calculates them, and it only recalculates when you ask.

Do this for **both** files:

`docs/Deliverables/SRS/v1.1/Software_Requirement_Specification_v1.1.docx`
`docs/Deliverables/SAD/v1.1/Software_Architecture_Document_v1.1.docx`

1. Open in Word.
2. **Ctrl + A**, then **F9**. If a box asks, choose **Update entire table**.
3. Press **F9** a second time. The first pass fixes the numbers, the second fixes the
   page references that moved because the numbers changed.
4. Skim the table of contents. New entries should appear: **SEC-17 to SEC-20**,
   **PERF-11**, **DBR-36**, and a new **section 6.4 "Signing in"** in the SAD.
5. Save.

Then read the **Revision History** row on page 1 of each. It says what changed and
why. If a marker asks "what is different in v1.1?", that row is the answer.

**What changed, in one paragraph each:**

- **SRS v1.1** — sign-in is Asgardeo instead of GitHub directly; the backend holds the
  tokens and the browser only gets a cookie; four new security requirements
  (SEC-17 to SEC-20) say that is *required*, not just how we happened to build it;
  a dashboard speed requirement (PERF-11) that was missing; a session table (DBR-36);
  and the four sign-in rows of the endpoint table were **listed against the wrong
  descriptions** — each row carried the *next* row's meaning — so they are fixed.
- **SAD v1.1** — matches the SRS; a new §6.4 explains the sign-in exchange the same way
  §6.2 explains the profile write; §2 now says what the architecture actually *is*
  (a modular monolith) and why we did not build microservices; the profile is six
  numbers, not seven; and prose that mentioned `SCAN` and `FILE_SCORE` tables now uses
  the tables the data model really has.

> If you ever need to change the `.docx` again, edit it in Word and then run
> `python docs/tools/_docx_to_md.py` so the Markdown copy follows.

---

## Step 2 — Fix the diagrams (2 hours)

Open `docs/Diagrams/UMLs/UML_drawio_link_all_versions.txt` for the draw.io link, and
work through the list. **Export each one as PNG with a white background** — not
transparent. Transparent backgrounds are why black lines and black text disappeared
in the submitted document.

Export to `docs/Diagrams/UMLs/v1.1/` as `<name> v1.1.png`, then re-insert each one
into the v1.1 `.docx` in place of the old image.

### Where you are

| Exported to v1.1 already | Still to do |
|---|---|
| Apply_Profile · ERD · Scan_Activity · Scan_Sequence · class diagram · deployement · implementation_view · score · signin | **Figure 1 Overall** (needs the Asgardeo actor) · **Figure 2 logical view** (missing entirely — see below) · **Figure 9** (two wrong labels) · a few leftovers on the class diagram |

The five remaining use-case diagrams — connectrepo, scan, health, filter, history —
have **no content changes**. They still need re-exporting on a white background,
because that is what broke them in the submitted document, but nothing inside them
moves. `manageteam` is a v2 use case the SAD does not reference; leave it alone.

> **Correction to what I said earlier.** I told you the package diagram was missing
> and Figure 9 had to be drawn from scratch. That was wrong — I read the images inside
> the `.docx` and **Figure 9 is present**. The figure with no image is **Figure 2**,
> the logical view. Both are covered below, and Figure 2 is the smaller job.

### The export setting — do this first

In draw.io: **File → Export as → PNG**, then **untick "Transparent Background"** and
set **Zoom 200%**. Do it for every diagram, including the ones with no content change.
About half of the complaints about the submitted document come from this one setting.

### Figure 1 — Use-case overview (`Code Sage AI-Overall.drawio.svg`)

| Change this | To this |
|---|---|
| Actor **GitHub** connected to *Sign In* | Remove that line. GitHub is no longer the sign-in actor |
| — | Add a new actor **Asgardeo (Identity Provider)** and connect it to *Sign In* only |
| Actor **GitHub** connected to *Connect Repository* and *Run Repository Scan* | Keep. GitHub is still where code comes from |

**Why:** signing in and reading code are now two separate things. Asgardeo proves who
you are; GitHub gives us the code. Showing GitHub doing both is the old design.

### Figure 1.1 — Sign In (`Code Sage AI-signin.drawio.svg`)

| Change this | To this |
|---|---|
| `Redirect to GitHub Authentication` | `Redirect to Asgardeo` |
| `Authenticate User via GitHub` | `Authenticate at Asgardeo (GitHub federated)` |
| `Receive Authentication Token` | `Exchange code for token (backend only)` |
| `Create User Session` | `Create server-side session + set cookie` |
| Actor `GitHub Authentication Service` | `Asgardeo Identity Provider` |

**Why:** the browser never receives a token now. The backend does the exchange and
hands the browser a cookie. That is the whole point of the security change, so the
picture has to show it.

### Figure 1.2 to 1.7 — the other use cases

Only one change, in `Code Sage AI-score.drawio.svg` (Figure 1.6):

| Change this | To this |
|---|---|
| `Adjust slider` | `Adjust five category weights and trust slider` |

The rest — connectrepo, scan, health, filter, history — are fine as they are.

`Code Sage AI-manageteam.drawio.svg` is a **v2** use case and is not referenced by the
SAD. Leave it where it is; do not add it to the document.

### Figure 3 — Class diagram (`Code Sage AI-class diagram v1.1.png`)

**Mostly done already.** I read the v1.1 image: `Session` is there, `User` has
`asgardeoSub`, both `ScoringProfile` and `ScoringPreset` carry the same five weights
with no `defect`, and `AnalysisStatus` includes `CANCELLED`. Four things are left, all
in the same corner of the diagram:

| Change this | To this |
|---|---|
| `AuthenticationService.authenticateWithGitHub(authorizationCode)` | `authenticateWithAsgardeo(authorizationCode, codeVerifier)` — the app no longer talks to GitHub for identity |
| `GithubGateway.exchangeAuthorizationCode()` · `getAuthenticatedUser(accessToken)` · `getAccessibleRepositories(accessToken)` | **Move all three out** into a new `IdentityProviderGateway`, or delete them. GitHub is now metadata and cloning only, so a GitHub access token never exists |
| — | Add **`IdentityProviderGateway`** with `buildAuthorizationUrl(state, challenge): String` and `exchangeCode(code, verifier): IdentityClaims`. It is the only class that ever sees a provider token |
| `Theme` enum = `LIGHT`, `DARK` | Add `SYSTEM` — the code has three values (`db/enums.py`) |

**Why the gateway split matters:** it is the same rule as `source` vs `category` —
one class, one reason to exist. `GithubGateway` answering both *"who is this user?"*
and *"what branches does this repo have?"* is what let the old design hold a GitHub
token on the user's behalf. Splitting it makes that impossible to reintroduce by
accident.

### Figure 4 — Scan activity (`Code Sage AI-Scan_Activity.drawio.svg`)

| Change this | To this |
|---|---|
| `phase = cancel` | `phase = cancelled` — the value the code and the contract use |
| `Store snapshot` | `Store snapshot (ANALYSIS_ATTEMPT → SNAPSHOT)` |
| Protocol labels rendering dark | Re-colour every edge label to a **dark grey on white**, then export white-background |

**Why the last one:** ten arrow labels (`SQL over TLS`, `Redis: publish NN%`, and so
on) are unreadable in the submitted PDF. They are not missing, they are black on black.

### Figure 5 — Scan sequence (`Code Sage AI-Scan_Sequence.drawio.svg`)

| Change this | To this |
|---|---|
| `INSERT SCAN (phase = queued)` | `INSERT ANALYSIS_ATTEMPT (phase = queued)` |
| `SELECT SHA of last scan where phase = done` | `SELECT SHA of last attempt that produced a SNAPSHOT` |
| `[every 1 s until the phase is done,error or udle]` | `[every 1 s until phase is done, error or cancelled]` — `udle` is a typo and `idle` is not a terminal state |
| `POST /api/repos/{repoId}/scan` | `POST /api/repos/{repo_id}/scan` |

### Figure 6 — Apply a profile (`Code Sage AI-Apply_Profile.drawio.svg`)

This one has the most changes because it still shows the old profile shape.

| Change this | To this |
|---|---|
| `six weights, trust_slider` | `five weights, trust_s` |
| `PUT /api/profiles/active { six weights, trust_s }` | `PUT /api/profiles/active { five weights, trust_s }` |
| `one transaction, seven numbers` | `one transaction, six numbers` |
| `read WORKSPACE.active_profile_id, SCORE_PROFILE` | `read the active SCORING_PROFILE for the workspace` |
| `UPDATE SCORE_PROFILE, SET WORKSPACE.active_profile_id` | `UPDATE SCORING_PROFILE, mark it active` |
| `GET /api/repos/{repoId}/health?branch=...` | `GET /api/repos/{repo_id}/health?branch=...` |

**Why six numbers:** five category weights plus one trust slider. "Seven" is left over
from when there were six categories, before `defect` was removed.

### Figure 7 — Deployment (`Code Sage AI-deployement.drawio.svg`)

| Change this | To this |
|---|---|
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | `ASGARDEO_CLIENT_ID`, `ASGARDEO_CLIENT_SECRET`, `ASGARDEO_BASE_URL`, `SESSION_SECRET` |
| — | Add an external node **Asgardeo (Identity Provider)** with an arrow **from the Backend API container only**, labelled `HTTPS / OIDC` |
| `HTTPS/ OAuth 2.0 ?REST` on the GitHub arrow | `HTTPS / REST (read-only)` — GitHub does no authentication now |
| `REST?JSON` | `REST / JSON` — the `?` is a broken slash |
| `Backend API? Container` | `Backend API Container` |
| `Backend API Container` | `Backend API Container` — *the only container published to the internet* |
| — | Draw a dashed boundary around **postgres, redis, ml and worker**, labelled **"private network — not reachable from the browser"**, with the API container sitting on its edge |

**Why the identity-provider arrow starts at the backend, not the browser:** the browser
is *redirected* to Asgardeo, but it never exchanges a token with it. Drawing an arrow
from the browser would show the design we specifically rejected.

**Why a boundary line and not a "Backend-for-Frontend" label.** A deployment diagram
should say what runs where and what can reach what. "Backend-for-Frontend" is the name
of a design pattern, so it asserts something a reader has to take on trust — and the
classic version of that pattern is about serving *several* different frontends, which
we do not. The dashed boundary shows the same thing as a fact the reader can check
against `docker-compose.yml`: only `web` and `api` have published ports. Keep the term
**BFF** in the prose, where SAD §2 and §6.4 have room to define it.

### Figure 8 / 9 — Implementation view (`Code Sage AI-implementation_view.drawio.svg`)

| Change this | To this |
|---|---|
| `(lib/types Contract)` | `(OpenAPI contract — docs/api/openapi.yaml)` |
| `Writes Findings & Scores` | `Writes Findings & Facts` — workers never write scores |

**Why:** the second one is a rule the whole design rests on. Workers store facts; the
API works out scores when you open the dashboard. If the worker wrote scores, changing
a profile would need a re-scan.

### Figure 9 — Package diagram · **it already exists; two labels are wrong**

I checked the images inside the `.docx`. **The package diagram is there**, sitting
under its caption in §8. It is the wide one with Presentation / Data Layer / External
Systems columns. So there is nothing to draw — only two fixes:

| Change this | To this |
|---|---|
| The **second** big box is labelled `Presentation Layer` | `Application / Domain Layer`. Two boxes currently carry the same name, and the second one holds Authentication Service, Scoring Engine, Rule Engine and Celery Tasks — none of which is presentation |
| `Persistance` | `Persistence` — spelling |

Optional but worth it: add a short note under the diagram saying that
`Scoring Engine` is never reached from `Celery Tasks`, and that this is enforced by
`lint-imports` in `apps/api/pyproject.toml` rather than by convention. Every project
claims its layers are clean; you can show yours are checked by CI, which is unusual
at this level.

### Figure 2 — **this is the one that is missing**

The gap is not Figure 9. It is **Figure 2, "Logical decomposition into subsystems and
layers"**. Its caption is in §5.1 with nothing above it, and the §2 view table
promises it too.

It is a small diagram — four boxes, not thirty. Draw the four subsystems from
Table 5-1, which is already written directly above the caption:

| Box | Label inside |
|---|---|
| **Frontend** | `apps/web` — Next.js. Pages, dashboard views, API client |
| **Backend** | `apps/api` — FastAPI + Celery. Routers, domain services, scoring engine, rule engine, scan pipeline |
| **ML Service** | `apps/ml` — scikit-learn. SATD classifier, bug-risk model, versioned artifacts |
| **Database** | PostgreSQL. Tenants, repositories, attempts, snapshots, findings, metrics |

Arrows between them:

```
Frontend  → Backend       HTTPS / REST (OpenAPI contract)
Backend   → Database      SQL over TLS
Backend   → ML Service    HTTP, from the worker only
Backend   → GitHub        HTTPS, read-only
Backend   → Asgardeo      HTTPS, OIDC
```

Two notes to put on the picture, because they are the two things this diagram is
uniquely able to show:

- on the **Backend** box: *"API and worker are the same codebase and the same image,
  run with different commands"*
- on the arrow into **Database**: *"the worker writes facts; the API derives every
  score when the dashboard is read"*

Keep it deliberately plain. Figure 9 already shows the packages in detail and Figure 7
already shows the containers. Figure 2's job is the one-glance view a reader sees
first, so four boxes and five arrows is the right amount.

Export as `Code Sage AI-logical_view v1.1.png` and insert it **above** the existing
"Figure 2. Logical decomposition into subsystems and layers" caption in §5.1 — the
other figures in that half of the document put the caption below the image, so match
them.

### Figure 10 — ER diagram (`Code Sage AI-ERD.drawio.svg`)

Same six changes as the class diagram, plus:

| Change this | To this |
|---|---|
| No `Session` table | Add **Session** with a foreign key to `User` and to `Workspace` |
| `satdPreditionId` | `satdPredictionId` — spelling |
| Entity boxes have no attributes visible | Make sure attribute rows are **inside** each box, not floating name plates. In the submitted PDF this diagram exported as 24 loose labels with no relationships |

**The ER diagram is the one to spend the most time on.** In the submitted document it
carries no information at all — no attributes and no relationship lines survived the
export. Re-export it white-background at 200% zoom and check the PNG before inserting.

### When you finish

Already exported to v1.1:

- [x] Figure 1.1 signin · Figure 1.6 score · Figure 4 activity · Figure 5 sequence ·
      Figure 6 profile · Figure 7 deployment · Figure 8 implementation · Figure 10 ERD
- [x] Figure 3 class diagram — the schema half is done

Still to do:

- [ ] **Figure 1 Overall** — Asgardeo actor added, GitHub disconnected from Sign In
- [ ] **Figure 2 logical view** — draw it; four boxes, five arrows
- [ ] **Figure 3** — the four auth leftovers (gateway split, `Theme.SYSTEM`)
- [ ] **Figure 9** — `Presentation Layer` → `Application / Domain Layer`, `Persistance` → `Persistence`
- [ ] Re-export on white: connectrepo · scan · health · filter · history

Then:

- [ ] Every export is PNG, **white background**, 200% zoom
- [ ] All saved in `docs/Diagrams/UMLs/v1.1/` as `<name> v1.1.png`
- [ ] Figure 2 inserted above its caption in SAD §5.1 — the caption is already there
      with nothing above it
- [ ] Opened the `.docx` and confirmed every figure is readable at 100% zoom

> **Last check before you close Word.** The captions must run
> 1 · 1.1–1.7 · 2 · 3 · 4 · 5 · 6 · 7 · 8 · 9 · 10 with **one image each** — 17
> figures, 17 images. Right now there are 16 images, and Figure 2 is the one without.
> Inserting a picture does not renumber anything, so the only way to get this wrong is
> to drop it in the wrong place.
>
> One thing you will notice while checking: Figures 1 to 1.7 put the **caption above**
> the image, and Figures 3 to 10 put it **below**. Worth making consistent while you
> are in there — captions below the image is the usual convention and is what most of
> the document already does.

---

## Step 3 — Fix the backend (about 4 hours)

Branch: `chamodh/backend` (commit `a1e6e5e`).

### Read this first — what is wrong and why it matters

Right now the **web pages** are protected but the **data** is not.

`apps/web/proxy.ts` stops someone opening `/projects` in the browser without
signing in. That part is real and it works. But FastAPI, which is what actually
holds the data, asks for nothing at all. It listens on port 8000 and this works
today with no sign-in:

```bash
curl http://localhost:8000/api/projects        # returns data
```

So anyone who skips the browser and calls the API directly sees everything. That
breaks SEC-01 and SEC-03. It also puts the sign-in logic in Next.js, when we
decided (locked decision 5) that FastAPI is the one that handles it.

**Fixing it means moving sign-in from the frontend to the backend.** After this
step: the browser holds a cookie and nothing else; the backend holds the tokens;
and every API route refuses to answer unless that cookie is valid.

### What the backend actually is today

Be clear about this before you start, so nothing surprises you: **it is a
skeleton.** 57 functions across 25 files are `raise NotImplementedError`. Every
route handler, every service and every background task is an empty shell.

The parts that are real and working: the database models, the migration, the
scoring formula, the enums, the config loaders, the row-level-security helper,
the error classes and the logging setup.

**Step 3 does not fill in the empty shells.** It does five things:

1. makes everything import again,
2. makes the database models match what we decided,
3. writes sign-in for real,
4. locks every route behind that sign-in,
5. makes field names and error codes match `docs/api/openapi.yaml`.

The route handlers stay empty. That is fine and expected — an empty handler
behind a working lock still returns `401` to a stranger, which is exactly what
this step has to prove.

### Do the parts in this order

The order below is not the same as the order these problems were found in. It is
the order that works, because each part needs the one before it:

| | Part | Time | Needs |
|---|---|---|---|
| 3.1 | [Install the tools](#31--install-the-tools-10-min) | 10 min | — |
| 3.2 | [Put back four deleted files](#32--put-back-four-deleted-files-20-min) | 20 min | 3.1 |
| 3.3 | [Fix the database models](#33--fix-the-database-models-40-min) | 40 min | — |
| 3.4 | [Update the migration](#34--update-the-migration-10-min) | 10 min | 3.3 |
| 3.5 | [Write sign-in](#35--write-sign-in-60-min) | 60 min | 3.3, 3.4 |
| 3.6 | [Lock every route](#36--lock-every-route-25-min) | 25 min | 3.5 |
| 3.7 | [Field names and error codes](#37--field-names-and-error-codes-25-min) | 25 min | — |
| 3.8 | [Tidy up](#38--tidy-up-15-min) | 15 min | — |
| 3.9 | [Check your work](#39--check-your-work-10-min) | 10 min | all |
| 3.10 | [Set up Asgardeo and sign in for real](#310--set-up-asgardeo-and-sign-in-for-real-20-min) | 20 min | all |

**3.5 has to come after 3.3** because sign-in stores a row in a table that does
not exist yet. Doing it the other way round means writing the code twice.

**3.10 is last on purpose.** Everything from 3.1 to 3.9 is code you can write and
test on your own machine with no accounts, no passwords and no internet. 3.10 is
where you go to the Asgardeo website, create the application, and paste two
values into a file. Leaving it until the end means nothing is blocked waiting on
it.

---

### 3.1 — Install the tools (10 min)

There is no virtual environment on this branch, and the development tools are not
installed, so two of the checks in this step cannot run yet.

```bash
cd apps/api
python -m venv .venv
.venv/Scripts/activate          # Windows. On Mac/Linux: source .venv/bin/activate
pip install -e ".[dev]"
```

That last command installs the API and the test tools together. `-e` means
"editable" — Python reads your source files directly, so you never have to
reinstall after an edit.

Check it worked:

```bash
python -c "import codesage_api.main"    # prints nothing = good
pytest tests/unit -q                    # 25 passed, 2 xfailed
lint-imports                            # a report, not "command not found"
```

> **Note:** `2 xfailed` is not a failure. It means two tests are marked
> "expected to fail" because the scoring engine is still an empty shell. Leave
> them.

> **A correction to what I said earlier.** I said `apps/api` would not import at
> all. That was wrong — I checked, and `import codesage_api.main` works fine
> today. The broken imports in 3.2 are real, but they only affect the `detection`
> folder, which `main.py` never loads. So it is a problem for `lint-imports` and
> for future work, not a fire.

---

### 3.2 — Put back four deleted files (20 min)

The `extractors` folder was deleted, but three files still import from it. Those
three files cannot be loaded at all, and `lint-imports` fails because
`pyproject.toml` names `codesage_api.extractors` in one of its rules.

| This file | Wants this |
|---|---|
| `detection/risk/client.py` | `extractors.ck_metrics.FileMetrics` |
| `detection/risk/client.py` | `extractors.process_metrics.FileProcessMetrics` |
| `detection/rules/engine.py` | `extractors.ck_metrics.FileMetrics` |
| `detection/satd/client.py` | `extractors.comments.ExtractedComment` |

You do not need the real extraction code. It is not used until ML work starts.
You only need the three **shapes** — the small classes that say what a chunk of
data looks like. Create four files under
`src/codesage_api/extractors/`:

`__init__.py` — empty.

`ck_metrics.py`:

```python
"""What the CK tool tells us about one Java file.

CK is a Java program the worker runs as a separate process. This class is only
the shape of its output, so the rest of the code can be written and type-checked
before the tool is wired up.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class FileMetrics:
    path: str
    loc: int
    cyclomatic_complexity: float
    max_nesting_depth: int
    method_count: int
    longest_method_lines: int
```

`process_metrics.py`:

```python
"""What the commit history tells us about one file.

Read from the repository's git log, not from the code itself. Two files can look
identical and still differ here — one has been rewritten forty times this month
and the other has not been touched in two years.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class FileProcessMetrics:
    path: str
    commit_count: int
    distinct_authors: int
    lines_added: int
    lines_deleted: int
    days_since_last_change: int
```

`comments.py`:

```python
"""One comment pulled out of a source file.

`text` is what the classifier reads. `line` is what the finding points at, so a
user can click straight to it.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ExtractedComment:
    file_path: str
    line: int
    text: str
```

Now check:

```bash
python -c "import codesage_api.detection.rules.engine"    # prints nothing = good
lint-imports                                              # all contracts pass
```

> **About the other deleted folder.** `db/repositories/` was deleted too, but
> nothing imports it, so nothing is broken. Decide with Chamodh whether services
> will use the ORM directly or whether that folder comes back. Either is fine —
> but SAD §5.2 names the Repository pattern, so if it stays deleted, say so and
> update §5.2 to match.

---

### 3.3 — Fix the database models (40 min)

Six problems. Three of them contradict decisions we have already locked.

#### `db/enums.py`

| Change | To | Why |
|---|---|---|
| `AnalysisTriggerType` has `MANUAL`, `WEBHOOK`, `SCHEDULED` | leave only `MANUAL` | SAD §1.2 — there are no webhooks and no scheduled scans in v1.0 |
| `FileTreeNodeType.DIRECTORY = "directory"` | `FOLDER = "folder"` | the API contract and the frontend both say `folder` |

`Theme` already has `LIGHT`, `DARK` and `SYSTEM`, so nothing to do there. (It is
the class *diagram* in Step 2 that is missing `SYSTEM`, not the code.)

> **One place spells `directory` again, in SQL.** `db/models/source.py` has a
> check constraint written as a plain string, so renaming the enum does not
> reach it and the migration fails with a confusing error about
> `ck_file_tree_node_node_source_file`. Change `node_type = 'directory'` to
> `node_type = 'folder'` on the last line of that file.

#### `db/models/profile.py`

The two profile tables are supposed to hold the **same five weights**. Right now
they hold different sets, and both are wrong.

| Table | Change | To |
|---|---|---|
| `ScoringProfile` | `defect_weight` | delete it — there is no `defect` category |
| `ScoringProfile` | `document_weight` | rename to `documentation_weight` |
| `ScoringPreset` | `defect_weight` | delete it |
| `ScoringPreset` | (missing) | add `security_weight` |

After this, both tables carry exactly: `security_weight`, `code_design_weight`,
`requirement_weight`, `documentation_weight`, `test_weight`, `trust_slider`.
Five weights and one slider — six numbers.

> **Something to decide, not to code.** The `scoring_preset` table is never
> filled in. The three presets are read at runtime from
> `scoring/config/presets.yaml`, and the migration does not insert any rows into
> the table. So today there are two places a preset could live and only one of
> them is used. Pick one. Keeping the YAML file and deleting the table is the
> smaller change, and the YAML is already correct. Ask Chamodh before deleting.

#### `db/models/tenancy.py` — the user

Today a user is identified by their GitHub ID. That has to change, because
GitHub is no longer who tells us who someone is — Asgardeo is.

Asgardeo gives every user a **subject identifier**, usually just called `sub`. It
is a permanent, unique string. Use that as the identity.

```python
class User(UUIDPrimaryKey, Base):
    __tablename__ = "app_user"

    # Who this person is. Permanent and unique. Set once at first sign-in and
    # never changed — this is the only column anything is allowed to key on.
    asgardeo_sub: Mapped[str] = mapped_column(
        String(255), nullable=False, unique=True, index=True
    )

    # Everything below is for showing on screen. None of it is identity.
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    # "github", "google", "local" — which button they clicked inside Asgardeo.
    identity_provider: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Kept for display only. Now nullable, and no longer unique: someone who
    # signs in with Google has no GitHub account at all.
    github_user_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    github_username: Mapped[str | None] = mapped_column(String(255), nullable=True)

    theme_preference: Mapped[Theme] = mapped_column(
        Enum(Theme, name="theme", values_callable=enum_values),
        nullable=False,
        default=Theme.SYSTEM,
    )
    memberships: Mapped[list[Membership]] = relationship(
        back_populates="user", passive_deletes=True
    )
```

**Never identify a user by their email address.** A person can change their own
email. If email were the key, changing it would either lock them out of their own
workspace or hand them someone else's. `sub` cannot be changed by the user, which
is the whole reason it exists.

The four display columns are not decoration — `GET /api/auth/session` in the
contract has to return `email`, `name`, `avatar_url` and `identity_provider`, and
they have to come from somewhere.

#### `db/models/tenancy.py` — the session table

Add a table to hold signed-in sessions. Put it in the same file:

```python
class UserSession(UUIDPrimaryKey, Base):
    """One signed-in browser.

    The cookie we give the browser holds this row's id and nothing else — a
    random number that means nothing on its own. Everything that matters lives
    here, on the server. That is what makes signing out actually work: we delete
    this row, and the next request finds nothing and gets a 401.
    """

    __tablename__ = "session"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("app_user.id", ondelete="CASCADE"), index=True
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspace.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # Bumped on every request, so an active user is never signed out mid-work.
    last_used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
```

Two things worth knowing about that:

**Why the class is called `UserSession` and the table is called `session`.**
SQLAlchemy already has a class called `Session` — it is the database connection
object, imported all over this codebase. Two different things with the same name
in the same file is how people lose an afternoon. The table name stays `session`,
so the ER diagram in Step 2 stays correct.

**This table does not get a row-level-security policy — and that is deliberate.**
Every other table has one: "you can only see rows belonging to your workspace."
This table cannot have one, because it is the table that *tells us* which
workspace you are. If it filtered by workspace, we would have to already know
your workspace in order to look up the row that says what your workspace is.
Nobody could ever sign in.

That is safe, because the row is found by a random 128-bit id that nobody can
guess, and because the table holds no tenant data — only a pointer to a tenant.
Write that reason down as a comment in the file; a reviewer will ask.

> This corrects what I wrote earlier. I said "give it a policy like the others."
> That would have deadlocked sign-in.

Finally, add `UserSession` to the imports and to `__all__` in
`db/models/__init__.py`, next to `User` and `Workspace`.

---

### 3.4 — Update the migration (10 min)

You do **not** need to delete the migration and regenerate it.

Open `alembic/versions/20260812_0001_complete_erd.py` and look at how it works.
It does not list tables one by one. It loops over the models and creates whatever
it finds:

```python
for table in Base.metadata.sorted_tables:
    op.execute(CreateTable(table))
```

So the moment you changed the models in 3.3, this migration started creating the
new shape automatically. There is nothing to regenerate.

The only hand-edit needed is the tenant-isolation list near the top. `session`
must be listed so the migration knows to leave it alone — add a comment saying
why, since a reader will notice one table is missing from the list:

```python
# Every table below gets "you only see your own workspace's rows".
#
# `session` is deliberately NOT here. It is the table that tells us which
# workspace the caller belongs to, so it cannot be filtered by the workspace it
# has not told us yet. It holds no tenant data — only a pointer to a tenant —
# and its rows are found by an unguessable random id.
DIRECT_POLICIES = {
    "workspace": "id = app_current_workspace_id()",
    ...
```

Then check it runs. This needs Docker:

```bash
docker compose -f ../../infra/docker-compose.yml up -d postgres
alembic upgrade head
```

If it fails, read the error before changing anything — it is almost always a
column name you renamed in one file and not the other.

> **Why not `alembic revision --autogenerate`, which is what I said before.**
> Three reasons. Autogenerate works by comparing your models against a live
> database, so you would need one already migrated to the old shape. It would
> throw away the seed data at the bottom of the file — the five categories, the
> three marker patterns, the four rules. And it would throw away the
> `app_current_workspace_id()` function that every security policy depends on.
> The file you have is hand-written and better than what autogenerate produces.
> Keep it.

---

### 3.5 — Write sign-in (60 min)

This is the real work of Step 3. Take the frontend out first, then build the
backend side.

#### First, remove Asgardeo from the frontend

| File | Do this |
|---|---|
| `apps/web/proxy.ts` | delete the file |
| `apps/web/src/app/layout.tsx` | remove `<AsgardeoProvider>` and its import; keep `<MswProvider>` |
| `apps/web/src/app/(auth)/login/page.tsx` | replace `<SignInButton>` with a plain link: `<a href={\`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/auth/login\`}>Sign in</a>` |
| `apps/web/src/components/layout/app-rail.tsx` | replace `<SignOutButton>` with a button that calls `fetch(\`${API}/api/auth/logout\`, { method: 'POST', credentials: 'include' })` and then sends the user to `/login` |
| `apps/web/package.json` | remove `@asgardeo/nextjs`, then run `pnpm install` |

**Sign-in must be a plain link, never a `fetch`.** The browser has to physically
leave your site and go to Asgardeo. A `fetch` stays on the page, so it cannot
work. This is also the one endpoint the mock backend cannot fake, which is worth
remembering in Phase 10.6.

#### How the sign-in flow works

Read this once before writing the code. There are five moves:

1. The user clicks **Sign in**. The browser goes to your backend at
   `/api/auth/login`.
2. Your backend makes up two random strings, remembers them, and sends the
   browser on to Asgardeo.
3. The user signs in at Asgardeo (with GitHub, or whatever else you enable
   there). Asgardeo sends the browser back to `/api/auth/callback` with a
   short code in the URL.
4. **Your backend**, not the browser, calls Asgardeo directly and trades that
   code for the user's details. The browser never sees a token.
5. Your backend saves a session row, puts its id in a cookie, and sends the
   browser to the projects page.

The two random strings in move 2 are worth understanding, because they are the
security of this whole flow:

- **`state`** — a random value we send to Asgardeo and check when it comes back.
  Without it, our callback would accept a code from anyone who could get a user
  to click a link. It proves the trip that finished is the trip we started.
- **`code_verifier`** — a random secret we keep, and send a *hash* of to
  Asgardeo. In move 4 we send the original. Only someone who started the sign-in
  has it, so a stolen code is useless on its own. (This is called PKCE if you
  look it up.)

We keep both in a short-lived signed cookie that lasts ten minutes and is
readable only by this one path. No extra table needed.

#### `config.py`

Delete the three `github_*` settings. Keep `secret_key` — it is what signs the
ten-minute cookie above. Add:

```python
    # ── Sign-in ──────────────────────────────────────────────────────────────
    # Asgardeo is the only place this service asks "who is this?". GitHub is set
    # up *inside* Asgardeo, so this code never talks to GitHub about identity.
    # Adding Google or a password login later is a change on their website, not
    # a change here (SRS FR-1, SEC-17).
    asgardeo_base_url: str = ""          # https://api.asgardeo.io/t/<your-org>
    asgardeo_client_id: str = ""
    asgardeo_client_secret: str = ""
    asgardeo_redirect_uri: str = "http://localhost:8000/api/auth/callback"
    frontend_base_url: str = "http://localhost:3000"

    # ── The session cookie ───────────────────────────────────────────────────
    session_cookie_name: str = "codesage_session"
    # Signed out after an hour of doing nothing...
    session_idle_minutes: int = 60
    # ...and after twelve hours no matter how busy you have been.
    session_absolute_hours: int = 12
    # Cookie is sent over HTTPS only. Set to false for plain http on localhost.
    cookie_secure: bool = True
```

Update `.env.example` to match — delete the GitHub block, add the same names with
a `CODESAGE_` prefix, and leave the two secret values blank for 3.10 to fill in.

#### `services/auth.py`

Replace the whole file. The docstring currently says the session is "stateless"
and lives in a signed cookie — that is the design we rejected, because a
self-contained cookie stays valid until it expires and signing out cannot take it
back.

```python
"""Sign-in, sessions and sign-out (FR-1, SEC-01, SEC-10, SEC-17).

The session lives in the database. The browser gets a cookie holding nothing but
a random id. Two things follow from that, and both are the point:

  * a script that steals the cookie has stolen a number, not a credential — it
    cannot be replayed against Asgardeo or GitHub;
  * signing out works immediately, because we delete the row.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from codesage_api.config import get_settings
from codesage_api.db.enums import MembershipStatus
from codesage_api.db.models import (
    Membership,
    ScoringProfile,
    User,
    UserSession,
    Workspace,
)
from codesage_api.db.rls import set_workspace_context
from codesage_api.errors import NotAuthenticated, UpstreamUnavailable
from codesage_api.scoring.config_loader import get_presets


@dataclass(frozen=True, slots=True)
class IdentityClaims:
    """What Asgardeo tells us about the person who just signed in."""

    sub: str
    email: str | None
    name: str | None
    picture: str | None
    identity_provider: str | None


def exchange_code_for_identity(code: str, code_verifier: str) -> IdentityClaims:
    """Trade the code for the user's details. Backend to Asgardeo, directly.

    Two calls: one to swap the code for an access token, one to ask who that
    token belongs to. The token stays inside this function and is thrown away
    when it returns. Nothing about it ever reaches the browser (SEC-09).
    """
    settings = get_settings()
    try:
        with httpx.Client(timeout=15.0) as client:
            token_response = client.post(
                f"{settings.asgardeo_base_url}/oauth2/token",
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": settings.asgardeo_redirect_uri,
                    "code_verifier": code_verifier,
                },
                auth=(settings.asgardeo_client_id, settings.asgardeo_client_secret),
            )
            token_response.raise_for_status()
            access_token = token_response.json()["access_token"]

            user_response = client.get(
                f"{settings.asgardeo_base_url}/oauth2/userinfo",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            user_response.raise_for_status()
            claims = user_response.json()
    except httpx.HTTPError as exc:
        raise UpstreamUnavailable from exc

    return IdentityClaims(
        sub=claims["sub"],
        email=claims.get("email"),
        name=claims.get("name") or claims.get("username"),
        picture=claims.get("picture"),
        identity_provider=claims.get("idp"),
    )


def establish_session(db: DbSession, claims: IdentityClaims) -> UserSession:
    """Find or create the user, then start a session for them."""
    user = db.scalar(select(User).where(User.asgardeo_sub == claims.sub))
    if user is None:
        user = _provision_new_user(db, claims)
    else:
        # Their name or picture may have changed since last time.
        user.email = claims.email or user.email
        user.display_name = claims.name or user.display_name
        user.avatar_url = claims.picture or user.avatar_url

    workspace_id = resolve_workspace(db, user.id)

    now = datetime.now(timezone.utc)
    settings = get_settings()
    session = UserSession(
        user_id=user.id,
        workspace_id=workspace_id,
        created_at=now,
        last_used_at=now,
        expires_at=now + timedelta(minutes=settings.session_idle_minutes),
    )
    db.add(session)
    db.flush()
    return session


def _provision_new_user(db: DbSession, claims: IdentityClaims) -> User:
    """First sign-in: create the user, their workspace, and a starting profile.

    Doing it here, once, means every later read can assume a workspace and an
    active profile exist. Nothing downstream needs a "what if there is none yet"
    branch.

    Note the order. WORKSPACE, MEMBERSHIP and SCORING_PROFILE all carry a policy
    saying "this row must belong to the current workspace", and PostgreSQL checks
    that on INSERT as well as on SELECT. So the workspace id is generated here,
    bound as the current workspace, and only then written — otherwise the very
    first INSERT is refused by the policy that is meant to protect it.
    """
    user = User(
        asgardeo_sub=claims.sub,
        email=claims.email,
        display_name=claims.name,
        avatar_url=claims.picture,
        identity_provider=claims.identity_provider,
    )
    db.add(user)
    db.flush()

    workspace_id = uuid.uuid4()
    set_workspace_context(db, workspace_id)

    db.add(Workspace(id=workspace_id))
    db.flush()

    db.add(
        Membership(
            user_id=user.id,
            workspace_id=workspace_id,
            status=MembershipStatus.ACTIVE,
        )
    )

    balanced = get_presets()["balanced"]
    db.add(
        ScoringProfile(
            workspace_id=workspace_id,
            name=balanced.name,
            security_weight=balanced.weights["security"],
            code_design_weight=balanced.weights["code-design"],
            requirement_weight=balanced.weights["requirement"],
            documentation_weight=balanced.weights["documentation"],
            test_weight=balanced.weights["test"],
            trust_slider=balanced.s,
            is_active=True,
        )
    )
    db.flush()
    return user


def resolve_workspace(db: DbSession, user_id: uuid.UUID) -> uuid.UUID:
    """Which workspace this user belongs to. v1.0: exactly one (DBR-4).

    Goes through MEMBERSHIP rather than a column on USER, so that v2's "one
    person, several workspaces" is a different query and not a migration.

    Calls a database function rather than querying the table directly, because
    at sign-in there is no workspace bound yet and MEMBERSHIP is filtered by the
    workspace — the answer would be hidden behind the question. The function is
    allowed to see past that filter, and it is the only thing in the system that
    is. See the comment on `app_workspace_for_user` in the migration.
    """
    workspace_id = db.scalar(
        select(func.app_workspace_for_user(user_id)),
    )
    if workspace_id is None:
        raise NotAuthenticated
    return workspace_id


def load_valid_session(db: DbSession, raw_cookie: str | None) -> UserSession | None:
    """Turn a cookie into a session, or return None.

    Also slides the expiry forward, so someone who is actively working is not
    signed out at the hour mark — but never past the twelve-hour ceiling, which
    is what stops a session living forever just because a tab is open.
    """
    if not raw_cookie:
        return None
    try:
        session_id = uuid.UUID(raw_cookie)
    except ValueError:
        return None

    session = db.get(UserSession, session_id)
    now = datetime.now(timezone.utc)
    if session is None or session.expires_at <= now:
        return None

    settings = get_settings()
    session.last_used_at = now
    session.expires_at = min(
        now + timedelta(minutes=settings.session_idle_minutes),
        session.created_at + timedelta(hours=settings.session_absolute_hours),
    )
    return session


def end_session(db: DbSession, raw_cookie: str | None) -> None:
    """Delete the row. After this the cookie is a meaningless number (SEC-10)."""
    if not raw_cookie:
        return
    try:
        session_id = uuid.UUID(raw_cookie)
    except ValueError:
        return
    session = db.get(UserSession, session_id)
    if session is not None:
        db.delete(session)
```

#### The one genuinely hard part — signing in before you have a tenant

Every table holding a workspace's data carries a rule: *"you may only touch rows
belonging to your current workspace."* PostgreSQL enforces it on reads **and on
writes**.

Sign-in is the one moment when there is no current workspace — that is the whole
point of signing in. So the obvious version of this code fails twice:

| Who is signing in | What breaks | Why |
|---|---|---|
| A brand-new user | `INSERT` into `workspace` is refused | The rule asks "does this row belong to your workspace?" and there is no answer yet |
| A returning user | Reading `membership` finds nothing | It is filtered by the workspace we are trying to look up. The answer is hidden behind the question |

One fix each:

**New user** — decide the workspace's id in Python first, announce it, *then*
write. `set_workspace_context(db, workspace_id)` before the first `INSERT`, and
every row after it satisfies the rule. That is the `_provision_new_user` above.

**Returning user** — add one small function to the migration, straight after
`app_current_workspace_id()`:

```python
    # Sign-in has a chicken-and-egg problem: to bind a workspace we must first
    # look one up, but the MEMBERSHIP table that holds the answer is itself
    # filtered by the workspace we do not have yet.
    #
    # SECURITY DEFINER runs this function as its owner instead of as the caller,
    # so it sees past the policy. It is the ONLY thing in the system that does,
    # and it is deliberately narrow: one argument, one answer, no table exposed.
    # EXECUTE is revoked from everyone and granted only to the application role.
    op.execute(
        "CREATE FUNCTION app_workspace_for_user(p_user_id uuid) RETURNS uuid "
        "LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp "
        "AS $$ SELECT workspace_id FROM membership "
        "WHERE user_id = p_user_id AND status = 'active' LIMIT 1 $$"
    )
    op.execute("REVOKE EXECUTE ON FUNCTION app_workspace_for_user(uuid) FROM PUBLIC")
    op.execute("GRANT EXECUTE ON FUNCTION app_workspace_for_user(uuid) TO codesage_app")
```

and the matching line in `downgrade()`:

```python
    op.execute("DROP FUNCTION IF EXISTS app_workspace_for_user(uuid)")
```

**What `SECURITY DEFINER` means, in one sentence:** normally a database function
runs with *your* permissions; a `SECURITY DEFINER` function runs with the
permissions of whoever created it, so it can see things you cannot.

That would be a back door if it took a query. It takes one user id and returns
one workspace id. It cannot be asked anything else, it cannot list other people's
memberships, and only the application role may call it at all. Being able to
point at one function and say *"that is the only bypass in the system, and this
is exactly what it does"* is a much better position than having no bypass but a
policy quietly loosened everywhere.

Because the migration changed, rebuild the database before testing:

```bash
docker compose -f ../../infra/docker-compose.yml down -v
docker compose -f ../../infra/docker-compose.yml up -d postgres
alembic upgrade head
```

`down -v` deletes the data volume as well. That is what you want: the old
database already has the old set of functions, and `alembic upgrade head` will
not re-run a migration it has recorded as done.

> Note the `weights` lookups use plain strings like `"code-design"`. `get_presets()`
> returns them keyed by the `Category` enum, and `Category` is a `StrEnum`, so a
> string key works. If your editor complains, use `Category.CODE_DESIGN` instead
> and import it from `codesage_api.scoring.enums`.

#### `routers/auth.py`

There is a real bug in this file. The four route decorators are one position out
of step with the functions beneath them: the decorator saying `/github/login`
sits on top of the callback handler, the one saying `/github/callback` sits on
top of the "who am I" handler, and so on.

Chamodh did not invent this. **The old SRS endpoint table had exactly the same
off-by-one**, and he implemented it faithfully. The v1.1 SRS fixes the table.

Replace the file:

```python
"""Sign-in, session and sign-out (SRS FR-1, SEC-01, SEC-10, SEC-17).

Two routers, and the split is the security boundary. `public_router` is mounted
without the sign-in check, because you obviously cannot require a session on the
two endpoints whose job is to create one. Everything else goes on `router`.
"""

from __future__ import annotations

import base64
import hashlib
import secrets
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.responses import RedirectResponse
from itsdangerous import BadSignature, URLSafeTimedSerializer
from sqlalchemy.orm import Session as DbSession

from codesage_api.config import get_settings
from codesage_api.db.session import SessionLocal
from codesage_api.deps import get_current_user_id, get_db
from codesage_api.schemas.auth import SessionOut
from codesage_api.services import auth as auth_service

public_router = APIRouter(prefix="/auth", tags=["auth"])
router = APIRouter(prefix="/auth", tags=["auth"])

# Holds `state` and `code_verifier` between the redirect out and the redirect
# back. Ten minutes, and only this one path can read it.
HANDSHAKE_COOKIE = "codesage_signin"
HANDSHAKE_SECONDS = 600


def _signer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(get_settings().secret_key, salt="codesage-signin")


@public_router.get("/login")
def begin_sign_in() -> RedirectResponse:
    """Send the browser to Asgardeo to sign in.

    This is a navigation, not a fetch — the browser has to leave the page.
    """
    settings = get_settings()
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .decode()
        .rstrip("=")
    )

    query = urlencode(
        {
            "response_type": "code",
            "client_id": settings.asgardeo_client_id,
            "redirect_uri": settings.asgardeo_redirect_uri,
            "scope": "openid profile email",
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
    )
    response = RedirectResponse(
        f"{settings.asgardeo_base_url}/oauth2/authorize?{query}",
        status_code=status.HTTP_302_FOUND,
    )
    response.set_cookie(
        key=HANDSHAKE_COOKIE,
        value=_signer().dumps({"state": state, "verifier": verifier}),
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=HANDSHAKE_SECONDS,
        path="/api/auth",
    )
    return response


@public_router.get("/callback")
def complete_sign_in(code: str, state: str, request: Request) -> RedirectResponse:
    """Where Asgardeo sends the browser back to.

    Checks the trip is the one we started, swaps the code for the user's details
    from this server, saves a session, and hands the browser a cookie.

    Failures here go back to the login page with a message rather than showing
    JSON — whoever is reading this is a person mid-navigation, not a script.
    """
    settings = get_settings()

    handshake = request.cookies.get(HANDSHAKE_COOKIE)
    if not handshake:
        return _back_to_login("expired")
    try:
        issued = _signer().loads(handshake, max_age=HANDSHAKE_SECONDS)
    except BadSignature:
        return _back_to_login("invalid")
    if not secrets.compare_digest(issued["state"], state):
        return _back_to_login("invalid")

    claims = auth_service.exchange_code_for_identity(code, issued["verifier"])

    db = SessionLocal()
    try:
        session = auth_service.establish_session(db, claims)
        session_id = str(session.id)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    response = RedirectResponse(
        f"{settings.frontend_base_url}/projects", status_code=status.HTTP_302_FOUND
    )
    response.set_cookie(
        key=settings.session_cookie_name,
        value=session_id,            # a random id, never a token
        httponly=True,               # JavaScript cannot read it, so XSS cannot steal it
        secure=settings.cookie_secure,
        samesite="lax",              # another website cannot make the browser send it
        max_age=settings.session_idle_minutes * 60,
        path="/",
    )
    response.delete_cookie(HANDSHAKE_COOKIE, path="/api/auth")
    return response


def _back_to_login(reason: str) -> RedirectResponse:
    settings = get_settings()
    return RedirectResponse(
        f"{settings.frontend_base_url}/login?error={reason}",
        status_code=status.HTTP_302_FOUND,
    )


@router.get("/session", response_model=SessionOut)
def current_user(
    user_id=Depends(get_current_user_id),
    db: DbSession = Depends(get_db),
) -> SessionOut:
    """Who is signed in. The only auth endpoint the frontend calls with fetch."""
    raise NotImplementedError


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def sign_out(request: Request) -> Response:
    """End the session and clear the cookie (SEC-10)."""
    settings = get_settings()
    db = SessionLocal()
    try:
        auth_service.end_session(db, request.cookies.get(settings.session_cookie_name))
        db.commit()
    finally:
        db.close()

    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(settings.session_cookie_name, path="/")
    return response
```

`/session` is left as `NotImplementedError` on purpose — it is a route handler
like all the others, and filling those in is not this step's job. The lock around
it is what matters, and that is real.

Add the response shape it names, in a new file
`src/codesage_api/schemas/auth.py`, matching the `Session` schema in the
contract exactly:

```python
"""What `GET /api/auth/session` returns.

Carries no token and no password. Those never leave this server (SEC-09).
"""

from __future__ import annotations

from codesage_api.schemas.base import ApiModel


class SessionOut(ApiModel):
    user_id: str
    email: str
    name: str
    avatar_url: str | None = None
    workspace_id: str
    identity_provider: str | None = None
```

(`ApiModel` is what `CamelModel` becomes in 3.7. If you are doing 3.5 first, write
`CamelModel` here and rename it along with the rest.)

Export `SessionOut` from `schemas/__init__.py` next to the others.

#### `deps.py`

`get_current_user_id` currently says the session is "stateless: the cookie is
signed and self-contained". Replace all three functions:

```python
def get_current_user_id(request: Request) -> uuid.UUID:
    """Who is calling? Read the cookie, look up the row, or refuse.

    Opens its own short database connection rather than using `get_db`, because
    `get_db` needs to know the workspace and the workspace is exactly what this
    function is here to find out. The `session` table is the one table with no
    workspace filter on it, for that reason.
    """
    session = SessionLocal()
    try:
        record = auth_service.load_valid_session(
            session, request.cookies.get(get_settings().session_cookie_name)
        )
        if record is None:
            raise NotAuthenticated
        user_id = record.user_id
        # Stashed so get_workspace_id does not have to ask the database again.
        request.state.workspace_id = record.workspace_id
        session.commit()          # saves the slid expiry from load_valid_session
        return user_id
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_workspace_id(
    request: Request, user_id: uuid.UUID = Depends(get_current_user_id)
) -> uuid.UUID:
    """The workspace every query in this request is limited to.

    Already known — the session row named it. Kept as its own dependency because
    `get_db` depends on it, and that dependency is what makes it impossible to
    write a handler that runs with no tenant attached.
    """
    return request.state.workspace_id
```

Leave `get_db` exactly as it is. It is already correct, and the fact that it
depends on `get_workspace_id` is the thing that stops anyone accidentally writing
a handler that can see every tenant's data.

> This corrects something else I said. I claimed `get_workspace_id` was "already
> right, leave it alone". It was a `raise NotImplementedError` stub, like
> everything else. It has to be written or `/api/auth/session` can never work.

#### Expect one red test until 3.7

When you finish 3.5, `pytest tests/unit` shows **1 failed**:

```
FAILED tests/unit/schemas/test_contract.py::test_openapi_contains_every_srs_endpoint
```

That is correct and temporary. The test asserts the old rotated paths
(`/api/auth/github`), which no longer exist — it is the test that was locking in
the bug. It cannot go green until **3.6** mounts the public router and **3.7**
updates the expected paths. Everything else stays green throughout.

---

### 3.6 — Lock every route (25 min)

#### Locked unless opened, not open unless locked

Do not put the sign-in check on each route one at a time. Someone will add a
route next month and forget. Put it on the whole group at once, so a new route is
protected by default and letting one through is a visible, deliberate act.

In `routers/__init__.py`, build two groups:

```python
from fastapi import APIRouter

from codesage_api.routers import auth, branches, health, profiles, projects, scans, system

# No sign-in required. Only the two endpoints whose job is to create a session,
# plus the liveness probe. These three, and nothing else, are marked public in
# docs/api/openapi.yaml — so the contract and the code agree.
public_router = APIRouter(prefix="/api")
public_router.include_router(auth.public_router)
public_router.include_router(system.public_router)

# Everything else. A route added to any of these is protected automatically.
api_router = APIRouter(prefix="/api")
api_router.include_router(auth.router)
api_router.include_router(projects.router)
api_router.include_router(branches.router)
api_router.include_router(scans.router)
api_router.include_router(health.router)
api_router.include_router(profiles.router)

__all__ = ["api_router", "public_router", "system"]
```

In `main.py`:

```python
    app.include_router(public_router)
    app.include_router(api_router, dependencies=[Depends(get_current_user_id)])
    app.include_router(system.ops_router)   # /readyz and /version, outside /api
```

> **This corrects the version I gave you before.** I wrote
> `app.include_router(api_router, dependencies=[...])` and then said "let exactly
> three through". You cannot do that — a dependency on a router applies to every
> route inside it, and FastAPI gives no way for a single route to opt out. Two
> routers is the way, and it reads better anyway: which endpoints are public is
> visible in one place instead of scattered across decorators.

#### Move the liveness probe to match the contract

The contract says the liveness probe is at `/api/healthz`. The code puts it at
`/healthz`. Change the code — the contract is finished and the frontend generates
its types from it.

In `routers/system.py`, split the router in two:

```python
# In the contract, and therefore under /api. Public: an orchestrator checking
# whether the container is alive cannot be asked to sign in first.
public_router = APIRouter(tags=["system"])


@public_router.get("/healthz")
def liveness() -> dict[str, str]:
    ...


# Not in the contract. Mounted outside /api so they are never mistaken for
# product endpoints, and so the lock on /api does not apply to them — these are
# how Docker decides whether the container is working.
ops_router = APIRouter(tags=["system"])


@ops_router.get("/readyz")
def readiness() -> dict[str, str]: ...


@ops_router.get("/version")
def version() -> dict[str, str]: ...
```

#### Add security headers

One block in `main.py`, after the CORS middleware. Each line turns off one way a
browser can be tricked:

```python
    @app.middleware("http")
    async def security_headers(request, call_next):
        response = await call_next(request)
        # Always use HTTPS with this host, even if a link says http.
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        # Treat files as the type we say they are — do not guess and run them.
        response.headers["X-Content-Type-Options"] = "nosniff"
        # This is a JSON API. It loads nothing, and nobody may frame it.
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        # Do not tell other sites which of our pages the user came from.
        response.headers["Referrer-Policy"] = "no-referrer"
        return response
```

#### CORS is already right — leave it

`main.py` already lists the allowed origin explicitly and sets
`allow_credentials=True`. That is correct.

**Never change `allow_origins` to `["*"]`.** With credentials allowed, a wildcard
would let any website on the internet call this API using the signed-in user's
own cookie and read the answer.

#### Take the database off your laptop's network

In `infra/docker-compose.yml`:

- delete the whole `pgadmin` service — that would be a seventh container, and we
  agreed on six (locked decision 3);
- delete `ports: ["127.0.0.1:55432:5432"]` from `postgres`.

When you need to run SQL:

```bash
docker compose exec postgres psql -U codesage_owner codesage
```

An open database port is the easiest thing in the world to forget about before a
demo.

**But you still need a port sometimes** — `alembic upgrade head` runs on your
machine, not inside a container, and it has to reach the database somehow. So
rather than putting the port back, add a second file, `infra/docker-compose.dev.yml`:

```yaml
# Local development override — OPT-IN, never used by default.
services:
  postgres:
    ports:
      - "127.0.0.1:5433:5432"
```

and ask for it by name when you want it:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
```

Typing that second `-f` is the whole point. The default stays shut, and opening
it is something you did deliberately and can see in your shell history — not
something that was quietly left on for three weeks.

Check it worked. From the host, with the plain file, the port should refuse:

```bash
docker compose up -d --force-recreate postgres
docker compose exec postgres psql -U codesage_owner codesage -c "\dt"   # works
```

> **Why 5433 and not 5432 or 55432.** 5432 collides with a PostgreSQL already
> installed on the machine. 55432 lands inside a block of ports Windows reserves
> for itself on boot, and Docker cannot bind it — the error is
> *"an attempt was made to access a socket in a way forbidden by its access
> permissions"*, and the reserved block moves every time you reboot.

While you are in that file, add the new settings to the `api` service:

```yaml
      CODESAGE_ASGARDEO_BASE_URL: ${CODESAGE_ASGARDEO_BASE_URL}
      CODESAGE_ASGARDEO_CLIENT_ID: ${CODESAGE_ASGARDEO_CLIENT_ID}
      CODESAGE_ASGARDEO_CLIENT_SECRET: ${CODESAGE_ASGARDEO_CLIENT_SECRET}
      CODESAGE_ASGARDEO_REDIRECT_URI: http://localhost:8000/api/auth/callback
      CODESAGE_FRONTEND_BASE_URL: http://localhost:3000
      # Local development is plain http, so a Secure-only cookie would never be
      # sent. This MUST be true anywhere real.
      CODESAGE_COOKIE_SECURE: "false"
```

The two `${...}` values come from a `.env` file next to the compose file, which
you create in 3.10 and never commit. Write them as `${NAME:-}` — with the `:-`
— so the stack still starts before that file exists, instead of Compose stopping
with a warning about an unset variable.

That covers SEC-17, SEC-18, SEC-19 and SEC-20 in the v1.1 SRS.

#### Check it before moving on

The important thing is not that one endpoint returns 401 — it is that *every*
endpoint does except the ones you chose. Probe the whole surface at once:

```bash
python - <<'EOF'
from fastapi.testclient import TestClient
from codesage_api.main import create_app
app = create_app()
c = TestClient(app, follow_redirects=False, raise_server_exceptions=False)
for path, ops in sorted(app.openapi()["paths"].items()):
    for method in ops:
        url = path.replace("{repo_id}", "x").replace("{scan_id}", "y")
        print(f"{c.request(method.upper(), url).status_code}  {method.upper():5} {path}")
EOF
```

You should see `401` on all thirteen product endpoints, and only these five
without it:

| | |
|---|---|
| `GET /api/auth/login` | 302 — sends you to Asgardeo |
| `GET /api/auth/callback` | 422 with no query string, which is fine: it means the route was reached |
| `GET /api/healthz` | 200 |
| `GET /readyz`, `GET /version` | 500 — still empty handlers, but deliberately outside the lock |

Then confirm the lock is really on the router and not on the endpoints — add a
throwaway route to `api_router` and check it comes back 401 without you doing
anything to it. If it does, the "deny by default" claim is true rather than
hopeful.

---

### 3.7 — Field names and error codes (25 min)

Two small jobs that both end in the same test file, so do them together.

#### snake_case on the wire

`schemas/base.py` currently rewrites every field name into camelCase on its way
out — `last_commit_sha` becomes `lastCommitSha`. We settled on **snake_case**
(locked decision 1), and the contract, the SRS and the database all use it.

```python
"""Shared base for every request and response shape.

Field names go out exactly as they are written here — snake_case, matching
docs/api/openapi.yaml, the SRS and the database columns. One spelling everywhere
means nobody has to remember which side of the wire they are on.

`extra="forbid"` makes an unexpected field an error rather than something quietly
ignored, so a client sending `trust_slider` when the field is `trust_s` finds out
immediately instead of wondering why the value never changes.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class ApiModel(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        extra="forbid",
    )
```

Then rename `CamelModel` to `ApiModel` everywhere. It is used in eight files:
`base.py`, `branch.py`, `finding.py`, `health.py`, `profile.py`, `repo.py`,
`scan.py`, `__init__.py`, plus the new `auth.py` from 3.5. Delete the
`to_camel` import. Also fix the docstring at the top of `schemas/__init__.py`,
which currently states the opposite ("Field names are camelCase on the wire").

While you are in there, two shapes disagree with the contract on more than
capitalisation:

| File | Now | Contract says |
|---|---|---|
| `schemas/profile.py` | `ScoreProfileIn.s` | `trust_s`, plus an optional `name` |
| `schemas/profile.py` | `ScoreProfileOut.s` | `trust_s`, plus `is_active: bool` |

Rename and add those. They are two-line changes now and a frustrating afternoon
in Phase 10.6 if left.

**And four more, found by actually comparing the two documents** rather than
reading them. Each of these would have surfaced in Phase 10.6 as a field that is
simply `undefined` in the browser, which is a miserable thing to debug:

| Shape | Code had | Contract says | Why the contract is right |
|---|---|---|---|
| `BranchOut` | `last_commit_sha`, `last_commit_at` | `head_commit_sha`, `head_commit_at` | "Head" is where the branch is *now* — what the client compares the shown snapshot against. "Last" reads as "last scanned", a different commit |
| `RepoOut` | extra `source` field | no such field | v1.0 has exactly one way to connect a repo, so a field recording which of one way it was says nothing |
| `ScanSummaryOut` | `scan_id` only | `snapshot_id` **and** `scan_id` | Locked decision 9. The attempt and the result are two things; a history row links them |
| `HealthReportOut` | `scan_id` | `snapshot_id`, plus `model_version` | A cancelled attempt has a scan id and no snapshot. The dashboard must be keyed on the thing that exists |

That last row is worth pausing on, because the old test asserted the opposite
(`scanId` present, `snapshotId` absent) and so did an earlier draft of this
step. Both were wrong. The rule is:

- **`scan_id`** — the attempt. Something that *ran*. Every attempt has one.
- **`snapshot_id`** — the result. Only attempts that finished have one.

`ScanStatusOut` carries `scan_id` (you are polling a run). `HealthReportOut`
carries `snapshot_id` (you are reading a result). `ScanSummaryOut` carries both.

**Check this rather than trusting it.** Load `docs/api/openapi.yaml`, generate
the app's own document with `create_app().openapi()`, and compare the property
names of every schema. It takes twenty lines and it found all four of these in
one run.

#### Error codes

`errors.py` returns only `{"detail": "..."}`. The contract says every error also
carries a `code` — a short constant the frontend can branch on, instead of
matching against an English sentence that someone might reword.

```python
class CodeSageError(Exception):
    status_code: int = 500
    code: str = "INTERNAL_ERROR"
    message: str = "Something went wrong."

# and in the handler:
content={"detail": exc.message, "code": exc.code}
```

Give each class its code. These are copied from the `ErrorCode` list in
`docs/api/openapi.yaml`, so they match exactly:

| Class | `code` |
|---|---|
| `CodeSageError` | `INTERNAL_ERROR` |
| `NotFound` | `NOT_FOUND` |
| `NotAuthenticated` | `NOT_AUTHENTICATED` |
| `RepositoryNotPublic` | `REPOSITORY_NOT_PUBLIC` |
| `RepositoryUnreachable` | `REPOSITORY_UNREACHABLE` |
| `ScanAlreadyRunning` | `SCAN_ALREADY_RUNNING` |
| `MLServiceUnavailable` | `UPSTREAM_UNAVAILABLE` |

3.5 also uses a class called `UpstreamUnavailable` for when Asgardeo cannot be
reached. Either add it as a new class with code `UPSTREAM_UNAVAILABLE`, or import
`MLServiceUnavailable` under that name. A separate class reads better, since
Asgardeo being down has nothing to do with the ML service.

> **Ignore the code names I gave you last time.** I said to use `REPO_NOT_PUBLIC`,
> `REPO_UNREACHABLE` and `ML_UNAVAILABLE`, and said they were already in the
> contract. They are not — I checked the file. The table above is what
> `openapi.yaml` actually contains. The contract wins.

#### Fix the test that locks in the bug

`tests/unit/schemas/test_contract.py` passes today. That is the problem: it
asserts the rotated auth paths and the camelCase names, so it would pass against
the broken code and **fail against the correct code**.

All four tests in the file need updating, not just the paths:

```python
EXPECTED_PRODUCT_PATHS = {
    "/api/auth/login": {"get"},
    "/api/auth/callback": {"get"},
    "/api/auth/session": {"get"},
    "/api/auth/logout": {"post"},
    "/api/healthz": {"get"},
    "/api/projects": {"get", "post"},
    ...unchanged...
}
```

- `test_profile_request_is_complete_five_weight_shape` — `codeDesign` becomes
  `code_design`, and the required set becomes `{"weights", "trust_s"}`.
- `test_secondary_web_names_are_used_on_the_wire` — rename it to
  `test_wire_names_are_snake_case` and flip the expected keys to `is_default`,
  `last_commit_sha`, `last_commit_at`, `default_branch`, `connected_at`.
- `test_dashboard_identifier_uses_established_scan_id_name` — `scanId` becomes
  `scan_id`, and `snapshotId` becomes `snapshot_id`.

> I only mentioned the auth paths last time. Changing the names in 3.7 breaks
> three more assertions in this same file, so do the whole file in one pass.

---

### 3.8 — Tidy up (15 min)

| Problem | Fix |
|---|---|
| `.pnpm-store/` and `.tmp/` are committed (4 files) | `git rm -r --cached .pnpm-store .tmp`, then add both to `.gitignore` |
| The root `.gitignore` is two lines long | It does not ignore `node_modules/`, `.next/`, `__pycache__/`, `.venv/`, `*.env` or `.env`. Add them — `.env` especially, before 3.10 puts a real secret in one |
| `apps/web/src/app/layout.tsx` says *"Create Next App"* | Change the title to `Code Sage AI` and write a real description |
| `authlib` is in `pyproject.toml` | Nothing imports it — 3.5 uses `httpx` directly. Remove it from **both** `pyproject.toml` and `requirements.txt`; the second is a hand-kept mirror of the first, so it does not follow on its own |
| `lint-imports` reports **workers never score BROKEN** | Pre-existing, and only visible now that the tool runs. Four files in `detection/` import `scoring.enums` — but `enums.py` is the shared *vocabulary*, not the scoring maths, and its own docstring says it is meant to be imported downward. The rule is too broad. Narrow it to the modules that actually compute: replace `forbidden_modules = ["codesage_api.scoring"]` with `["codesage_api.scoring.engine", "codesage_api.scoring.formula", "codesage_api.scoring.floor", "codesage_api.scoring.models", "codesage_api.scoring.config_loader"]`. A worker touching the maths still fails the build, which is the rule that matters |

> **When you loosen a rule, prove it still catches what it is for.** Otherwise
> you have not fixed a false alarm, you have deleted a safeguard and made the
> report green. Drop one line into a worker file:
>
> ```bash
> echo "from codesage_api.scoring.formula import clamp_profile" > src/codesage_api/tasks/_probe.py
> lint-imports        # must say: workers never score BROKEN
> rm src/codesage_api/tasks/_probe.py
> lint-imports        # 3 kept, 0 broken
> ```
>
> Thirty seconds, and it is the difference between a check that works and a
> check that looks like it works.
| Docstrings mention `WORKSPACE.active_profile_id` | In `routers/profiles.py` and `routers/auth.py`. Locked decision 11 replaced it with one active profile marked on `SCORING_PROFILE`. Reword |

---

### 3.9 — Check your work (10 min)

```bash
cd apps/api
python -c "import codesage_api.main"        # must print nothing
python -c "import codesage_api.detection.rules.engine"   # must print nothing
pytest tests/unit -q                        # all pass (2 xfailed is fine)
lint-imports                                # all contracts kept
```

Then bring up the parts that exist and try the API as a stranger:

```bash
docker compose -f ../../infra/docker-compose.yml up -d postgres redis api
curl.exe -i http://localhost:8000/api/projects
```

**You want `401`.** Not data, and not `500`. `401` means the lock is on and it
fired before the handler was ever reached.

Also try:

```bash
curl.exe -i http://localhost:8000/api/healthz          # 200, no cookie needed
curl.exe -i http://localhost:8000/api/auth/session     # 401
curl.exe -i http://localhost:8000/healthz              # 404 — it moved under /api
```

> **On Windows, write `curl.exe`, not `curl`.** In PowerShell, `curl` is an alias
> for `Invoke-WebRequest`, which takes completely different arguments. It reads
> `-i` as the start of some other parameter, then tries to interpret
> `http://localhost:8000/...` as a drive letter and fails with
> *"A drive with the name 'http' does not exist"*. The real curl ships with
> Windows; `curl.exe` reaches it.

> **You do not need Docker for this check at all.** The 401 path never touches
> the database — no cookie means no lookup — so running the API straight from
> your virtual environment proves the same thing in five seconds:
>
> ```bash
> python -m uvicorn codesage_api.main:app --port 8000
> ```

#### If `docker compose` fails on a missing CK jar

```
ERROR [3/10] COPY vendor/ck-0.7.0-jar-with-dependencies.jar /opt/ck/ck.jar
"/vendor/ck-0.7.0-jar-with-dependencies.jar": not found
```

This one is not your fault and is not caused by anything in step 3 — **the API
image has never been built by anyone.** The Dockerfile expects a Java jar that is
not in the repository, is not documented anywhere, and is not in `.gitignore`
either. It went in when the file was first written and nobody ran it since.

CK is a Java tool, so `pip` cannot fetch it, and a 10 MB binary from another
project does not belong in git history. The fix is to copy the folder rather than
one named file, so the image still builds before anyone has fetched it:

```dockerfile
ENV CODESAGE_CK_JAR=/opt/ck/ck.jar
COPY vendor/ /opt/ck/
```

Then add `apps/api/vendor/README.md` saying where to download it, and to
`.gitignore`:

```
apps/api/vendor/*
!apps/api/vendor/README.md
```

**Only the worker needs the jar, and only once the scan pipeline stops being
stubs.** The API container never touches it. Making the build depend on a file
nobody has meant nobody could run the stack at all — for a file that is not
needed yet.

> **`docker compose up -d` with no service names will fail**, and it is not your
> fault: `apps/web` has no `Dockerfile`, but the compose file tries to build one
> from that folder. Bring up the services by name as above, or write the missing
> Dockerfile. Worth raising with whoever owns the web container.

If you also want to check the migration end to end:

```bash
alembic upgrade head
docker compose exec postgres psql -U codesage_owner codesage -c "\d session"
```

---

### 3.10 — Set up Asgardeo and sign in for real (20 min)

Everything above is finished and tested before you get here. This part needs a
web browser and two values pasted into a file — no code.

**1. Create the application.**

Sign in at [console.asgardeo.io](https://console.asgardeo.io) and create an
organisation if you do not have one. Its name is the `<org>` in every URL below.

Create a new application → **Standard-Based Application** → **OpenID Connect**.

**2. Set the protocol options.**

Open the application's **Protocol** tab. Work down the page and set these — the
headings below are the console's own, in the order they appear:

| Console field | Set it to | Why |
|---|---|---|
| **Allowed grant types** | **Code** only. Untick everything else, including Refresh Token | Code is the only flow we use. Implicit and Password hand tokens to the browser, which is the design we rejected. We never refresh: the session is ours, in our database, and lives independently of any provider token |
| **Authorized redirect URLs** | `http://localhost:8000/api/auth/callback` — **and delete the `https://myapp.io/login` line that comes with the template** | Every URL in this list is somewhere Asgardeo is willing to send a user with a live authorization code. A domain you do not own has no business being on it |
| **Allowed origins** | `http://localhost:3000` | The frontend's origin |
| **PKCE** | **on, and mandatory** | Our `/api/auth/login` always sends a `code_challenge`. Mandatory means Asgardeo *refuses* a request without one, so the protection cannot be skipped by anything pretending to be us |
| **Client Authentication → public client** | **off** | This is the toggle labelled "allow the client to authenticate without the client secret". We are a backend holding a secret, not a browser app. Turning it on would let anyone with the client id complete sign-ins |
| **Client authentication method** | **Client Secret Basic** | Matches `auth=(client_id, client_secret)` in `services/auth.py`, which is exactly HTTP Basic |
| **Back channel logout URL** | **clear it** — delete the `https://myapp.io/logout` placeholder | We do not implement back-channel logout. Left as-is, Asgardeo posts logout notices to a domain that is not yours |
| Access token / ID token expiry | leave at `3600` | Irrelevant to us. The token is used once inside one function and thrown away; how long it *would* have lived does not matter |
| Pushed Authorization Requests, Request Object, encryption, certificate | leave off / blank | All optional hardening for setups more complex than this one |

Everything else on that page can stay at its default.

> **The redirect URL must match `CODESAGE_ASGARDEO_REDIRECT_URI` character for
> character** — same scheme, same port, no trailing slash. A mismatch here is the
> single most common reason sign-in fails, and the error does not say so clearly.

> **The two `myapp.io` lines are not yours.** They ship with the template and are
> easy to scroll past. Both point at a domain someone else controls, and one of
> them is a redirect target for authorization codes. Delete them.

> **Client ID is not a secret; the client secret is.** The id identifies the
> application and travels in every authorization URL — it is fine in a config
> file or a screenshot. The secret proves the request came from *your server*.
> Keep it in `infra/.env` (gitignored in 3.8), never in a message, a screenshot
> or a commit. If it ever leaks, regenerate it on this page.

**3. Turn on the details we need.**

In the **User Attributes** tab, tick **Email**, **First Name**, **Last Name** and
**Profile Picture** (`picture`) as **requested**. Without these,
`/oauth2/userinfo` returns a subject id and nothing else, and every user shows up
on screen as blank.

**Do not mark any of them mandatory**, and here is the reasoning, because it is
the more interesting half of this step.

Mandatory means *"refuse the sign-in if this is missing"*. Asking that of an
email address sounds cautious, but consider who it turns away: a GitHub user who
keeps their email private, which GitHub does not share by default. That person
has proved exactly who they are. Blocking them buys nothing, because **the
application never identifies anyone by email** — identity is the Asgardeo subject
(`asgardeo_sub`), specifically so that a changeable field is never load-bearing.

Worse, requiring it moves the failure to the worst possible place. Sign-in
succeeds, the session row is written, the cookie is set — and then
`GET /api/auth/session` returns **500**, because its own response model rejects
the answer it was given. A user who signed in perfectly sees a broken app.

So the shape says what is actually true:

| Field | Guaranteed? | Why |
|---|---|---|
| `user_id`, `workspace_id` | **yes** | Ours. Generated at first sign-in |
| `email`, `name`, `avatar_url`, `identity_provider` | no | The provider's, and it may simply not have them |

`SessionOut` and `docs/api/openapi.yaml` both require only the two identifiers.
The frontend renders a fallback — the email, or initials, or a generic avatar —
rather than assuming a display name exists. A test
(`test_a_provider_that_shares_nothing_still_produces_a_session`) pins it, so
nobody re-tightens it later thinking they are being careful.

**4. Add GitHub as a sign-in option.**

**Connections** → add a **GitHub** connection. It asks for a GitHub OAuth app's
client id and secret — create one at GitHub → Settings → Developer settings →
OAuth Apps, with callback URL
`https://api.asgardeo.io/t/<org>/commonauth`.

Then in your application's **Login Flow**, add GitHub as an option.

This is the part that makes locked decision 4 worth it: adding Google later, or a
plain password login, is another connection on this screen. No backend change.

**5. Put the values where the code reads them.**

Copy the **Client ID** and **Client Secret** from the Protocol tab. Create
`infra/.env` — check first that `.env` is in `.gitignore` from 3.8:

```bash
CODESAGE_ASGARDEO_BASE_URL=https://api.asgardeo.io/t/<your-org>
CODESAGE_ASGARDEO_CLIENT_ID=<paste>
CODESAGE_ASGARDEO_CLIENT_SECRET=<paste>
```

And the same three in `apps/api/.env` for running the API outside Docker.

**Never commit the secret.** If it is ever pushed, rotate it in the console — a
deleted commit is still in everyone's clone.

**6. Start everything and sign in.**

Three terminals. Leave the second and third running.

**Terminal 1 — the database, once.** The `-f ... -f ...` pair is the opt-in
override from 3.6 that publishes the port, because `alembic` runs on your machine
rather than inside a container:

```powershell
cd C:\Users\jpaba\Documents\GitHub\CodeSage-AI
docker compose -f infra\docker-compose.yml -f infra\docker-compose.dev.yml up -d postgres redis
```

**Terminal 2 — the API.** Leave it running:

```powershell
cd C:\Users\jpaba\Documents\GitHub\CodeSage-AI\apps\api
.\.venv\Scripts\Activate.ps1
Get-Command python | Select-Object Source     # must end in apps\api\.venv\Scripts\python.exe
alembic upgrade head
python -m uvicorn codesage_api.main:app --port 8000 --reload
```

`--reload` restarts the server whenever you save a file. Wait for
`Application startup complete.`

**Terminal 3 — the frontend.** Leave it running:

```powershell
cd C:\Users\jpaba\Documents\GitHub\CodeSage-AI\apps\web
pnpm dev
```

Wait for `Ready in ...`, then open **http://localhost:3000/login**.

> **Why `pnpm dev` and not the `web` container.** `apps/web` has no Dockerfile,
> so `docker compose up` cannot build it. `pnpm dev` is what you want anyway —
> it hot-reloads, and you can read the errors.

> **Leave `NEXT_PUBLIC_API_MOCKING=enabled`.** Sign-in is a full page navigation,
> and a service worker cannot intercept one, so it reaches the real API whatever
> this is set to. MSW also passes through anything it has no handler for, which
> includes `/api/auth/session`. Turning mocking off would only make the dashboard
> pages — which still have no real handlers behind them — render errors, and make
> a perfectly good sign-in look broken.

**What should happen:**

1. Click **Sign in**
2. The address bar changes to `accounts.asgardeo.io` — you have left your app
3. Sign in with GitHub (or the username and password if you made a local account)
4. You land back on `http://localhost:3000/projects`

**Then check the thing that matters.** Open dev tools → **Application** →
**Cookies** → `http://localhost:3000`:

| What to look for | What you should see |
|---|---|
| Name | `codesage_session` |
| Value | a plain UUID like `3f9a...`, **not** a long dotted token |
| HttpOnly | ✅ ticked |
| SameSite | `Lax` |

**A random id you cannot read is the whole point of this step.** If the value
looks like a JWT — three chunks separated by dots — something is wrong; go back
to 3.5.

Confirm the server agrees, in a fourth terminal:

```powershell
curl.exe -s -b "codesage_session=PASTE_THE_COOKIE_VALUE" http://localhost:8000/api/auth/session
```

A `500` here is **expected and fine** — `/api/auth/session` is still an empty
handler, and reaching it at all means the cookie was accepted and the lock let
you through. A `401` means the session was not recognised.

The clean proof that sign-out really revokes:

```powershell
curl.exe -s -X POST -b "codesage_session=PASTE_IT" http://localhost:8000/api/auth/logout -w "logout: %{http_code}`n"
curl.exe -s -o NUL -b "codesage_session=PASTE_IT" http://localhost:8000/api/projects -w "after logout: %{http_code}`n"
```

`204` then `401`. The second one is the point: the row is gone, so the same
cookie is now a meaningless number.

**That cookie being unreadable and meaningless is the whole point of this step.**
If you can read a token in there, something went wrong — come back to 3.5.

#### If it does not work

| What you see | Usually means |
|---|---|
| Asgardeo says the redirect URL is invalid | The URL in the console does not exactly match `CODESAGE_ASGARDEO_REDIRECT_URI` |
| Back at `/login?error=invalid` | The ten-minute handshake cookie was blocked or lost. Check `CODESAGE_COOKIE_SECURE` is `false` for local http |
| Signed in, but every API call is still 401 | The frontend is not sending `credentials: 'include'` on its fetches. That is Phase 10.6 item 6 |
| `/api/auth/session` returns 500 | Expected — it is still an empty handler. The 401 case is what this step proves |

### What is genuinely good on this branch — keep it

Say this to Chamodh, because most of the branch is strong:

- **The RLS tests** (`tests/integration/test_rls.py`, 166 lines). Tenant isolation
  is proven, not assumed. This is the most valuable test in the project.
- **The migration** with its policy set, written as data rather than as pasted SQL
  strings — which is exactly why 3.4 turned out to be a ten-minute edit instead of
  a rewrite.
- **`tests/unit/schemas/test_contract.py`** — a test asserting that every endpoint
  in the SRS actually exists is the right instinct, even though the paths in it
  need updating.
- **The import rules** in `pyproject.toml`. "Scoring is pure" is a build failure
  there, not a comment someone might ignore.
- **`presets.yaml` and `scoring/enums.py`** already have the correct five
  categories. Only the database models missed that change.

---

## Step 4 — Close the Celery branch (15 min)

> ## ✅ DONE — 17 Aug 2026
>
> Salvaged as `apps/api/scripts/trigger_scan.py`. **Nothing was merged**, and nothing
> had to be deleted: the root `docker-compose.yml`, `apps/ml/src/tasks.py`,
> `test_tasks.py` and the `lizard` dependency exist only on that branch, so leaving
> them behind was simply a matter of not bringing them.
>
> **The two `git` commands below were not usable as written.** `feature/setup-celery-redis`
> forked at `71deeaa`, *before* `apps/api` existed — the branch contains only
> `apps/ml/`, a root `docker-compose.yml` and old docs. So `git mv` into
> `apps/api/scripts/` has no destination on that branch, and switching to it to "get
> it ready" would tidy a tree with no backend in it.
>
> **`trigger.py` was rewritten, not ported.** Three things made a straight copy
> impossible, and each is worth knowing:
>
> | That branch | This one |
> |---|---|
> | `run_analysis.delay(repo_url)` | `run_scan.delay(attempt_id)` — the attempt row already exists |
> | polls `result.ready()` / `result.state` / `result.info` | **`tasks/app.py` sets `backend=None`** — there is no result backend to poll |
> | prints CK metrics + debt-hours the mock worker invented | phase (PostgreSQL), percent (Redis), elapsed — measured only |
>
> The simulated report is gone entirely. Numbers that look measured but are not are
> worse than no numbers.
>
> **Still to do by hand:** close the branch on GitHub with the salvage note (`gh` is
> not installed here, so it was not posted).

Branch: `origin/feature/setup-celery-redis`. **Do not merge it.**

It proved the async pipeline works end to end, which was worth doing. But it puts the
worker in `apps/ml`, and `apps/ml` has since become the ML inference service, while the
real pipeline lives in `apps/api/tasks/`. Merging it would give the project two workers,
two `docker-compose.yml` files and two ideas of where scans run.

**Take one thing from it:**

```bash
git checkout origin/feature/setup-celery-redis -- apps/ml/src/trigger.py
git mv apps/ml/src/trigger.py apps/api/scripts/trigger_scan.py
```

`trigger.py` enqueues a job and prints live progress. That is a genuinely useful
development tool, and it demos well. Point it at `codesage_api.tasks` instead of
`tasks`.

**Leave behind:** the root `docker-compose.yml` (we use `infra/`), `apps/ml/src/tasks.py`
and `test_tasks.py` (fake pipeline), and the `lizard` dependency in
`apps/ml/requirements.txt` (we use CK now).

Then close the branch with a comment saying what was salvaged and why the rest was not,
so the work is recorded rather than looking abandoned.

> **Tell Nathasha what was kept.** The `task_always_eager=True` pattern in her test — run
> Celery tasks synchronously with no broker — is the right way to test tasks and should
> be reused in `apps/api/tests`.

---

## Step 5 — Check the API contract (20 min)

> ## ✅ DONE — 16 Aug 2026
>
> All four commands below pass. The two missing scripts were added, and
> `openapi-typescript` was already installed.
>
> **The `:check` script is not the one-liner written below.** That version pipes to
> `diff`, which does not exist on Windows — and pnpm runs scripts through `cmd.exe`
> there, so it fails for the whole team. It is now
> `node scripts/check-generated-types.mjs`, which does the same comparison, runs
> everywhere, and normalises line endings (this repo has `core.autocrlf=true`, so a
> committed generated file arrives as CRLF on Windows while the generator emits LF).
>
> **The claim below that the contract "does not need changing" was wrong.** Two
> prose drifts were found and fixed:
>
> 1. `src/lib/types/api.ts` was **stale** — commit `1ed6901` made `email`/`name`
>    optional and nullable in the contract, but nobody regenerated. Exactly the drift
>    the `:check` script exists to catch.
> 2. Three passages described `WORKSPACE.active_profile_id`, contradicting locked
>    decision 11. The code was already right; the contract lagged. Fixed, along with
>    the same claim in `code-sage_backend-analysis-engine.md`,
>    `frontend_build_stepbystep.md` and `data-model-decisions.md`.
>
> **Also settled here:** profiles are **not versioned**. Applying a profile updates
> one row in place; the `version` column has been dropped from `ScoringProfile`. The
> contract cannot express or return a version, so a row per Apply would have grown
> unbounded for a history no endpoint could read.
>
> **Still not wired into CI** — this repo has no `.github/workflows` at all, so
> `gen:types:check` only runs when someone runs it.

`docs/api/openapi.yaml` is **finished and does not need changing.** It already matches
every decision in this plan. This step is just confirming it still generates cleanly.

```bash
cd apps/web
pnpm gen:types          # writes src/lib/types/api.ts
pnpm gen:types:check    # exits 1 if the generated file is stale
npx tsc --noEmit
pnpm test:run
```

All four must pass.

> **[SUPERSEDED — see the DONE box above. Do not follow this; the `diff` version
> does not run on Windows.]**
>
> **Two of those commands do not exist yet.** `apps/web/package.json` has no
> `gen:types` or `gen:types:check` script, and `openapi-typescript` is not
> installed — even though `src/lib/types/api.ts` is sitting there already,
> generated by hand at some point. Before running the block above:
>
> ```bash
> cd apps/web
> pnpm add -D openapi-typescript
> ```
>
> then add to `scripts` in `package.json`:
>
> ```json
> "gen:types": "openapi-typescript ../../docs/api/openapi.yaml -o src/lib/types/api.ts",
> "gen:types:check": "openapi-typescript ../../docs/api/openapi.yaml | diff - src/lib/types/api.ts"
> ```
>
> The `:check` one is what stops the generated file and the contract drifting
> apart silently — it fails the moment someone edits one without the other.

**What the contract already says**, so you do not have to look it up:

| | |
|---|---|
| Auth | `GET /api/auth/login` · `GET /api/auth/callback` · `GET /api/auth/session` · `POST /api/auth/logout` |
| Security | Cookie named `codesage_session`. Only login, callback and `/healthz` are public |
| Field names | snake_case everywhere |
| Categories | five — `code-design`, `requirement`, `documentation`, `test`, `security` |
| Profile | five weights + `trust_s` = six numbers |
| Scan phases | `idle`, `queued`, `running`, `done`, `error`, `cancelled` |
| `risk_score` | **nullable.** `null` = ML did not run. `0.0` = measured and safe. Not the same thing |
| `pinned_by_floor` | `true` when a critical security finding is held visible by FR-24 rather than by its score |

**Later, not now:** add a CI job that compares FastAPI's generated `/openapi.json`
against this file. It only makes sense once the handlers have bodies.

---

## Step 6 — Start frontend Phase 10.6

Everything above exists so this step has no blockers.

Open `docs/Project Management & Planning/frontend_build_stepbystep.md` and go to
**Phase 10.6**. Do not touch Phases 0 to 10.5 — those are already built.

Phase 10.6 in one line: regenerate the types from the contract, let the TypeScript
compiler show you every place that breaks, and fix them.

The order inside the phase matters, and it is written there:

1. `pnpm gen:types` **first** — then the compiler finds all ~244 rename sites for you,
   instead of you searching for them
2. snake_case rename through the components
3. `defect` out of the category filter — five chips, not six
4. Profiles page: five weight sliders + one trust slider
5. `cancelled` added to the scan state machine
6. Sign-in button points at `/api/auth/login`; every `fetch` gets
   `credentials: 'include'`
7. MSW handlers updated to the new shapes so the tests still run with no backend

You can do all of that against the mock backend. **You do not need Chamodh's branch
merged to start**, and you do not need the ML service at all.

---

## Decisions that are locked

Do not reopen these. Everything above assumes them.

| # | Decision | What follows from it |
|---|---|---|
| 1 | **snake_case on the wire** | No `alias_generator` in the API. Frontend renames in Phase 10.6 |
| 2 | **Five debt categories** — `code-design`, `requirement`, `documentation`, `test`, `security` | SATDAUG has no `defect` label. Profile = five weights + trust slider = six numbers |
| 3 | **Six containers** — postgres, redis, ml, api, worker, web | `infra/docker-compose.yml` is the stack. No pgadmin, no root compose file |
| 4 | **Asgardeo is the identity provider** | GitHub federated inside it. Adding Google or a password login later is a console setting, not code |
| 5 | **FastAPI is the Backend-for-Frontend** | The browser talks to FastAPI directly. Asgardeo integration lives in the backend, not in Next.js |
| 6 | **Server-side session + httpOnly cookie** | Sign-out revokes immediately. The browser never holds a token |
| 7 | **CK + Tree-sitter + PyDriller**, Java only | CK is a Java jar, not a pip package. No Lizard anywhere |
| 8 | **SATDAUG** (ML-1) and **D'Ambros** (ML-2) | No GHPR, no Li et al. as the primary corpus |
| 9 | **`AnalysisAttempt` + `Snapshot`**, not one `SCAN` table | A cancelled attempt structurally cannot produce a snapshot |
| 10 | **Modular monolith**, split by workload not by domain | Not microservices. `ml` is an extracted function, not a service that owns data |
| 11 | **Exactly one active profile per workspace**, enforced by a partial unique index on `SCORING_PROFILE` | Replaces the earlier `WORKSPACE.active_profile_id` idea. Same guarantee, and the migration already does it |

---

## Still open

Three questions. None of them blocks any step above.

1. **Account linking.** Someone signs in with GitHub today and with Google next year,
   same email address. One account or two? It is a switch in the Asgardeo console, but
   the policy is yours. Default is two.
2. **GitHub rate limits.** Anonymous REST is about 60 requests an hour per IP, which is
   thin for branch metadata. Do we add one project-owned service token? (Not a user
   token — those stay out under federation.)
3. **Is ML in scope this sprint?** If not, `risk_score` comes back as `null` and the
   dashboard shows rule findings only. The contract already allows that, so nothing
   breaks — just decide it deliberately rather than by accident.

## Not doing

- Microservices — see SAD §2
- A Next.js proxy tier — rejected in favour of FastAPI as the BFF
- Private repositories, GitHub App, RBAC, webhooks — all v1.1 and later
- Writing CR-002 as a separate document — the v1.1 revision-history rows now carry the
  same information, in the deliverable itself
