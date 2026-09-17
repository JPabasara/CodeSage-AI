# Team plan — to final submission (Fri 18 Sep 2026)

*Working plan · rewritten 6 Sep 2026 after the team meeting · Group 16. Twelve days.*

The reasoning behind these choices — the ML designs, the deployment steps, why RBAC is ours —
is in [plan-to-final-submission.md](plan-to-final-submission.md). Work from this one.

---

## 1. Overall view

**By Friday 18 September the product is finished, deployed on our own cluster, tested, and
documented.** Four things must be true:

1. **The deployed product runs the trained models** — not a keyword fallback.
2. **Every v1.0 requirement is met**, or written down as not met with a reason.
3. **It runs on k3s on our own VPS**, with worker scaling you can watch happen.
4. **The test plan report is submitted**, and its numbers were measured.

**One feature is being added: RBAC**, workspace-bound and enforced by our own backend.
Asgardeo stays for **authentication only**. Two smaller gaps close alongside it — removing a
repository, and seeding a demo repository at first sign-in.

### Milestones

| | Due | Means |
|---|---|---|
| **M5 — Features and frontend complete** | **Sat 12 Sep** | RBAC, repo removal, demo seed, rate limiting, every numbered frontend requirement |
| **M6 — ML complete** | **Mon 14 Sep** | Models deployed, retrained, thresholds chosen, baselines reported, `k` calibrated |
| **M7 — Deployed and tested** | **Wed 16 Sep** | Live on k3s, Playwright in CI, usability test run, every test case executed |
| **M8 — Documents and test report** | **Fri 18 Sep** | SRS v1.2, SAD v1.2, CR-002, test plan report |

**This is tight.** It works because the three tracks run in parallel and because test execution
happens *as each area lands*, not as a phase at the end. The one thing that can break it is
new scope — see §3.

---

## 2. Who does what

| | Owner | Reviewed by |
|---|---|---|
| `apps/api/` — RBAC, repo removal, demo seed, rate limiting, `k` | **Chamodh** | Janidu |
| `apps/web/` — the critical frontend paths | **Janidu** | Chamodh |
| `apps/web/` — self-contained polish | **Nathasha** | **Janidu reviews every PR** |
| `apps/ml/` — ML-2, artifacts, baselines, reports | **Nathasha** | Janidu |
| `apps/ml/` — ML-1 SATD fine-tune | **Janidu** | Nathasha |
| `infra/`, `.github/`, `infra/k8s/` | **Janidu** | — |

**Nathasha is doing frontend for the first time**, so her issues are deliberately
self-contained — copy, colour tokens, one component each. Nothing touching shared hooks, the
root layout, or the triage flow. **Janidu reviews every one of her frontend pull requests.**

**Two shared files, nobody edits alone:** `docs/api/openapi.yaml` and
`apps/ml/src/codesage_ml/risk/features.py`. A change to either is its own pull request with no
code in it, approved by the other two.

---

## 3. Rules for the twelve days

1. **No new scope.** Not private repos, not a second language, not finding actions, not
   invitations. All v1.1 or v2 in the SRS, and they stay there.
2. **Frontend polish stops when the numbered U-requirements are green.** Everything else goes
   on the report's "future work" list.
3. **Record test results as each area lands.** Not on the 17th.
4. **Deployment has a stop rule** — §4.3. If the cluster is not live by **Tue 16 Sep**, keep
   Railway and ship the manifests as evidence.
5. **Asgardeo is authentication only.** Roles are ours, per workspace.

---

## 4. Janidu

### Overall
Critical frontend paths, the whole deployment, ML-1 fine-tuning, and the reviews. The heaviest
load, so nothing optional is on it.

### 4.1 Frontend — by Sat 12 Sep *(M5)*

Only the paths that touch shared code or the core journey:

- [ ] **`#109` SCORE_PENDING on the dashboard** — the async scoring layer landed, so the API
      answers **503 `SCORE_PENDING`** while a score computes, and nothing in `apps/web`
      branches on it. A freshly finished scan currently shows a red error. `demo-critical`,
      do it first.
- [ ] **`#110` Retry actually retries** — `useQuery.reload` never flips `loading`, so every
      Retry button looks dead. Everything else renders an error state, so this comes second.
