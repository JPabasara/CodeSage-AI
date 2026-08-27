import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, roc_auc_score
from sklearn.model_selection import GroupShuffleSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

# Ensure codesage_ml is importable so we can use canonical FEATURE_ORDER
current_dir = Path(__file__).resolve().parent
ml_src = current_dir.parent.parent / "src"
if str(ml_src) not in sys.path:
    sys.path.insert(0, str(ml_src))

from codesage_ml.risk.features import FEATURE_ORDER, build_vector


def main():
    print("=" * 60)
    print("CodeSage AI — ML-2 Bug-Proneness Model Training Pipeline")
    print("=" * 60)

    # Step 1: Load the benchmark defect dataset
    dataset_path = current_dir.parent.parent / "data" / "raw" / "defect_dataset.csv"
    if not dataset_path.exists():
        raise FileNotFoundError(f"Defect dataset not found at {dataset_path}")

    print(f"\n[Step 1/6] Loading defect dataset from {dataset_path.name}...")
    df = pd.read_csv(dataset_path)
    print(f"  -> Total instances: {len(df):,} classes across {df['project_name'].nunique()} projects.")

    # Target variable: binary defect status (1 = Buggy/Defective, 0 = Clean)
    df["is_defective"] = (df["bug"] > 0).astype(int)
    imbalance = df["is_defective"].value_counts(normalize=True).to_dict()
    print(f"  -> Class balance: {imbalance[0]:.1%} Clean (0) vs {imbalance[1]:.1%} Defective (1)")

    # Step 2: Build the 13-feature matrix matching canonical FEATURE_ORDER
    print(f"\n[Step 2/6] Assembling {len(FEATURE_ORDER)}-feature matrix according to canonical order...")
    # Map dataset column names to canonical features
    feature_rows = []
    for _, row in df.iterrows():
        metrics = {
            "wmc": float(row.get("wmc", 0.0)),
            "cbo": float(row.get("cbo", 0.0)),
            "dit": float(row.get("dit", 0.0)),
            "lcom": float(row.get("lcom", 0.0)),
            "rfc": float(row.get("rfc", 0.0)),
            "noc": float(row.get("noc", 0.0)),
            "loc": float(row.get("loc", 0.0)),
            "max_nested_blocks": float(row.get("max_cc", 0.0)),
            "comment_ratio": 0.0,
            "commits_90d": float(row.get("npm", 0.0)),  # Historical proxy
            "author_count": float(row.get("ca", 0.0)),   # Afferent coupling proxy
            "file_age_days": 180.0,
            "recency_days": 10.0,
        }
        feature_rows.append(build_vector(metrics))

    X = np.array(feature_rows)
    y = df["is_defective"].to_numpy()
    groups = df["project_name"].to_numpy()

    # Step 3: GroupShuffleSplit by project to prevent data leakage across train/test
    print("\n[Step 3/6] Splitting projects with GroupShuffleSplit (preventing cross-project leakage)...")
    gss = GroupShuffleSplit(n_splits=1, train_size=0.8, random_state=42)
    train_idx, test_idx = next(gss.split(X, y, groups=groups))

    X_train, X_test = X[train_idx], X[test_idx]
    y_train, y_test = y[train_idx], y[test_idx]
    train_projects = sorted(set(groups[train_idx]))
    test_projects = sorted(set(groups[test_idx]))

    print(f"  -> Training projects ({len(train_projects)}): {', '.join(train_projects)} ({len(X_train):,} classes)")
    print(f"  -> Testing projects  ({len(test_projects)}): {', '.join(test_projects)} ({len(X_test):,} classes)")

    # Step 4: Build Model Pipeline (StandardScaler + RandomForest with class balancing)
    print("\n[Step 4/6] Building Random Forest Classifier pipeline...")
    clf = RandomForestClassifier(
        n_estimators=150,
        max_depth=12,
        min_samples_split=4,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
    )

    pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("clf", clf),
    ])

    # Step 5: Fit model and evaluate on unseen held-out projects
    print("\n[Step 5/6] Training pipeline...")
    t0 = time.time()
    pipeline.fit(X_train, y_train)
    elapsed = time.time() - t0
    print(f"  -> Training completed in {elapsed:.2f}s")

    y_pred = pipeline.predict(X_test)
    y_prob = pipeline.predict_proba(X_test)[:, 1]
    roc_auc = roc_auc_score(y_test, y_prob)

    print("\n" + "=" * 60)
    print("HONEST EVALUATION ON UNSEEN HELD-OUT PROJECTS")
    print("=" * 60)
    print(classification_report(y_test, y_pred, target_names=["Clean (0)", "Defective (1)"]))
    print(f"ROC-AUC Score: {roc_auc:.4f}")

    # Step 6: Export versioned artifact
    print("\n[Step 6/6] Exporting versioned production artifact...")
    models_dir = current_dir.parent.parent / "models"
    models_dir.mkdir(exist_ok=True)
    model_path = models_dir / "risk_v1.joblib"

    artifact = {
        "pipeline": pipeline,
        "version": "risk-1.0.0",
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "sklearn_version": sklearn.__version__,
        "feature_order": list(FEATURE_ORDER),
        "metrics": {
            "roc_auc": float(roc_auc),
            "train_projects": train_projects,
            "test_projects": test_projects,
        },
    }

    joblib.dump(artifact, model_path)
    print(f"  -> Successfully saved model artifact to: {model_path}")
    print(f"  -> Version: risk-1.0.0")
    print("=" * 60)


if __name__ == "__main__":
    main()
