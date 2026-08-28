# ML-2 Bug-Proneness Risk Model Architecture & Selection Rationale

## 1. System Requirements for Bug-Proneness Risk Estimation (ML-2)

In CodeSage AI, the objective of the **ML-2 Risk Model** (SRS FR-10) is to provide an objective, per-file continuous probability score (from `0.0` to `1.0`) estimating the likelihood of post-release defects in source code files.

The model serves two primary architectural functions:
1. **Risk Badge Display:** Renders a risk indicator (High / Medium / Low) in the Findings Table to highlight vulnerable classes.
2. **Priority Ranking Multiplier (`risk_factor`):** Modulates technical debt priority so issues located in defect-prone, high-churn files bubble up to the top of developer remediation backlogs.

---

## 2. Dataset Provenance: D'Ambros (AEEEM) Benchmark

The model is trained and evaluated on the authentic **D'Ambros / AEEEM Benchmark Dataset**, matching SRS Reference `[12]` (M. D'Ambros, M. Lanza, and R. Robbes, *"An extensive comparison of bug prediction approaches,"* IEEE MSR, 2010):

* **Source Repository:** AWSM Research / Zenodo (`10.5281/zenodo.6335198`)
* **Systems Included (5 Systems):**
  1. `Equinox` (324 Java classes)
  2. `Eclipse JDT Core` (997 Java classes)
  3. `Apache Lucene` (691 Java classes)
  4. `Mylyn` (1,862 Java classes)
  5. `Eclipse PDE UI` (1,497 Java classes)
* **Total Instances:** 5,371 classes
* **Class Balance:** 15.9% Defective (853 classes with post-release bugs) vs 84.1% Clean (4,518 classes)
* **Artifact File:** `apps/ml/data/raw/dambros_aeeem.csv`
* **Prepared Dataset SHA-256:** `be73bca623ca320e8dce5c302abcabb41648e11dbe075f9ad2dfb3d2a5fce06d`

### v1.0 feature limitation

The AEEEM mirror available to CodeSage contains cumulative process metrics but
does not contain CK product metrics, a 90-day commit count, or recency. The v1.0
prototype therefore trains only on the two fields with matching production
semantics: **author count** and **file age**. All other positions in the canonical
13-feature vector are neutral during training. They must not be populated with
unrelated AEEEM fields (for example, code churn is not WMC and version count is
not DIT). Reconstructing matching CK and commit-anchored process metrics is the
next model-quality improvement.

---

## 3. Literature-Grounded Architecture Selection: Random Forest

The classifier architecture was selected based on established empirical software engineering defect prediction literature (e.g., *Lessmann et al., IEEE TSE 2008*; *D'Ambros et al., 2010/2012*; *Tantithamthavorn et al., IEEE TSE 2018*):

1. **Non-linear process interactions:** Tree ensembles can capture thresholds and interactions between author count and file age without manual polynomial features.
2. **Prototype continuity:** Random Forest retains the architecture selected for ML-2 while the feature reconstruction work remains outstanding.
3. **Probability calibration (`CalibratedClassifierCV`):** Sigmoid calibration smooths the forest's class probabilities. Calibration is evaluated with Brier score and should still be checked with reliability plots before calling the values absolute probabilities.
4. **Inference latency:** Held-out batches of 324–1,862 classes took approximately 35–57 ms on the evaluation machine and require no GPU.

---

## 4. Empirical Evaluation: Leave-One-Project-Out (LOPO) Cross-Validation

To prevent cross-project data leakage and guarantee generalizability to unseen repositories, evaluation was performed using **Leave-One-Project-Out (LOPO)** cross-validation across all 5 AEEEM systems:

| Held-Out Project | Total Classes | Defective Classes | ROC-AUC | PR-AUC | F1-Score | Brier Score | Latency |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`equinox`** | 324 | 129 (39.8%) | **0.6773** | 0.5218 | 0.0000 | 0.3117 | 35.0ms |
| **`jdt`** | 997 | 206 (20.7%) | **0.6723** | 0.4295 | 0.0000 | 0.1553 | 38.8ms |
| **`lucene`** | 691 | 64 (9.3%) | **0.6579** | 0.2828 | 0.0000 | 0.0861 | 34.8ms |
| **`mylyn`** | 1,862 | 245 (13.2%) | **0.5251** | 0.1391 | 0.0000 | 0.1155 | 56.8ms |
| **`pde`** | 1,497 | 209 (14.0%) | **0.5588** | 0.1645 | 0.0000 | 0.1217 | 47.5ms |
| **Mean LOPO Avg** | **5,371** | **853 (15.9%)** | **0.6183** | **0.3075** | **0.0000** | **0.1581** | **42.6ms** |

### Key Evaluation Takeaways:
- **Discrimination Capability**: Mean LOPO ROC-AUC is **0.6183**. This is a
  modest prototype signal, not evidence of production-grade defect prediction.
- **Threshold limitation**: F1 at the default `0.5` threshold is zero. CodeSage
  consumes the continuous ranking score, but the model must not be presented as
  a useful binary defect classifier without threshold selection on validation data.
- **Probability calibration**: Mean Brier Score is **0.1581**. Brier score alone
  does not prove perfect calibration; reliability plots remain future work.
