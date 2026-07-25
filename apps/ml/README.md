# apps/ml — Machine Learning & Analysis

The SATD classifier (**ML-1**) and the bug-proneness risk model (**ML-2**), plus the
Lizard / PyDriller feature extraction that feeds them.

## Layout

```
apps/ml/
├── data/            # datasets — NOT committed (see data/README.md + .gitignore)
│   ├── raw/         # original downloads, immutable  ← put dataset CSVs / .db here
│   ├── interim/     # cleaned / intermediate transforms
│   ├── processed/   # final train / test-ready tables
│   └── external/    # third-party sources kept as-is
├── models/          # trained artifacts (*.pkl) — NOT committed
├── notebooks/       # exploration & training notebooks
└── src/             # reusable pipeline code (extract, features, train, infer)
```

**Raw data and model artifacts are git-ignored on purpose** (size + license). 
