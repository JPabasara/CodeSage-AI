# Code Sage AI — Release Roadmap (feature scope by version)

**Group 16 · PID 7 · CS3203 · draft v0.1 · 22 Jul 2026**
*Companion to the [Project Proposal], the [Feasibility Report], the [Backend Analysis Engine doc](./code-sage_backend-analysis-engine.md), and the [Frontend plans](./frontend_prototype_plan.md). It sequences the full product vision into releases — **core features first** (risks R2 "underestimated time" + R7 "scope drift" both prescribe this) — so the SRS can tag every functional requirement with the release it belongs to.*

> **Status:** DRAFT for team review. The version split below is a recommendation; confirm it before we freeze the SRS. Open decisions are listed at the bottom.

> ## Decision log — reversals after this document was written
>
> **D5 (debt-category taxonomy) was reopened and re-closed on 9 Aug 2026.**
> It had closed at **six** categories including `defect`. The corpus then changed from
> Li et al. to **SATDAUG**, which carries **no `defect_debt` label** — so ML-1 cannot
> predict that category and it cannot exist in the product. The taxonomy is now
> **five**: `code-design`, `requirement`, `documentation`, `test`, `security`.
> Consequence: the scoring profile is **five weights + one trust slider = six numbers**.
>
> **Four further reversals (12 Aug 2026)**, all recorded in
> [the work plan and locked decisions](work-plan-and-locked-decisions-after-progress-eval.md):
> Lizard → **CK** (Java only) · GHPR → **D'Ambros** · GitHub OAuth → **Asgardeo**
> with GitHub federated · the wire is **snake_case**.
>
> **Settled 15 Aug 2026, in SRS v1.1 and SAD v1.1.** The identity change is bigger
> than "use a different provider". The **API is the Backend-for-Frontend**: it runs
> the whole sign-in exchange, keeps the identity tokens, and gives the browser only
> an httpOnly session cookie. Sessions are server-side rows, so sign-out revokes
> immediately. Four security requirements now state this (SRS SEC-17 to SEC-20), and
> SAD §6.4 describes the exchange. A short-lived attempt to run Asgardeo inside
> Next.js was **rejected**: it protected the pages while leaving the API open.
>
> All six reversals are recorded in the **v1.1 revision-history rows of the SRS and
> SAD themselves**, which is where a marker will look. A separate CR-002 document is
> therefore not being written — see "Not doing" in
> [the work plan and locked decisions](work-plan-and-locked-decisions-after-progress-eval.md).

---

## 0. Two lenses — never confuse them

| Lens | Where it's written | What it means |
|---|---|---|
| **Product-release scope** | this doc + the **SRS** | What the real SaaS delivers in each version — includes backend, ML, multi-tenancy, billing. |
| **Prototype-build scope** | [frontend_build_stepbystep.md](./frontend_build_stepbystep.md) | What the **frontend prototype** builds *now*, against mock data. The prototype **is** v1's GUI, built ahead of the backend. |

A feature can be **"v1 product"** yet **"mocked in the current prototype"** (e.g. GitHub OAuth, real scans). The prototype swaps mock → real when the backend endpoint ships — no rewrite, because both honour the same [data contract](./frontend_prototype_plan.md). Keep the two lenses in separate columns in your head.

---

## 1. Objectives → releases

| # | Proposal objective | Primarily realized in |
|---|---|---|
| 1 | Analyze impact of technical debt on team velocity | Cross-cutting → validated in the **final report** (v1 is the instrument that measures it) |
| 2 | Secure **multi-tenant** web architecture | **Foundation in v1.0** (workspace = tenant + Postgres RLS); full multi-user in **v2.0** |
| 3 | Centralized interactive **dashboard** | **v1.0** (the whole demoable slice) |
| 4 | NLP **SATD classifier** (comments/commits → debt category) | **v1.0** (ML-1) |
| 5 | Evaluate **ML bug-prediction vs rule baseline** | Risk model built **v1.0** (ML-2); formal precision/recall/F1 evaluation in the **Sep testing phase** → report |

