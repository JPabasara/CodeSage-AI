# Code Sage AI — Data-model decisions (DB · multi-tenancy · RLS)

**Status:** decided · **Scope:** v1.0 → v2 seam · **Audience:** frontend + backend
**Companions:** [release-roadmap.md](./release-roadmap.md) · [code-sage_backend-analysis-engine.md](./code-sage_backend-analysis-engine.md) · SRS §3.10 (DB-1/DB-2, S-3) · SAD §9 (Data View / ER diagram)

Why this file exists: the schema decisions were scattered across the SRS, the SAD and a chat thread. They are cheap to honour on day one and expensive to retrofit, so they live in one place the backend can read before writing the first migration.

> ## ⚠️ Five schema changes since this was written (last updated 15 Aug 2026)
>
> **Status against `origin/chamodh/backend` @ `a1e6e5e`:** change 1 is done; changes 2,
> 3 and 4 are **not** in the models yet; change 5 is done. The exact edits are step 3c
> of [the work plan and locked decisions](work-plan-and-locked-decisions.md).
>
> **1. `SCAN` is split into `AnalysisAttempt` + `Snapshot`.**
> Every attempt gets a row, including cancelled and failed ones; only a *successful*
> attempt produces a Snapshot. This makes "only a completed scan can be read back"
> **structural** rather than a `WHERE phase = 'done'` convention that someone must
> remember on every query. There is no `FILE_SCORE` table — per-file facts live in
> `StaticMetric`, `ProcessMetric` and `BugRiskPrediction`.
>
> **2. Five debt categories, not six.** `defect` is gone (SATDAUG has no such label),
> so `ScoringProfile` carries **five weights + `trust_s`**. There is no `defect_weight`
> column, and `ScoringPreset` must carry the same five — including `security_weight`,
> without which the Security-first preset cannot express itself.
>
> **3. Identity keys on Asgardeo, not GitHub.** Sign-in is Asgardeo with GitHub
> federated inside it, so the stable identity is Asgardeo's `sub` claim:
> `app_user.asgardeo_sub` is the unique key. `github_user_id` stays as display metadata
> and loses its unique constraint. **Never key a user on email** — email changes,
> `sub` does not.
>
> **4. A `session` table.** FastAPI is the BFF and holds a server-side session,
> handing the browser an httpOnly cookie. Sign-out deletes the row, which is what makes
> SEC-10 true. No token is ever stored. Columns: `id`, `user_id`, `workspace_id`,
> `created_at`, `last_used_at`, `expires_at` — plus an RLS policy like every other
> tenant-owned table.
>
> **5. "Exactly one active profile" is a partial unique index, not a foreign key.**
> This document and SAD v1.0 both proposed `WORKSPACE.active_profile_id`. The
> implemented schema instead puts `is_active` on `SCORING_PROFILE` with
> `UNIQUE (workspace_id) WHERE is_active`. **Both give the same structural guarantee**,
> the migration already does it this way, and SAD v1.1 §6.2 and Table 9-2 have been
> updated to match. Do not change it back.
>
> Unchanged and still correct: `workspace_id` on every tenant-owned table, RLS keyed on
> it, and no OAuth-token column anywhere.

---

## 1. Does the frontend need to wait for the database? **No.**

| Reason | Detail |
|---|---|
| Phase 8 has no database | MSW intercepts `fetch()` in the browser. Phase 12 (real backend) only changes a base URL in `lib/api/client.ts`. |
| There is no backend code yet | Only `apps/web` is tracked — no `apps/api`, no migrations, nothing to design against. Schema work with no service to run it is premature. |
| The tenant seam is already in the contract | [`types/index.ts`](../../apps/web/src/lib/types/index.ts) carries `Repo.workspaceId?` plus `Workspace` / `Member` / `Role` as v2-only types. SRS DB-1/DB-2/S-3 and SAD §9 already commit to PostgreSQL + RLS on `workspace_id`. **The decision is made; it is only unimplemented** — and implementing it is the backend's first task, not the frontend's.

**Conclusion:** frontend proceeds through Phases 8–11 uninterrupted.

---

## 2. Three things to settle with the backend (contract questions, not schema questions)

None of these blocks frontend work. Each is ~15 minutes now, or a data migration later. **D-1 and D-2 are still open contract questions; D-3 is decided (2026-07-27) and listed here because the backend must honour it from the first scan.**

### D-1 · Freeze the enum string values *before the first migration*

`Severity`, `Source`, `Category`, `Grade` and `FindingStatus` become PostgreSQL `CHECK` constraints (or enum types). Whatever strings the backend bakes in are what the frontend must render forever.