- [ ] **`#112` ThemeProvider and real dark mode** (FR-22) — a v1.0 feature that does not work.
- [ ] **`#115` Keyboard operability** (U-9) — finding rows are `onClick` with no `tabIndex`,
      so the core triage flow is unreachable by keyboard.
- [ ] **`#98` Open a historical snapshot** (FR-19) — the API is ready; rows are not clickable.

### 4.2 ML-1 — SATD fine-tune, by Mon 14 Sep *(M6)*

- [ ] **Split SATD into two stages**, add character n-grams and a marker feature.

One model currently answers two questions at once — *is this debt* (58,204 vs 4,071) and
*which kind* (4,071 across 4 classes). Splitting them **mirrors the contract exactly**, since
`is_debt` and `category` are already separate fields. Same data, two `fit()` calls, and
`/classify` does not change. Expected: binary F1 **0.80–0.85**, macro F1 **0.78–0.80**.

### 4.3 Deployment — by Wed 16 Sep *(M7)*

Three issues, in order. **All manifests committed to `infra/k8s/`** so the deployment is
reviewable, not a thing that exists only on one server.

- [ ] **Provision the VPS** — k3s (`--disable traefik`), ingress-nginx, cert-manager, the GHCR
      pull secret. **No certificate is bought:** Let's Encrypt is free and automatic, exactly
      what Railway does for us invisibly today. Use the **staging** issuer while testing.
- [ ] **Manifests, Secrets and the migration Job** — Deployments and Services for all four,
      Ingress for both hostnames, `alembic upgrade head` as a one-off `Job` before the api
      rollout.
- [ ] **KEDA, NetworkPolicy, DNS cutover, CI deploy** — worker pods scale on Redis queue
      length, `minReplicaCount: 1`. This is the demo: start four scans, watch pods appear.

> **Stop rule.** If the cluster is not serving the live domain by **Tue 16 Sep**, keep Railway
> and ship the manifests as reviewed evidence of the design. *"We wrote the Kubernetes
> deployment and chose not to cut over two days before submission"* is defensible. A broken
> demo is not.

### 4.4 Tests and documents

- [ ] **Playwright in CI** as a required check *(M7)* — 48 journeys exist and are not a merge gate.
- [ ] **Usability test, five participants** *(M7)* — U-1 needs 4 of 5 unaided, median ≤ 5 min.
      **Not teammates.** Book them this week.
- [ ] **Execute TC-01…TC-24 and record results** *(M7)*.
- [ ] **SAD v1.2** and **CR-002** *(M8)*.
- [ ] **Write the test plan report** *(M8)*.

### 4.5 Reviews Janidu owns

**Chamodh's RBAC** · **every one of Nathasha's frontend PRs** · the rate-limiting frontend half.

---

## 5. Chamodh

### Overall
Every remaining API feature, then the `k` calibration and the SRS. Finishes the feature work
first, which is what frees him for the documents.

### 5.1 Features — by Sat 12 Sep *(M5)*

- [ ] **RBAC** — `role` on `membership` (`org_admin`, `manager`, `developer`, `viewer`, the
      FR-23 names), a `require_role()` dependency, writes gated, **reads open to every role**,
      403 through the existing envelope. **No role-assignment UI** — that is v2.
      *Janidu reviews.*
- [ ] **Remove a connected repository** — `DELETE /api/projects/{repo_id}`, clean cascade,
      refuse while a scan runs, gated on role. **This is an OpenAPI change**, so it needs its
      own contract PR first.
- [ ] **Seed a demo repository at first sign-in** — a new user should land on a populated
      Projects page, not an empty state. Configurable, skippable, no auto-scan.
- [ ] **Rate limiting (SEC-12)** — `slowapi` on Redis, keyed on `workspace_id`, 429 through
      the existing `RATE_LIMITED` code. *Paired with Janidu, who takes the frontend half.*
- [ ] **`#43` Choose the demo repository** — a small Java repo that scans in under two minutes
      and shows a mix of severities.
- [ ] **`#35` Endpoint tests** — 401 signed out, tenant isolation, and now **403 by role**.
- [ ] **Odds and ends** — `/readyz`, `/version`, `ck_version = "0.7.0"`, the SATD client's
      hardcoded timeout, the ruff backlog.

### 5.2 Calibration — by Mon 14 Sep *(M6)*

- [ ] **Choose the golden repositories** — 5–8 public Java repos from obviously healthy to
      obviously neglected. **Write down the grade each should get, and commit that file,
      before scanning any of them.** That order is the evidence the exercise was honest.