---

## 2. v1.0 — MVP · *"one user, one public repo, scan on demand, read a clean report"*

**Why this is the whole of v1:** it's a complete **vertical slice** — a single journey that exercises every layer (connect → extract → detect → score → persist → visualize). Getting one thread fully working end-to-end is worth more than many half-features (risk R2). Maps to the **Free tier** (public repos, single workspace).

**Auth & tenancy**
- GitHub **sign-in** (mocked in the prototype → real OAuth in the product).
- A **workspace** (tenant) with exactly **one member = the owner**. Multi-tenant DB seam (workspace_id + RLS) is baked in now even though it holds one user — so v2 collaboration bolts on with no rewrite.

**Connect & select project** (1 repo = 1 project in v1)
- Add a project by **pasting a public repo URL**.
- **Projects list** (vertical) with a health hint; a **Select** action sets the active project, shown by repo name in the **top nav**.

**Dashboard — scan**
- **Branch selector** (default branch preselected; switching re-scopes the snapshot).
- **Scan button** state machine: `idle → running(%) → done`, with a **Stop**; runs on an **async worker** (Celery) that clones + runs the pipeline. **Per-branch snapshot, on demand only** (no silent/auto scans in v1).
- Top-nav right: **last analyzed time + last commit SHA**.

**Dashboard — analysis pipeline** (backend)
- **Extraction:** CK metrics (Java only) + PyDriller process metrics + **source comments at the scanned SHA**, extracted with Tree-sitter.
- **Detection:** rule engine (code/design rules **+ security patterns**: hardcoded secrets, SQL concat, `eval`/`exec`) + **SATD classifier (ML-1)** + **risk model (ML-2)**. Every finding carries a `source` (`rule | satd` — the only two producers), a `category`, and a **`severity` assigned at detection**: from the rule register for rule findings, from the comment-marker table for SATD findings. No model and no user ever sets a severity.
- **Scoring:** weighted-sum over `base_points × category_weight × source_trust × churn_factor × risk_factor`, with the **critical-security visibility floor**. The risk score enters as a bounded multiplier on the findings in that file — it adds no separate term and creates no debt on its own.
- **Profiles:** three **presets** (Balanced default / Security-first / Delivery-speed) **plus custom sliders** — five category weights and one rules ↔ model trust slider, with reset-to-preset. *(Sliders pulled forward from v1.1 by [CR-001](../Change%20Requests/CR-001_2026-07-30_scoring-model-and-finding-ux.md).)*
- **Extraction boundary (normative):** *git history enters the pipeline as aggregated numbers, never as text.* SATD runs on comments only; commit-message text, pull requests and issues are **not** scan inputs; stored snapshots are never model or scoring input. Full rationale in [backend engine §2.1 + §3.2.1](./code-sage_backend-analysis-engine.md) and SRS FR-7.1 / FR-9.1.

**Dashboard — outputs** (all read from stored snapshots — the dashboard *computes nothing*)
- **Overall Health card:** score · grade · delta-since-last-scan · red-issue summary · small **category pie** (debt % by type).
- **Trend chart card:** health per scan/commit over time.
- **Refactor-First list:** rule + SATD findings, severity badges, **one-line template reason**, **filter by debt type**.
- **Finding detail — in place, not an overlay:** selecting a finding replaces the health card + trend chart region with the finding's evidence and one-line reason, the file tree **auto-expands and highlights** that file, and the Refactor-First list condenses to a strip for moving between findings. Closing restores the cards. **View-only** in v1 (see decision D3).
- **Hotspot file tree:** heat-map red→green by per-file debt, per-file risk badge, drill-in, colour coding on expand.

**History**
- Every scan is stored as an **immutable snapshot** (this is what makes trend, delta, history, and "skip scan if unchanged" possible — see the stateful/stateless note the team agreed).
- **Scan history tab:** list past snapshots; click one to load it into the dashboard.