**`Category` is now frozen at six values** ([CR-001](../Change%20Requests/CR-001_2026-07-30_scoring-model-and-finding-ux.md) D-CR12, 31 Jul 2026 — this closes **D5**). Read off `satd-dataset-code_comments.csv`, the only file v1.0 uses:

| `Category` (store this) | Dataset label (train on this) | Assigned by |
|---|---|---|
| `code-design` | `code/design_debt` | ML-1 + rule engine |
| `requirement` | `requirement_debt` | ML-1 |
| **`defect`** | **`defect_debt`** | ML-1 |
| `documentation` | `documentation_debt` | ML-1 |
| `test` | `test_debt` | ML-1 |
| `security` | *(not in the dataset)* | rule engine only |

Three things the backend must honour:

- **Store the normalised value, not the dataset label.** The mapping above is applied once, in the ML service's post-processing. `code/design_debt` must never reach the database — a `/` in a value that has to survive URLs, CSS class names and filter parameters is a problem you only get to fix once.
- **`non_debt` is not a category.** It is the negative class of the debt/not-debt decision. It must not appear in the enum, in a `CHECK` constraint, or as a slider.
- **`defect` is new** — it was absent from every earlier draft. Any `CHECK` constraint or seed written before 31 Jul is missing it.

- Pick one exact spelling for every enum value, on both sides, in one sitting.
- Changing it afterwards = data migration **+** frontend change **+** re-running every fixture.

**`Severity` and `Category` are written once, by the detector.** Both are set at detection from the rule register (SRS Appendix C) — SATD rows get `category` from ML-1 and `severity` from the comment-marker table (SRS FR-9.2, Appendix C.2); ML-2 writes no finding row. No later process updates these columns: scoring reads `severity` as a lookup into base points, the client reads it to draw a badge, and neither writes. **No user setting writes them either** — `SCORE_PROFILE` carries weights only (D-4). So these two enums are **backend-authored, frontend-rendered** — which is exactly why their spellings must be frozen before the first migration. Normative in SRS **FR-8.1**.

**`Source` is now two values — `rule | satd`** ([CR-001](../Change%20Requests/CR-001_2026-07-30_scoring-model-and-finding-ux.md) D-CR3). The former `security` value duplicated `category` exactly — security patterns run inside the rule engine, so such a finding was always `source = security` **and** `category = security` — and `ml-risk` was unreachable, because the risk model writes `FILE_SCORE.risk_score` and never a `FINDING` row. Constrain the column to the two values in the first migration: a `CHECK` that still permits four will silently admit rows the frontend can no longer explain. Normative in SRS **FR-8.2**.

> ✅ **Confirmed against the CSV on 31 Jul 2026 — the contract is frozen and nothing now blocks the first migration.**

### D-2 · `SCAN` rows are **append-only** (immutable snapshots)

Each scan **inserts** a new row keyed by (repo, branch, commit SHA, timestamp). It never updates the previous one.

Three v1.0 features are pure reads over that history:

- **Card B** — the health trend chart (`HealthReport.history`)
- **`delta`** — score vs the previous snapshot
- **Scan-History tab** — the list of past scans (`ScanSummary`)

If the backend "updates the latest scan" instead of inserting, all three silently have nothing to show. SAD §9 already states append-only — this note exists to make sure it was actually read.

**Append-only cuts both ways — snapshots are write-once *and* read-only.** A stored snapshot is never an input to a later scan: no model reads it, no scoring pass reads it. The only consumers are the three read features above. Detection and scoring depend solely on the repository at the scanned SHA (SRS FR-7.1 · SAD §6.1), which is what makes a scan a pure function and skip-if-unchanged sound.

### D-3 · Churn window is anchored to the last commit — **decided**

`churn_factor` (SRS FR-11) uses `commits_90d`. **The 90 days are measured backwards from the committer date of the scanned commit** — the branch's last commit, the same SHA stored on the `SCAN` row and shown in the top nav:

```
window = [ commit_date(scanned_sha) − 90 days , commit_date(scanned_sha) ]
```

**Wall-clock `now()` is not used anywhere in scoring.** Consequences the backend must honour:

- Re-scanning the same SHA always reproduces the same score, so stored scores stay comparable across the trend chart and FR-6's skip-if-unchanged ("same SHA ⇒ reuse snapshot") is provably correct.
- Scanning an old commit (or replaying history to backfill a trend) yields the churn that was true *at that commit*, not churn relative to today.
- A repository that has not been touched in a year scores identically whether scanned today or next year — an untouched repo does not silently drift.

