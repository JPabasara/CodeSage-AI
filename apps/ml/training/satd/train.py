import pandas as pd
from sklearn.model_selection import GroupShuffleSplit
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.svm import LinearSVC
from sklearn.calibration import CalibratedClassifierCV
from sklearn.pipeline import Pipeline
from sklearn.metrics import classification_report
import joblib
import sklearn
import os
import time
from datetime import datetime, timezone

def main():
    print("Loading dataset...")
    df = pd.read_csv('../../data/raw/data-augmentation-code_comments.csv',sep=";")
    
    # Clean any rows that are missing critical text or classification labels
    df = df.dropna(subset=['text', 'classification', 'projectname', 'status'])
    print(f"Total dataset size: {len(df):,} rows.")

    print("\nSplitting dataset by project to prevent data leakage...")
    
    # We assign 80% of projects to training, and 20% of projects to testing
    gss = GroupShuffleSplit(n_splits=1, train_size=0.8, random_state=42)
    
    # Get the indices for the split
    train_idx, test_idx = next(gss.split(df['text'], df['classification'], groups=df['projectname']))
    
    # Create the Train and Test DataFrames
    df_train_full = df.iloc[train_idx]
    df_test_full = df.iloc[test_idx]

    df_test_clean = df_test_full[df_test_full['status'] == 'ori']
    
    # The training set keeps BOTH original and augmented data so the model has lots of examples!
    X_train = df_train_full['text'].astype(str)
    y_train = df_train_full['classification'].astype(str)
    
    X_test = df_test_clean['text'].astype(str)
    y_test = df_test_clean['classification'].astype(str)

    print(f"Training on {len(X_train):,} comments (Original + Augmented)")
    print(f"Testing on {len(X_test):,} comments (Strictly Original comments from held-out projects)")

    vectorizer = TfidfVectorizer(
        ngram_range=(1, 2),
        max_features=25000,
        stop_words=None
    )

    base_classifier = LinearSVC(class_weight='balanced', random_state=42, max_iter=2000)
    calibrated_classifier = CalibratedClassifierCV(base_classifier, cv=5)

    pipeline = Pipeline([
        ('tfidf', vectorizer),
        ('clf', calibrated_classifier)
    ])

    # Step 6: Train the Model
    print("\nTraining the Calibrated Pipeline...")
    t0 = time.time()
    pipeline.fit(X_train, y_train)
    print(f"Training complete in {time.time() - t0:.2f}s")

    # Step 7: Evaluate the Model (Honest Evaluation!)
    print("\nHonest Classification Report (Tested on unseen projects, original data only):")
    y_pred = pipeline.predict(X_test)
    metrics_dict = classification_report(y_test, y_pred, output_dict=True)
    print(classification_report(y_test, y_pred))

    os.makedirs('../../models', exist_ok=True)
    model_path = '../../models/satd_v1.joblib'
    
    artifact = {
        "pipeline": pipeline,
        "version": "satd-1.0.0",
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "sklearn_version": sklearn.__version__,
        "labels": sorted(df['classification'].unique().tolist()),
        "metrics": metrics_dict
    }
    
    joblib.dump(artifact, model_path)
    print(f"\nSuccessfully exported production SATD dictionary artifact to {model_path}")

if __name__ == '__main__':
    main()
