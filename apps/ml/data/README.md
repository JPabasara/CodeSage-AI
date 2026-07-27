# Datasets

⚠️ **Raw datasets are git-ignored** (repo size + license).

> **These are training-bench artefacts only.** Nothing here is read at scan time — the runtime pipeline works entirely off a local `git clone` and contacts no dataset and no external API. In particular **GHPR** expands to *GitHub Pull Request* but is an offline CSV; it does **not** mean the system ingests pull requests. See SRS FR-7.1 (extraction boundary).

| Dataset | Used by | Labels / target | Put in | License (verify before use) |
|---|---|---|---|---|
| **Li SATD dataset** (Li, Soliman & Avgeriou 2023, *"SATD from four sources"*) | SATD classifier (ML-1) | text → *is-debt?* + **category**: `code/design`, `requirement`, `documentation`, `test` | `data/raw/satd-li/` | research use — confirm terms |
| **GHPR** (Xu, Wang & Ai 2021) | Risk model (ML-2) — **primary** | file → `defective` / `clean` (from real bug-fixing PRs) | `data/raw/ghpr/` | confirm terms |
| **The Technical Debt Dataset** (Lenarduzzi, Saarimäki & Taibi 2019, *clowee*) | Risk model (ML-2) — SZZ defect labels / SonarQube issues | commit/file defect signals | `data/raw/td-dataset/` | **CC BY-NC-SA 4.0** (non-commercial) |
| **NASA PROMISE** (KC1 / JM1 / …) | Risk model — **legacy baseline only** | module → `defective` / `clean` | `data/raw/promise/` | public; cite honestly as legacy (known data-quality issues) |

## Training corpus ≠ inference input (ML-1)

The Li corpus covers four sources — comments, commit messages, issues, pull requests. That describes the **labelled text available for training**, not what the deployed model consumes.

- **Train** on the corpus (all four sources permitted if the extra data helps).
- **Evaluate on held-out *comments***, because comments are the only distribution the deployed classifier sees.
- **At inference, ML-1 receives source-code comments from the scanned snapshot only.** Commit-message SATD is excluded from v1.0: no `file:line` anchor, no resolution signal, and it would accumulate monotonically and corrupt the health trend. Rationale in SRS FR-9.1 and the backend engine doc §3.2.1.

**ML-2 feature vector** (same at train and inference): Lizard product metrics (CCN, NLOC, nesting, params, comment ratio) + the four PyDriller process metrics (churn, author count, file age, recency). History is consumed as **numbers only** — never as text.