**Scoring profiles**
- **Select a preset** (Balanced / Security-first / Delivery-speed) **and adjust it**: six category weight sliders (clamped 0.1–3.0) + one rules ↔ model trust slider + reset-to-preset. Presets seed the sliders; every change re-scores instantly with no re-scan.

**Non-functional (v1 floor)**
- Responsive to laptop width, keyboard-navigable, readable severity/heat-map contrast; HTTPS; least-privilege repo read.

**Languages validated:** Python + JavaScript/TypeScript (dogfood by scanning Code Sage itself).

**Account menu (bottom of rail):** logout (settings/billing stubbed).

---

## 3. v1.1 — Depth · *"make each screen richer and interactive"*

- **Private repos** via **GitHub App** installation (least-privilege, user picks which repos — auto-adds like SonarQube).
- **Finding actions:** **Accept debt** (suppress from score), **Resolve**, **False-positive** — captured and stored (these signals become future ML training labels).
- **Graduated rule severity** — `complex-function` at CCN 45 outranking the same rule at CCN 16 (v1.0 is flat per rule).
- **Split the trust slider** into separate ML-1 and ML-2 dials, if users ask for it (v1.0 uses one dial for both).
- **Snippet-on-demand** in the finding detail panel.
- **Category breakdown** as its own filterable view (`WHERE category = …`).
- Loading / empty / error states + accessibility hardening pass.

---

## 4. v2.0 — Team tier · *"collaboration & automation"* (paid $10/user)

- **Multi-user workspaces / orgs** as real tenants.
- **Team RBAC:** roles **org-admin / manager / developer / viewer**; **invitations**; **auto-shared projects** — a member sees every workspace project without re-connecting (see the RBAC note the team agreed).
- **Multi-repo workspaces** + **workspace rollup** metrics.
- **Cross-repository dependency analytics** (proposal core, deliberately deferred to keep v1 a clean slice).
- **Silent checks:** background scans auto-triggered on push/PR (webhooks / GitHub Actions) → auto-refresh dashboard.
- **GitLab** support.
- **Billing** (Stripe), Team-tier gating.

---

## 5. Future / research (post-release — R7 "future improvements" list)

- **Per-repo calibration** — retrain the risk model on the repo's own bug-fix history (still supervised; risk R3 mitigation).
- **Online / feedback learning** — turn the Accept / False-positive buttons into new training labels.
- **AI fix suggestions** — human-approved code diffs (needs an LLM). *Distinct from the v1 one-line reason, which is a deterministic template.*
- **Card B contextual health** — hover a file/folder → Card B re-scopes to that node.
- **More languages** via per-language security rules + recalibration.
- **CodeBERT** SATD upgrade; periodic model-retraining pipeline (R6).

---

## 6. Feature gate summary (ties to the Feasibility pricing)

| Capability | v1.0 | v1.1 | v2.0 | Tier |
|---|:---:|:---:|:---:|---|
| Public repo by URL | ✅ | ✅ | ✅ | Free |
| Full dashboard + scan history + trend | ✅ | ✅ | ✅ | Free |
| Preset scoring profiles | ✅ | ✅ | ✅ | Free |
| **Custom profile sliders** (5 category weights + trust) | **✅** | ✅ | ✅ | Free |
| Private repos (GitHub App) | | ✅ | ✅ | Team |
| Finding actions (accept/resolve/FP) | | ✅ | ✅ | Free/Team |
| Multi-repo workspace + rollup | | | ✅ | Team |
| Team RBAC + invitations | | | ✅ | Team |
| Silent checks (push/PR auto-scan) | | | ✅ | Team |
| Cross-repo dependency analytics | | | ✅ | Team |
| GitLab | | | ✅ | Team |

---

## 7. Open decisions (confirm before freezing the SRS)

