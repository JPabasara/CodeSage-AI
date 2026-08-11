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

## Setup & Running Tasks

### 1. Start Redis
Make sure Redis is running. You can easily start it via Docker Compose from the project root:
```bash
docker compose up -d
```

### 2. Install Dependencies
Install the required packages in your virtual environment:
```bash
pip install -r requirements.txt
```

### 3. Run Celery Worker
Start the Celery worker (use `--pool=solo` on Windows):
```bash
cd src
celery -A tasks worker --loglevel=info --pool=solo
```

### 4. Trigger the Task
Run the trigger script to enqueue a job and monitor progress:
```bash
python trigger.py
```