- [ ] **Calibrate `k`** and record the value **and the method** in the SAD, as FR-11 requires.

> Until this is done **no health score is defensible**, and a wrong `k` fails *silently* —
> everything grades A, or everything grades E, and neither looks like a bug.

### 5.3 Documents *(M8)*

- [ ] **`#117` SRS v1.2** — he made the data-model changes, so he writes them up. The one that
      matters: **FR-21 says scores are "derived on read, never stored"**, and `SNAPSHOT_SCORE`
      now stores them. Rewrite it as derivation-plus-memoisation, add the pending-score state,
      add the RBAC role and SEC-12, add v1.2 revision rows.

---

## 6. Nathasha

### Overall
The ML track, plus self-contained frontend work with Janidu reviewing. Her ML issues come
first — the artifact one blocks everything else in the project.

### 6.1 ML — by Mon 14 Sep *(M6)*

- [ ] **Ship the trained artifacts into the `ml` image.** **Start here, before anything else.**
      `models/` holds only `.gitkeep` and `*.joblib` is gitignored, so the live container
      answers from a keyword matcher and a heuristic formula. Everything returns 200, so
      nothing looks broken. Publish as **GitHub Release assets**, fetch with `--checksum` in
      the Dockerfile, verify by reading **`model_version`** — never the HTTP status.
- [ ] **ML-2: mine our own corpus and retrain.** ROC-AUC is 0.6183 because **only 2 of 13
      features carry real values**. Point the scan's own clone → CK → PyDriller code at ten
      Java repositories and label files touched by bug-fix commits. Training data then lands
      in our exact feature space, computed by the code path that runs in production. **Keep
      the 13 features and their order unchanged** — that is a contract.
- [ ] **Choose thresholds for both models** — `F1 @ 0.5 = 0.0000` is the wrong cut-off, not a
      broken model. Choose on validation, never on test.
- [ ] **Build the rule baselines FR-25 requires** — a marker regex for ML-1, size and churn for
      ML-2. These do not exist yet, so no current number has a scale.
- [ ] **Model cards and per-class reports** checked into `training/reports/`.

### 6.2 Frontend — by Sat 12 Sep *(M5)*

Self-contained: copy, colour tokens, one component each. Nothing touching shared hooks or the
root layout. **Janidu reviews every PR.**

- [ ] **`#111` Named empty states** (U-14) — including the two that look identical today: zero
      findings is good news; filtered-to-nothing is a dead end needing a way out.
- [ ] **`#113` Category pie: real colours and a legend** — `--chart-1…5` are five greys.
- [ ] **`#114` Contrast and colour-only meaning** (U-7, U-8) — save the axe output, the report
      cites it.
- [ ] **`#116` Responsive to 1280×720 and list legibility** (U-13).
- [ ] **App badge** — favicon, PWA manifest, install icons, Open Graph image.
- [ ] **Accessibility essentials** — skip-to-content link, landmarks, real labels,
      `prefers-reduced-motion`, `<html lang>`. Deliberately small, and **not** overlapping
      #114 or #115.

### 6.3 Document *(M8)*

- [ ] **ML results document.** Lead with the leakage finding. Per-class figures with counts,
      binary F1 against the 0.80 target, **PR-AUC beside its 0.159 baseline**, and the earlier
      0.7086 we corrected downward ourselves.

---

## 7. Honest risks

| Risk | What we do |
|---|---|
| **Artifacts slip past Wed 9 Sep** | Everything in the ML track is worthless until they ship. If Wednesday arrives with no artifact in the image, it becomes the whole team's problem |
| **k3s eats the last three days** | The stop rule in §4.3. Railway stays live and DNS can go back |
| **Nathasha's first frontend PRs need several rounds** | Her issues are deliberately isolated, and Janidu reviews. If one stalls past Thu 10 Sep, Janidu takes it |
| **The usability test does not happen** | It cannot be written from a desk and the report depends on it. Book five people **this week** |
| **`k` is skipped as optional** | It is not. FR-11 names it, and the score is indefensible without it. The *ranking* is not — that is what we demo |
| **ML-2 stays weak** | Likely and survivable. 0.62 → around 0.70 honestly reported, with PR-AUC lift over baseline, and a bounded 1.0–2.5 role that creates no debt of its own |
| **The 18th is too tight** | If something must go, it is **k3s**, not the tests or the documents. Moving hosts closes no requirement |

