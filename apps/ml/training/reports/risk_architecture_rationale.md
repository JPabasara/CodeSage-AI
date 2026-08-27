# ML-2 Bug-Proneness Risk Model Architecture & Selection Rationale

## 1. System Requirements for Bug-Proneness Risk Estimation (ML-2)

In CodeSage AI, the objective of the **ML-2 Risk Model** (SRS FR-10) is to provide an objective, per-file probability score (from `0.0` to `1.0`) estimating the likelihood of defects in source code files.

The model serves two primary architectural roles:
1. **Risk Badge Display:** Renders a clean risk indicator (High / Medium / Low) in the Findings Table to highlight vulnerable classes.
2. **Priority Ranking Multiplier (`risk_factor`):** Modulates technical debt priority so issues in defect-prone, high-churn files bubble up to the top of developer remediation backlogs.

---

## 2. Feature Engineering & Vector Representation

The model utilizes a **13-dimensional numerical feature vector** (`FEATURE_ORDER` in `apps/ml/src/codesage_ml/risk/features.py`), combining static structural complexity and historical churn:

### A. Product Metrics (CK Metrics Suite)
1. **`wmc` (Weighted Methods per Class):** Measure of class cyclomatic complexity.
2. **`cbo` (Coupling Between Objects):** Measures inter-dependency across classes.
3. **`dit` (Depth of Inheritance Tree):** Measures inheritance hierarchy depth.
4. **`lcom` (Lack of Cohesion in Methods):** Quantifies method cohesion.
5. **`rfc` (Response for a Class):** Number of unique methods invoked.
6. **`noc` (Number of Children):** Subclass fan-out.
7. **`loc` (Lines of Code):** Raw file volume.
8. **`max_nested_blocks`:** Maximum control-flow nesting depth.
9. **`comment_ratio`:** Ratio of documentation comments to total code.

### B. Process Metrics (PyDriller History Mining)
10. **`commits_90d`:** Code churn / commit frequency in the previous 90-day window.
11. **`author_count`:** Number of distinct contributors modifying the file.
12. **`file_age_days`:** Longevity of the file in the repository.
13. **`recency_days`:** Days elapsed since the most recent commit.

---

## 3. Training Dataset & Leakage Prevention

The model was trained on the standardized Java defect prediction benchmark corpus comprising **4,966 class files across 9 open-source Java projects** (`ant`, `camel`, `jedit`, `lucene`, `poi`, `synapse`, `velocity`, `xalan`, `xerces`).

### Cross-Project Leakage Mitigation (`GroupShuffleSplit`)
Standard random train/test splitting leaks project-specific patterns into the test set. We enforced `GroupShuffleSplit(n_splits=1, train_size=0.8, groups=project_name)`, training on 7 projects and evaluating strictly on 2 unseen held-out projects (`camel` and `xalan`).

---

## 4. Classifier Selection: Random Forest

We evaluated candidate machine learning algorithms for tabular defect prediction:

| Candidate Model | Precision (Defect) | Recall (Defect) | ROC-AUC | Inference Latency (1k files) |
| :--- | :--- | :--- | :--- | :--- |
| **Logistic Regression** | 0.54 | 0.28 | 0.512 | 1.1ms |
| **Random Forest (Selected)** | **0.62** | **0.33** | **0.526** | **2.4ms** |
| **Gradient Boosting** | 0.58 | 0.31 | 0.518 | 4.8ms |

### Rationale:
1. **Handling Non-Linear Relationships:** Tree ensembles naturally capture non-linear interactions between code size (`loc`), complexity (`wmc`), and churn (`commits_90d`).
2. **Robustness to Varying Feature Scales:** Random Forest handles heterogeneous scales without requiring heavy normalization.
3. **Calibrated Probability Output:** Exposes smooth probability estimates (`predict_proba`) representing continuous defect risk.
