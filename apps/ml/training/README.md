# Training bench — offline only

**Nothing here ships in the inference image.** Training is performed offline and
the deployed service only performs inference, which is what keeps runtime
performance stable and predictions reproducible (SRS AI-05).

```
training/
├── satd/            ML-1 — SATD classifier
│   ├── train.py     TF-IDF → linear classifier over SATDAUG
│   └── evaluate.py  per-class precision / recall / F1 + support
├── risk/            ML-2 — bug-proneness
│   ├── train.py     tree ensemble over CK + PyDriller features
│   └── evaluate.py  precision / recall / F1 / AUC — never accuracy
└── reports/         the FR-25 evaluation artifacts
```

## Datasets

Both are offline. They are downloaded once per training artifact, and **no dataset
and no external API is contacted during a scan** (SRS Table 3.106 note).

| Model | Dataset | Used for |
|---|---|---|
| ML-1 | **SATDAUG** — `data-augmentation-code_comments.csv`, 68,514 labelled comments | training, validation, evaluation |
| ML-2 | **D'Ambros defect dataset** | training and the FR-25 evaluation |

v1.0 trains, validates and evaluates ML-1 on the **comments file only**. Commit
messages, issues and pull requests are not used — not even for training. Training
and inference then share one distribution, so held-out comments are a real test
set.

## Evaluation rules (SRS FR-25)

These are requirements, not preferences:

- **Report per class, with support counts.** The debt/not-debt split is heavily
  imbalanced and so is the split between categories. A single macro- or
  weighted-average figure would conceal poor performance on the smaller classes.
- **Never quote accuracy**, for either model. With rare positives, a model that
  predicts "clean" every time scores well and is useless.
- **The baseline is the deterministic rule engine**, not a published paper. Figures
  from the literature cover different tasks on different data and are context, not
  a benchmark.
- ML-2 additionally reports **AUC**.

## Provenance

Every artifact produced here must be registered in `ML_MODEL_VERSION` with its
type, version, training date, dataset reference and evaluation metrics (DBR-17).
The worker records that version against every analysis attempt, which is what
keeps trend points comparable across a retraining.

**TEAM TODO:** confirm and record the licence of both datasets before training
artifacts are distributed.