- **D1 — SRS/SDD format.** IEEE-style markdown, a course-mandated template, or lightweight custom?
- **D2 — Version split / RBAC timing.** Is Team/RBAC + private repos + multi-repo + silent checks in **v2.0** correct, or pull RBAC into v1? (Schedule has an Aug 4–9 RBAC phase — that can be the *DB/architecture seam* rather than full UI.)
- **D3 — Finding actions in v1.0.** ✅ **CLOSED 2026-07-30 (CR-001 D-CR7): view-only.** The detail region is built in v1.0; Accept-debt / Resolve / False-positive stay [v1.1].
- **D4 — Doc locations.** SRS/SDD in `docs/Deliverables/` (next to the PDFs) vs `docs/Project Management & Planning/`.

### 7.1 Closed decisions

- **D5 — SATD category enum.** ✅ **CLOSED 2026-07-31** (CR-001 **D-CR12**).
  The taxonomy is fixed by `satd-dataset-code_comments.csv` — the only file v1.0 uses. Six product categories: `code-design`, `requirement`, **`defect`**, `documentation`, `test` (mapped 1:1 from the dataset's `*_debt` labels) plus `security`, which the rule engine emits and no model ever predicts. `non_debt` is the **negative class**, not a category.
  *Three things this settled:* **`defect` is a sixth category** (472 labelled comments — more than `test` and `documentation` combined), so the profile has **six** weight sliders, not five; the four sources use **different taxonomies**, so v1.0 trains *and* infers on the comments file alone; and the dataset licence is **MIT**, not a non-commercial one.
  Normative in **SRS FR-9.3**; see [backend engine §3.2.0](./code-sage_backend-analysis-engine.md) and [data-model-decisions D-1](./data-model-decisions.md).

- **D6 — Churn window anchoring.** ✅ **DECIDED 2026-07-27: anchor to the last commit, not to `now()`.**
  The 90-day churn window runs **backwards from the committer date of the scanned commit** (the branch's last commit — the same SHA shown in the top nav), i.e. the window is `[commit_date − 90d, commit_date]`. Wall-clock `now()` is **not** used anywhere in scoring.
  *Why:* re-scanning the same SHA then reproduces the same score, so stored scores stay comparable across the trend chart and FR-6's skip-if-unchanged ("same SHA ⇒ reuse snapshot") is provably correct. Anchoring to `now()` would have made an unchanged repository drift in score purely with the passage of time.
  Normative in **SRS FR-11**; see [backend engine §2.1/§6](./code-sage_backend-analysis-engine.md), SAD §6.1, and [data-model-decisions D-3](./data-model-decisions.md).

- **D-CR1 … D-CR7 — scoring model, finding labelling and finding-detail UX.** ✅ **DECIDED 2026-07-30** — full rationale in **[CR-001](../Change%20Requests/CR-001_2026-07-30_scoring-model-and-finding-ux.md)**.
  1. **Severity is system-owned**, fixed per rule in the rule register (SRS Appendix C) — never user-set, never ML-predicted.
  2. **SATD severity** comes from a comment-marker regex table (`FIXME` → High, `TODO` → Medium, `NOTE` → Low, no marker → Medium) instead of a flat `Medium`.
  3. **`source` collapses to `rule | satd`** — `security` duplicated the category axis, `ml-risk` was unreachable.
  4. **Profile = 5 category weights + one rules ↔ model trust slider**; `w_ml` removed; the `security` category is excluded from the trust multiplier.
  5. **Risk multiplies** `finding_priority` (bounded 1.0–2.5) and its additive `file_debt` term is **removed** — fixing the contradiction where FR-10 promised a ranking boost the FR-11 formula never delivered.
  6. **Custom sliders move into v1.0**; the three presets are retained as slider seeds.
  7. **Finding detail renders in place** (replacing the health/chart region, with tree highlight and a condensed finding list) rather than as a slide-over.
  ⚠️ **`k` must be recalibrated** — `file_debt` changed scale.
