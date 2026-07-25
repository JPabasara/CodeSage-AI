# Datasets

⚠️ **Raw datasets are git-ignored** (repo size + license).

| Dataset | Used by | Labels / target | Put in | License (verify before use) |
|---|---|---|---|---|
| **Li SATD dataset** (Li, Soliman & Avgeriou 2023, *"SATD from four sources"*) | SATD classifier (ML-1) | comment/commit → *is-debt?* + **category**: `code/design`, `requirement`, `documentation`, `test` | `data/raw/satd-li/` | research use — confirm terms |
| **GHPR** (Xu, Wang & Ai 2021) | Risk model (ML-2) — **primary** | file → `defective` / `clean` (from real bug-fixing PRs) | `data/raw/ghpr/` | confirm terms |
| **The Technical Debt Dataset** (Lenarduzzi, Saarimäki & Taibi 2019, *clowee*) | Risk model (ML-2) — SZZ defect labels / SonarQube issues | commit/file defect signals | `data/raw/td-dataset/` | **CC BY-NC-SA 4.0** (non-commercial) |
| **NASA PROMISE** (KC1 / JM1 / …) | Risk model — **legacy baseline only** | module → `defective` / `clean` | `data/raw/promise/` | public; cite honestly as legacy (known data-quality issues) |