This is a data decision, not just a scoring one: it is baked into every `FILE_SCORE` and `SCAN` row the moment the first scan runs, and changing it later invalidates the entire stored history. Closed as **D6** in [release-roadmap.md](./release-roadmap.md) §7.1 on 2026-07-27.

---

### D-4 · `SCORE_PROFILE` holds weights, never severities — **decided**

Shape, frozen by [CR-001](../Change%20Requests/CR-001_2026-07-30_scoring-model-and-finding-ux.md) D-CR4:

```
SCORE_PROFILE {
  weights   jsonb    -- keyed by the six CATEGORY values (D-1):
                     -- security · code-design · defect · requirement · documentation · test
                     -- each clamped 0.1 – 3.0
  trust_s   numeric  -- 0.0 – 1.0, default 0.5 — the rules ←→ model slider
  is_preset bool
}
```

Three things the backend must honour:

- **`weights` is keyed by `category`, and by all six of them.** The `defect` key was added by D-CR12; a profile seeded before 31 Jul 2026 is missing it. The previous vector mixed axes — it carried `satd` (a *source*) and `duplication` (a *rule*) while omitting `requirement`, `documentation` and `test` entirely, so a documentation-category SATD finding had no defined weight. Since v1.0 exposes these as user-facing sliders, a key that does not correspond to a category is a control the user can drag with no effect.
- **`w_ml` is gone**, replaced by `trust_s`. If a migration or seed script still writes `w_ml`, scoring will silently read a default.
- **No severity column, ever.** Severity is detector-authored (D-1). A profile that could write severity would defeat the visibility floor (SRS FR-24).

Seed the three presets as rows with `is_preset = true`; they are the values the sliders reset to, and **Balanced** is the default profile for every new workspace.

> ### ⚠️ SUPERSEDED 16 Aug 2026 — reversed by locked decision 11
>
> The entry below chose `WORKSPACE.active_profile_id`. **The implemented design is
> the opposite:** `SCORING_PROFILE.is_active`, under a partial unique index on
> `(workspace_id) WHERE is_active`. See `db/models/profile.py` and the `is_active`
> description in `docs/api/openapi.yaml`.
>
> **Why it was reversed.** The objection below — that a partial unique index is
> "something someone has to remember to write" — turned out not to hold. The index
> is written once in the migration and is then enforced by PostgreSQL on every
> write, exactly as an FK would be; two active rows is not a silent corruption, it
> is a rejected `INSERT`. Both designs are structural. What separates them is
> row-level security: the FK version writes to `WORKSPACE` *and* `SCORING_PROFILE`,
> so a profile switch has to satisfy two tables' policies, while the flag version
> stays inside one table.
>
> **One thing the FK did give us**, and it is a real loss: a `NOT NULL` FK
> guarantees *exactly* one active profile. The index guarantees only *at most* one
> — nothing in the database prevents every row being `is_active = false`. That
> guarantee is now held in the service layer, by sign-in seeding **Balanced** as
> active and by `PUT /api/profiles/active` clearing the old row and setting the new
> one in a single transaction.
>
> **Also settled 16 Aug 2026:** profiles are **not versioned**. Applying a profile
> updates the one row in place. The `version` column has been dropped —
> `docs/api/openapi.yaml` cannot express or return a version, so a row per Apply
> would have accumulated a history no endpoint could read.
>
> The original entry is kept below unedited, because why we changed our minds is
> worth more than a tidy document.

**Which profile is active lives on `WORKSPACE`, not on `SCORE_PROFILE`** — added 01 Aug 2026:

```
WORKSPACE {
  active_profile_id  uuid FK -> SCORE_PROFILE   -- nullable; NULL means Balanced
}
```

- **Not an `is_active` flag on `SCORE_PROFILE`.** "Exactly one active profile per workspace" is then a partial-unique-index someone has to remember to write, and two active rows is a silent corruption the read path cannot resolve. An FK makes it structural — there is nowhere to *put* a second answer.
- **The active profile is workspace state, not session state.** It is deliberately shared: a reload, a second tab and a second team member resolve the same lens, which is what makes the trend chart's profile label (D-CR10) honest.
- **`PUT /api/profiles/active` is the only writer** (SRS FR-20, SAD §6.2). It clamps, updates the `SCORE_PROFILE` row, sets this FK, and returns the stored profile. It writes nothing else — in particular **no `SCAN` row** (D-2, D-5).
- **Clamp in the API, not only in the browser.** The sliders cannot exceed `0.1–3.0` / `0–1`, but the sliders are not the constraint; `repo_health` is calibrated against `k` and an out-of-range weight from any client makes every stored grade incomparable.

