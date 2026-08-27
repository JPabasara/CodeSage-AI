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
    # Step 1: Load the dataset
    # We use skiprows=1 because the raw CSV has an excel/pivot table summary header at the top
    df = pd.read_csv('../../data/raw/data-augmentation-code_comments.csv',sep=";")
    
    # Clean any rows that are missing critical text or classification labels
    df = df.dropna(subset=['text', 'classification', 'projectname', 'status'])
    print(f"Total dataset size: {len(df):,} rows.")

    # Step 2: Split by Project (GroupShuffleSplit) to prevent data leakage!
    # Because the dataset contains augmented (reworded) copies of comments, 
    # doing a normal random split would leak augmented copies into the training set
    # while testing on the original comment.
    # By splitting by `projectname`, we guarantee the test set contains completely unseen projects!
    print("\nSplitting dataset by project to prevent data leakage...")
    
    # We assign 80% of projects to training, and 20% of projects to testing
    gss = GroupShuffleSplit(n_splits=1, train_size=0.8, random_state=42)
    
    # Get the indices for the split
    train_idx, test_idx = next(gss.split(df['text'], df['classification'], groups=df['projectname']))
    
    # Create the Train and Test DataFrames
    df_train_full = df.iloc[train_idx]
    df_test_full = df.iloc[test_idx]

    # Step 3: Clean the Testing Set
    # We only want to evaluate our model on REAL, un-augmented developer comments.
    # We filter the test set so it only contains `status == 'ori'` (original rows).
    df_test_clean = df_test_full[df_test_full['status'] == 'ori']
    
    # The training set keeps BOTH original and augmented data so the model has lots of examples!
    X_train = df_train_full['text'].astype(str)
    y_train = df_train_full['classification'].astype(str)
    
    X_test = df_test_clean['text'].astype(str)
    y_test = df_test_clean['classification'].astype(str)

    print(f"Training on {len(X_train):,} comments (Original + Augmented)")
    print(f"Testing on {len(X_test):,} comments (Strictly Original comments from held-out projects)")

    # Step 4: Build the TF-IDF Vectorizer
    # We set stop_words=None (instead of 'english') so we don't accidentally delete 
    # important technical debt words like "not", "cannot", and "should".
    vectorizer = TfidfVectorizer(
        ngram_range=(1, 2),
        max_features=25000,
        stop_words=None
    )

    # Step 5: Build the Classifier with Probability Calibration
    # The API contract requires a 'confidence' percentage (0 to 1).
    # LinearSVC normally only outputs boundary distances.
    # Wrapping it in CalibratedClassifierCV maps those distances to actual probabilities!
    base_classifier = LinearSVC(class_weight='balanced', random_state=42, max_iter=2000)
    calibrated_classifier = CalibratedClassifierCV(base_classifier, cv=5)

    # Combine everything into a single Scikit-Learn Pipeline
    # This prevents us from accidentally fitting the TF-IDF twice.
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

    # Step 8: Save the Model with Metadata
    # We package the pipeline alongside critical metadata so the API and DevOps teams
    # know exactly what version is running in production.
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
