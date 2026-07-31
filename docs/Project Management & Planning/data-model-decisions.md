# Code Sage AI — Data-model decisions (DB · multi-tenancy · RLS)

**Status:** decided · **Scope:** v1.0 → v2 seam · **Audience:** frontend + backend
**Companions:** [release-roadmap.md](./release-roadmap.md) · [code-sage_backend-analysis-engine.md](./code-sage_backend-analysis-engine.md) · SRS §3.10 (DB-1/DB-2, S-3) · SAD §9 (Data View / ER diagram)

Why this file exists: the schema decisions were scattered across the SRS, the SAD and a chat thread. They are cheap to honour on day one and expensive to retrofit, so they live in one place the backend can read before writing the first migration.

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

The known conflict: the contract says **`code-design`**, the SATD dataset label is **`code/design`**. This is already flagged at [`types/index.ts:11-13`](../../apps/web/src/lib/types/index.ts#L11-L13).

- Pick one exact spelling for every enum value, on both sides, in one sitting.
- Changing it afterwards = data migration **+** frontend change **+** re-running every fixture.

**`Severity` and `Category` are written once, by the detector.** Both are set at detection from the rule register (SRS Appendix C) — SATD rows get `category` from ML-1 and `severity` from the comment-marker table (SRS FR-9.2, Appendix C.2); ML-2 writes no finding row. No later process updates these columns: scoring reads `severity` as a lookup into base points, the client reads it to draw a badge, and neither writes. **No user setting writes them either** — `SCORE_PROFILE` carries weights only (D-4). So these two enums are **backend-authored, frontend-rendered** — which is exactly why their spellings must be frozen before the first migration. Normative in SRS **FR-8.1**.

**`Source` is now two values — `rule | satd`** ([CR-001](../Change%20Requests/CR-001_2026-07-30_scoring-model-and-finding-ux.md) D-CR3). The former `security` value duplicated `category` exactly — security patterns run inside the rule engine, so such a finding was always `source = security` **and** `category = security` — and `ml-risk` was unreachable, because the risk model writes `FILE_SCORE.risk_score` and never a `FINDING` row. Constrain the column to the two values in the first migration: a `CHECK` that still permits four will silently admit rows the frontend can no longer explain. Normative in SRS **FR-8.2**.

> ✍️ **TEAM TODO:** confirm the `Category` values against the SATD dataset CSV, then mark the contract frozen. **Still open — this is the last item blocking the first migration.**

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
  weights   jsonb    -- keyed by the five CATEGORY values:
                     -- security · code-design · requirement · documentation · test
                     -- each clamped 0.1 – 3.0
  trust_s   numeric  -- 0.0 – 1.0, default 0.5 — the rules ←→ model slider
  is_preset bool
}
```

Three things the backend must honour:

- **`weights` is keyed by `category`, and by nothing else.** The previous vector mixed axes — it carried `satd` (a *source*) and `duplication` (a *rule*) while omitting `requirement`, `documentation` and `test` entirely, so a documentation-category SATD finding had no defined weight. Since v1.0 exposes these as user-facing sliders, a key that does not correspond to a category is a control the user can drag with no effect.
- **`w_ml` is gone**, replaced by `trust_s`. If a migration or seed script still writes `w_ml`, scoring will silently read a default.
- **No severity column, ever.** Severity is detector-authored (D-1). A profile that could write severity would defeat the visibility floor (SRS FR-24).

Seed the three presets as rows with `is_preset = true`; they are the values the sliders reset to, and **Balanced** is the default profile for every new workspace.

---

## 3. RLS — the one rule for the first migration

**Put `workspace_id` on every tenant-scoped table in the very first migration**, even while the policies are still off and every row holds the same value.

- Turning RLS **on** later = one migration.
- Retrofitting the **column** into ~8 tables that already hold data — and fixing every query that forgot to filter by it — is the expensive version.

That is exactly what "secure multi-tenant foundation in v1.0" ([release-roadmap.md](./release-roadmap.md), Objective 2) means in practice, and it costs nothing on day one. Tenant-scoped tables per SAD §9: `REPO`, `SCAN`, `FINDING`, `FILE_SCORE`, `SCORE_PROFILE`, `SUPPRESSION`, `MEMBERSHIP`, `BRANCH` (via `repo_id`).

### What the frontend must **not** build

No workspace picker, and **nothing that sends `workspace_id` from the browser**. Under RLS the tenant is derived from the session/token **server-side** and is never trusted from the client. This is precisely why `Repo.workspaceId` is optional and unused in v1 — that is correct as-is and should stay that way until v2 collaboration lands.

---

## 4. When database work actually starts

| Milestone | DB work |
|---|---|
| Frontend Phases 8–11 | none — MSW only |
| Backend kickoff (`apps/api`) | first migration: full SAD §9 schema **with** `workspace_id` everywhere; enum values per **D-1**; `SCAN` insert-only per **D-2** |
| Before go-live | enable RLS policies; add indexes (e.g. `repo_id, branch, scanned_at`) |
| Frontend Phase 12 | flip `NEXT_PUBLIC_API_MOCKING` off, point `lib/api/client.ts` at the real base URL — no component or test rewrites |

---

*Decisions recorded 2026-07-25; D-3 and the append-only clarification added 2026-07-27; **D-4 added and D-1 amended 2026-07-30 ([CR-001](../Change%20Requests/CR-001_2026-07-30_scoring-model-and-finding-ux.md))**. Any change to D-1 through D-4 is a PR both sides review — the contract is the agreement.*