---

## 3. RLS — the one rule for the first migration

**Put `workspace_id` on every tenant-scoped table in the very first migration**, even while the policies are still off and every row holds the same value.

- Turning RLS **on** later = one migration.
- Retrofitting the **column** into ~8 tables that already hold data — and fixing every query that forgot to filter by it — is the expensive version.

That is exactly what "secure multi-tenant foundation in v1.0" ([release-roadmap.md](./release-roadmap.md), Objective 2) means in practice, and it costs nothing on day one. Tenant-scoped tables per SAD §9: `REPO`, `SCAN`, `FINDING`, `FILE_SCORE`, `SCORE_PROFILE`, `SUPPRESSION`, `MEMBERSHIP`, `BRANCH` (via `repo_id`).

### What the frontend must **not** build

No workspace picker, and **nothing that sends `workspace_id` from the browser**. Under RLS the tenant is derived from the session/token **server-side** and is never trusted from the client. This is precisely why `Repo.workspaceId` is optional and unused in v1 — that is correct as-is and should stay that way until v2 collaboration lands.

### D-5 · The schema stores **facts**, never scores — *decided 2026-07-31*

Since [CR-001](../Change%20Requests/CR-001_2026-07-30_scoring-model-and-finding-ux.md) made the profile editable at any moment, **a stored score is a bug waiting to happen**: it is stale the instant a weight moves, and "just update it" would break the append-only property D-2 depends on.

**The rule for the first migration:**

| Column | Verdict |
|---|---|
| `FINDING.*` — file, line, symbol, source, category, severity, evidence, reason | ✅ **store** — facts about the code at that SHA |
| `FILE_SCORE.risk_score`, `FILE_SCORE.churn_factor` | ✅ **store** — model output and measured churn, both fixed at that SHA |
| `SCAN.commit_sha`, `scanned_at`, `finding_count`, `model_version` | ✅ **store** |
| `FINDING.priority`, `FILE_SCORE.debt_score`, `SCAN.health_score`, `grade`, `delta` | ❌ **do not store as truth** — derive under the active profile |

If a denormalised score column is kept for speed (the Projects-list hint), it is a **cache**: stamp it with `cached_under_profile` and recompute whenever the active profile differs. Never read it without checking that column.

**Two consequences the backend must honour:**

1. **A profile change writes nothing.** No `SCAN` insert, no `FINDING` update. It is a read-path recomputation only.
2. **The trend chart is one lens.** Every point on a trend line is scored under the *same, currently active* profile. Never mix.

**Optional accelerator** (add only if the read path gets slow): per scan, store `Σ base×churn` and `Σ base×churn×risk` for each `(category, source)` group — at most 10 groups. Because the profile factors are constant within a group and `risk_factor = 1 + ml_trust × risk` splits linearly, this re-derives a whole history **exactly** in a few hundred operations. Rebuildable from `FINDING`, so still a cache.

Full rationale in [CR-001 D-CR8 – D-CR11](../Change%20Requests/CR-001_2026-07-30_scoring-model-and-finding-ux.md); normative in SRS FR-21 and DB-8.

---

## 4. When database work actually starts

| Milestone | DB work |
|---|---|
| Frontend Phases 8–11 | none — MSW only |
| Backend kickoff (`apps/api`) | first migration: full SAD §9 schema **with** `workspace_id` everywhere; enum values per **D-1**; `SCAN` insert-only per **D-2** |
| Before go-live | enable RLS policies; add indexes (e.g. `repo_id, branch, scanned_at`) |
| Frontend Phase 12 | flip `NEXT_PUBLIC_API_MOCKING` off, point `lib/api/client.ts` at the real base URL — no component or test rewrites |

---

*Decisions recorded 2026-07-25; D-3 and the append-only clarification added 2026-07-27; **D-4 added and D-1 amended 2026-07-30 ([CR-001](../Change%20Requests/CR-001_2026-07-30_scoring-model-and-finding-ux.md)); D-5 added 2026-07-31 ([CR-001 D-CR8 – D-CR11](../Change%20Requests/CR-001_2026-07-30_scoring-model-and-finding-ux.md)); `WORKSPACE.active_profile_id` added to D-4 on 2026-08-01** (SRS FR-20 apply semantics — a schema addition, not a decision change); **that `active_profile_id` addition was reversed on 2026-08-16 in favour of `SCORING_PROFILE.is_active` under a partial unique index (locked decision 11), and profiles were settled as unversioned — see the SUPERSEDED banner in D-4.** Any change to D-1 through D-5 is a PR both sides review — the contract is the agreement.*