---

## 8. The issue list

**37 tracked items** — 14 already open and re-homed, 23 created by
`scripts/create-final-backlog.sh`.

### M5 — Features and frontend complete · Sat 12 Sep

| Issue | Who |
|---|---|
| `#109` Dashboard handles SCORE_PENDING | Janidu |
| `#110` Retry actually retries, plus one shared ErrorState | Janidu |
| `#112` Mount ThemeProvider and make dark mode real | Janidu |
| `#115` Keyboard operability and scan announcements | Janidu |
| `#98` Open a historical snapshot from analysis history | Janidu |
| `#111` Named empty states | Nathasha |
| `#113` Category pie: five real colours and a legend | Nathasha |
| `#114` Contrast and colour-only meaning | Nathasha |
| `#116` Responsive to 1280×720 and list legibility | Nathasha |
| App badge: favicon, PWA manifest and install icons | Nathasha |
| Accessibility essentials: skip link, landmarks, reduced motion | Nathasha |
| RBAC: workspace-bound roles enforced in our own backend | Chamodh |
| Remove a connected repository | Chamodh |
| Seed a demo repository at first sign-in | Chamodh |
| Rate limit the API by workspace (SEC-12) | Chamodh |
| `#43` Choose a demo repository | Chamodh |
| `#35` Endpoint tests: 401, isolation, and 403 by role | Chamodh |
| Finish the API odds and ends | Chamodh |

### M6 — ML complete · Mon 14 Sep

| Issue | Who |
|---|---|
| Ship the trained model artifacts into the ml image | Nathasha |
| ML-2: mine our own corpus and retrain the risk model | Nathasha |
| Choose operating thresholds for both models | Nathasha |
| Build the rule baselines FR-25 requires | Nathasha |
| Model cards and per-class reports checked in | Nathasha |
| ML-1: two-stage split, character n-grams, marker feature | Janidu |
| Choose and record the golden repositories for k calibration | Chamodh |
| Calibrate k and record the value and the method | Chamodh |

### M7 — Deployed and tested · Wed 16 Sep

| Issue | Who |
|---|---|
| Provision the VPS: k3s, ingress-nginx and cert-manager | Janidu |
| Kubernetes manifests, secrets and the migration Job | Janidu |
| KEDA queue scaling, NetworkPolicy, DNS cutover and CI deploy | Janidu |
| Playwright runs in CI as a required check | Janidu |
| Usability test with five participants | Janidu |
| Execute TC-01 to TC-24 and record the results | Janidu |

### M8 — Documents and test report · Fri 18 Sep

| Issue | Who |
|---|---|
| `#117` SRS v1.2 | Chamodh |
| `#118` SAD v1.2 | Janidu |
| `#119` CR-002 — RBAC enforcement pulled into v1.0 | Janidu |
| ML results document: the two models, honestly | Nathasha |
| Write and submit the test plan report | Janidu |

### Close these

`#69` (replaced by #109–#116) · `#99` (the table is built) · `#50`, `#51` (replaced by the
model-card issue) · `#52` (replaced by the ML-2 mining issue) · `#53` (replaced by the ML
results document).

### Pushing them

```bash
gh auth refresh -s project                 # once, for the board
gh project list --owner JPabasara          # note the exact board title

cd /c/Users/jpaba/Documents/GitHub/CodeSage-AI
PROJECT="<your board title>" bash scripts/create-final-backlog.sh
```

Idempotent — an issue whose title already exists is skipped, so it is safe to re-run. Without
`PROJECT` it creates everything except the board links.

---

## 9. What we lead with at the end

Not feature count. **Evidence of judgement**, which most projects cannot show:

1. We found our own data leakage, proved it by showing the scores tracked the padding ratio
   exactly, and **published corrected numbers that went down**.
2. We corrected ML-2's ROC-AUC downward, 0.7086 → 0.6183, rather than keep a number produced
   by mapping features by position.
3. The CK jar was gitignored, so every published image could not run a scan while every build
   stayed green — *CI checked what the code says and never checked what the artefact does.*
4. RLS is silently ignored for a table's owner, so the application connects as a non-owner
   role. Isolation that looks like it works and does nothing is the failure we avoided.
5. The ML service improved four times in September and neither the API nor the frontend changed.
