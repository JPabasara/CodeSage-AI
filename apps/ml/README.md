# apps/ml — the ML inference service

Two models behind one small HTTP surface: the SATD comment classifier (**ML-1**) and
the per-file bug-proneness model (**ML-2**).

**This is a service, not a library.** It runs as its own container on `:8001`, holds no
database, and is called **only by the Celery worker** over the private network — never
by the API process. Both models live in this one container, which is why they are
reachable or unreachable together.

**Feature extraction does not live here.** CK, Tree-sitter and PyDriller run in the
worker (`apps/api`). This service receives comments and metric vectors and returns
labels and scores.

| Endpoint | Model | In → out |
|---|---|---|
| `POST /classify` | ML-1 | a batch of comments → `is_debt` + one of four categories |
| `POST /risk` | ML-2 | per-file metric vectors → `risk_score` 0–1 |
| `GET /version` | — | the deployed model versions, recorded against every scan |
| `GET /healthz` | — | liveness |

`security` is **never predicted** — it is not in the training data and only the rule
engine emits it. Neither model assigns **severity**; that comes from the rule register
and the SATD marker table.

## Layout

```
apps/ml/
├── src/codesage_ml/   # the inference service (FastAPI)
│   ├── main.py        #   the four endpoints
│   ├── registry.py    #   loads versioned artifacts at startup
│   ├── schemas.py     #   request/response shapes
│   ├── satd/          #   ML-1 label mapping
│   └── risk/          #   ML-2 feature ordering — must match training exactly
├── training/          # OFFLINE. Never deployed; the Dockerfile omits these deps.
├── notebooks/         # exploration & training notebooks
├── models/            # trained artifacts (*.pkl) — NOT committed, MOUNTED at runtime
└── data/              # datasets — NOT committed (see data/README.md + .gitignore)
    ├── raw/           #   original downloads, immutable
    ├── interim/       #   cleaned / intermediate transforms
    ├── processed/     #   final train / test-ready tables
    └── external/      #   third-party sources kept as-is
```

<<<<<<< Updated upstream
**Raw data and model artifacts are git-ignored on purpose** (size + license).
=======
<<<<<<< Updated upstream
**Raw data and model artifacts are git-ignored on purpose** (size + license). 
=======
**Raw data and model artifacts are git-ignored on purpose** (size + licence).

**Artifacts are mounted, not baked in.** `infra/docker-compose.yml` mounts
`./models` at `/models` read-only, so replacing a model is *drop the file, restart* —
no rebuild and no application change.

## Training data

| Model | Dataset | Notes |
|---|---|---|
| ML-1 SATD | **SATDAUG** | 68,514 labelled comments. Four predictable categories: `code-design`, `requirement`, `documentation`, `test`. **No `defect` label** — that category was removed from the product because SATDAUG does not carry it. |
| ML-2 risk | **D'Ambros** | Bug-prediction dataset. Features are CK product metrics + the four PyDriller process metrics. |

Training runs offline and produces artifacts. The deployed service only ever infers —
it cannot train, by construction.

## Degraded mode

If this container is down the scan **still completes and still stores a valid
snapshot**: every rule and security finding is present, no SATD findings appear, and
every `risk_score` is `0.0` — which makes `risk_factor = 1 + ml_trust × 0 = 1.0`, so no
finding receives a risk boost. Less information, not a failure.

That degradation is the reason this is a separate container at all: across a network
boundary "unavailable" is a *mode* the pipeline handles, where in-process it would be
an exception that takes the worker down with it.
>>>>>>> Stashed changes
>>>>>>> Stashed changes

---

## Calibrating `k` — the one number nobody measures

The two models above produce *facts* (is this comment debt? how bug-prone is this
file?). Turning those into the repo's 0–100 health score needs one extra constant:

```
repo_health = 100 × (1 − min(1, Σ file_debt / (k × KLOC)))
```

Everything else in the scoring formula is measured from the code or set by the user
on the Profiles page. `k` is neither — it is chosen, and choosing it is a task that
belongs here rather than in the API.

### What `k` means

`Σ file_debt` is a pile of internal points — a Critical finding is worth 8 because we
decided so in the rule register, not because 8 is a fact. Two steps make that usable:

1. **Divide by KLOC** → debt *density*, so a 100k-line repo isn't penalised for merely
   being large. You now compare like with like.
2. **Divide by `k`** → a 0–1 fraction that becomes the score.

> **`k` = the debt-per-1000-lines at which health hits 0.**

At `k = 100`: density 12 → health 88 (A) · density 40 → 60 (C) · density 95 → 5 (E).

### Why it must be calibrated, not guessed

A wrong `k` doesn't crash or throw — it produces perfectly formatted, useless grades:

- **`k` too small** → the ratio exceeds 1, `min()` clamps it → **everything is E**.
- **`k` too large** → the ratio is near 0 → **everything is A**.

Both are as informative as no score at all, and neither looks like a bug.

### The procedure

Pick a handful of **golden repositories** — repos you have an opinion about *before*
you measure them. Scan each under the **Balanced** profile (all weights 1.0 — the
neutral scale), record `D = Σ file_debt / KLOC`, then solve for the `k` that lands
them where your judgement says they belong.

| Golden repo | Expected before measuring | Measured `D` |
|---|---|---|
| clean, well-maintained library | ≈ A (88) | 12 |
| typical working app | ≈ C (60) | 40 |
| known legacy mess | E | 95 |

Anchor on one, then check the rest fall out:

```
88 = 100 × (1 − 12/k)  →  0.12 = 12/k  →  k = 100

typical app:  100 × (1 − 40/100) = 60  → C ✓
legacy mess:  100 × (1 − 95/100) =  5  → E ✓
```

`k = 100`. That is the whole method — a **sanity check against human judgement**, not
a fit or an optimisation. The golden repos are the answer key.

**If the numbers won't reconcile** — if the anchor gives a `k` that grades the legacy
repo a B — the problem is upstream, not in `k`. Look at base points, or a rule firing
far more often than expected. Do not keep hunting for a `k` that hides it.

### Four rules

- **Calibrate under Balanced.** Presets and custom sliders change the debt scale; `k`
  is fitted to the neutral one. This is also *why* category weights are clamped to
  0.1–3.0 — an unclamped weight would push debt outside the range `k` was fitted for.
- **`k` re-grades all history when it changes.** Scores are derived on read, never
  stored ([CR-001 D-CR9](../../docs/Change%20Requests/CR-001_2026-07-30_scoring-model-and-finding-ux.md)),
  so a new `k` silently moves every point on every trend chart — on a day nobody
  touched the code. That is the same failure D-CR8 rejected for profiles. Version it
  deliberately; don't tune it casually.
- **It is per-language-ish.** A `k` fitted on Python golden repos is not automatically
  right for JavaScript. Same reason new languages need per-language rules.
- ⚠️ **The current value is invalid.** CR-001 removed an additive risk term and added a
  multiplier of up to 2.5×, so `file_debt` changed scale. **Recalibrate before quoting
  any health score** — including in the report or the viva.

> ✍️ **TEAM TODO:** the golden repositories are referenced across the docs but never
> named. Pick them, record them here with their measured `D`, and commit the chosen
> `k` alongside — a calibration nobody can reproduce is not a calibration.
