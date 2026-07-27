# Code Sage AI — Release Roadmap (feature scope by version)

**Group 16 · PID 7 · CS3203 · draft v0.1 · 22 Jul 2026**
*Companion to the [Project Proposal], the [Feasibility Report], the [Backend Analysis Engine doc](./code-sage_backend-analysis-engine.md), and the [Frontend plans](./frontend_prototype_plan.md). It sequences the full product vision into releases — **core features first** (risks R2 "underestimated time" + R7 "scope drift" both prescribe this) — so the SRS can tag every functional requirement with the release it belongs to.*

> **Status:** DRAFT for team review. The version split below is a recommendation; confirm it before we freeze the SRS. Open decisions are listed at the bottom.

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
- **Extraction:** Lizard metrics + PyDriller process metrics + **source comments at the scanned SHA**.
- **Detection:** rule engine (code/design rules **+ security patterns**: hardcoded secrets, SQL concat, `eval`/`exec`) + **SATD classifier (ML-1)** + **risk model (ML-2)**.
- **Scoring:** weighted-sum with a **preset profile** (Balanced default), severity base points, churn factor, and the **critical-security visibility floor**.
- **Extraction boundary (normative):** *git history enters the pipeline as aggregated numbers, never as text.* SATD runs on comments only; commit-message text, pull requests and issues are **not** scan inputs; stored snapshots are never model or scoring input. Full rationale in [backend engine §2.1 + §3.2.1](./code-sage_backend-analysis-engine.md) and SRS FR-7.1 / FR-9.1.

**Dashboard — outputs** (all read from stored snapshots — the dashboard *computes nothing*)
- **Overall Health card:** score · grade · delta-since-last-scan · red-issue summary · small **category pie** (debt % by type).
- **Trend chart card:** health per scan/commit over time.
- **Refactor-First list:** rule + SATD findings, severity badges, **one-line template reason**, **filter by debt type**.
- **Finding detail panel:** evidence + one-line reason (**view-only** in v1 — see decision D3).
- **Hotspot file tree:** heat-map red→green by per-file debt, drill-in, colour coding on expand.

**History**
- Every scan is stored as an **immutable snapshot** (this is what makes trend, delta, history, and "skip scan if unchanged" possible — see the stateful/stateless note the team agreed).
- **Scan history tab:** list past snapshots; click one to load it into the dashboard.

**Scoring profiles**
- **Select a preset** profile (Balanced / Security-first / Delivery-speed). Custom sliders → v1.1.

**Non-functional (v1 floor)**
- Responsive to laptop width, keyboard-navigable, readable severity/heat-map contrast; HTTPS; least-privilege repo read.

**Languages validated:** Python + JavaScript/TypeScript (dogfood by scanning Code Sage itself).

**Account menu (bottom of rail):** logout (settings/billing stubbed).

---

## 3. v1.1 — Depth · *"make each screen richer and interactive"*

- **Private repos** via **GitHub App** installation (least-privilege, user picks which repos — auto-adds like SonarQube).
- **Profile customization:** sliders for `category_weight`s + `w_ml`, plus **reset to preset**.
- **Finding actions:** **Accept debt** (suppress from score), **Resolve**, **False-positive** — captured and stored (these signals become future ML training labels).
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
| Private repos (GitHub App) | | ✅ | ✅ | Team |
| Custom profile sliders | | ✅ | ✅ | Free/Team |
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
- **D3 — Finding actions in v1.0.** View-only, or include **Accept-debt** suppression (scoring already supports it)?
- **D4 — Doc locations.** SRS/SDD in `docs/Deliverables/` (next to the PDFs) vs `docs/Project Management & Planning/`.
- **D5 — SATD category enum.** *(still open)* Confirm the debt-category values against the **Li SATD dataset** label column (backend §3.2: SRS categories **must equal** the dataset labels) — needs a peek at the CSV.

### 7.1 Closed decisions

- **D6 — Churn window anchoring.** ✅ **DECIDED 2026-07-27: anchor to the last commit, not to `now()`.**
  The 90-day churn window runs **backwards from the committer date of the scanned commit** (the branch's last commit — the same SHA shown in the top nav), i.e. the window is `[commit_date − 90d, commit_date]`. Wall-clock `now()` is **not** used anywhere in scoring.
  *Why:* re-scanning the same SHA then reproduces the same score, so stored scores stay comparable across the trend chart and FR-6's skip-if-unchanged ("same SHA ⇒ reuse snapshot") is provably correct. Anchoring to `now()` would have made an unchanged repository drift in score purely with the passage of time.
  Normative in **SRS FR-11**; see [backend engine §2.1/§6](./code-sage_backend-analysis-engine.md), SAD §6.1, and [data-model-decisions D-3](./data-model-decisions.md).
