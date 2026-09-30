# CodeSage health-score calibration

Generated: 2026-09-30T03:05:31.490332+00:00

## Dataset

- Input records: 12
- Eligible repositories: 12
- Excluded records: 0
- Manifest SHA-256: `3d9a1eecd96ad3d9049b4a9f69e11599f62e4dcd62ae04c04c618c6397194376`

## Selected calibration

- **k = 80.0768** (P95(D/KLOC))
- Repository-level bootstrap 95% CI: [50.6038, 82.1729]
- Percentile method: Hyndman-Fan type 7 / NumPy method='linear' equivalent

## Summary statistics

| Statistic | D/KLOC |
|---|---:|
| min | 1.73968 |
| p5 | 5.63081 |
| p10 | 8.89047 |
| p25 | 11.1615 |
| p50 | 23.3264 |
| p75 | 60.1149 |
| p90 | 77.4508 |
| p95 | 80.0768 |
| p97.5 | 81.1248 |
| p99 | 81.7537 |
| max | 82.1729 |
| iqr | 48.9535 |
| mad | 17.916 |

## Sensitivity

| Candidate | k |
|---|---:|
| p90 | 77.4508 |
| p95 | 80.0768 |
| p97.5 | 81.1248 |
| p99 | 81.7537 |
| max | 82.1729 |

## Largest debt-density repositories

| Repository | Commit | KLOC | Debt | D/KLOC | Flags |
|---|---|---:|---:|---:|---|
| termux/termux-app | 8629e632fcb95da272221be327db653fb24befe9 | 23.762 | 1952.59 | 82.1729 | mixed_scan_provenance |
| jeecgboot/JeecgBoot | 87d7f938d47d2585618bcfc5a31d125801cbff27 | 59.596 | 4670.05 | 78.3617 | mixed_scan_provenance |
| zxing/zxing | 33dfdefcb35576612841e614d44ba9edc9aee2b5 | 33.82 | 2342.12 | 69.2525 | mixed_scan_provenance |
| airbnb/lottie-android | 05ea92e90381eb8a8ae06855ea2b74f322bebbec | 16.993 | 969.774 | 57.069 | mixed_scan_provenance |
| TeamNewPipe/NewPipe | 7e5df38aad4b2c035332b3f71aee3064d4fdaae4 | 37.948 | 1694.24 | 44.6464 | mixed_scan_provenance |
| lysine-dev/retrofit | d3a0eeba486daaef04f39cf5103a00d9efcd5419 | 9.292 | 230.205 | 24.7745 | mixed_scan_provenance |
| lenve/vhr | 03abbd35af24e55368ce4e09f4038dc2aba3ff5f | 2.963 | 64.8253 | 21.8783 | mixed_scan_provenance |
| binarywang/WxJava | 58af116149e4d89a12828cf22f10fee77a63295d | 120.151 | 1872.76 | 15.5868 | mixed_scan_provenance |
| halo-dev/halo | 14187e63a0fd7d3f3710a7d32c7406cf8f9c2a4c | 37.544 | 438.906 | 11.6904 | mixed_scan_provenance |
| alibaba/arthas | f9386bfbf64155ace6b81ea3257d1f6fe8d5f3d4 | 68.822 | 658.937 | 9.57451 | mixed_scan_provenance |

## Outliers and exclusions

- IQR upper fence: 133.545
- Eligible repositories flagged by IQR: 0
- Exclusion reasons: `{}`
- Valid extreme repositories were retained; flags request review and are not exclusions.

## Size-normalization check

- Spearman rho(D/KLOC, KLOC): -0.5454545454545454
- p-value: None (SciPy unavailable or statistic undefined)
- Diagnostic convention: |rho| >= 0.30 (diagnostic warning, not pass/fail)

## Warnings

- Small calibration corpus: tail percentiles and bootstrap CI are unstable.
- Debt density retains a substantial size relationship (documented review threshold: |Spearman rho| >= 0.30); inspect scope and normalization before adopting k.
- Eligible scans contain differing provenance/configuration records.

## Scoring configuration and provenance

The calibrated k is valid only for this scoring configuration and compatible scan provenance.

```json
{
  "calibration_tool_local_reference": {
    "active_profile": {
      "include_test_findings": false,
      "name": "Balanced",
      "trust": 0.5,
      "weights": {
        "code-design": 1.0,
        "documentation": 1.0,
        "requirement": 1.0,
        "security": 1.0,
        "test": 1.0
      }
    },
    "analysis_engine": {},
    "churn": {
      "cap_commits": 20,
      "formula": "1 + min(commits_90d, cap) / cap",
      "source": "persisted per-file ProcessMetric.commits_90d",
      "window_days": 90
    },
    "codesage_git_commit": "ab77b2e4b153c2dd3d598a7f3ac133d5ac5108ca",
    "config_hashes": {
      "base_points.yaml": "66bed8792d0105b1327ab5e4c09b72d61df733b7be91a08cd877adf5d1d40aad",
      "calibration.yaml": "a33c13ab39eb3d33b3a60d0fe3439233dce3858336f1c6ff186211ae5becb9f0",
      "presets.yaml": "5568d9fee55e69e61974247b5cbf51e5ef441774f7c926ee5fd3889766768a76"
    },
    "health_formula": {
      "current_k": 25.0,
      "formula": "100 * (1 - min(1, (D / KLOC) / k))",
      "k_status": "placeholder_not_calibrated",
      "version": "linear-debt-density-v1"
    },
    "health_scope": {
      "generated": "excluded from both debt and LOC",
      "policy_version": "health-scope-v1",
      "production": "included",
      "test": "included only when active_profile.include_test_findings is true",
      "unknown_and_example": "included",
      "vendor_third_party": "included because no reliable dedicated classification exists"
    },
    "loc": {
      "kloc_conversion": "LOC / 1000",
      "method": "sum of included CK per-file loc static metrics"
    },
    "model_versions": {},
    "pmd": {
      "mapping_sha256": "8c40f8b5c3b6d2e796031e789e0836684969a8f53296153642be54d912ac25d8",
      "ruleset": "codesage_api/detection/pmd/rulesets/codesage.xml",
      "ruleset_sha256": "2c19f7ac3be147de49ace9edd97860486470787e7c2478deb53dfbf3a839950e",
      "version": "recorded per scan in analysis_engine_version.tool_versions when exported"
    },
    "profile_id": "health-scoring-profile-v1",
    "risk_multiplier": {
      "formula": "1 + ml_trust * finding_risk_score",
      "risk_score_range": [
        0.0,
        1.0
      ]
    },
    "scoring_engine_version": "1.1.0",
    "severity_base_points": {
      "critical": 8.0,
      "high": 5.0,
      "low": 1.0,
      "medium": 3.0
    },
    "trust_multipliers": {
      "rule": 1.0,
      "satd_ml": 1.0,
      "security_override": 1.0
    }
  },
  "interpretation": "scan_provenance_records contains comparable imported scan configuration with branch, scanned_at, and snapshot_id removed; the local reference documents the tool installation that generated this report",
  "scan_provenance_records": [
    {
      "active_profile": {
        "include_test_findings": false,
        "name": "Balanced",
        "trust": 0.5,
        "weights": {
          "code-design": 1.0,
          "documentation": 1.0,
          "requirement": 1.0,
          "security": 1.0,
          "test": 1.0
        }
      },
      "analysis_engine": {
        "extraction_logic_version": "v2",
        "rule_set_version": "v1",
        "tool_versions": {
          "ck": "0.7.0",
          "pydriller": "2.10"
        },
        "version_identifier": "codesage-v2"
      },
      "churn": {
        "cap_commits": 20,
        "formula": "1 + min(commits_90d, cap) / cap",
        "source": "persisted per-file ProcessMetric.commits_90d",
        "window_days": 90
      },
      "health_formula": {
        "current_k": 25.0,
        "formula": "100 * (1 - min(1, (D / KLOC) / k))",
        "k_status": "placeholder_not_calibrated",
        "version": "linear-debt-density-v1"
      },
      "health_scope": {
        "generated": "excluded from both debt and LOC",
        "policy_version": "health-scope-v1",
        "production": "included",
        "test": "included only when active_profile.include_test_findings is true",
        "unknown_and_example": "included",
        "vendor_third_party": "included because no reliable dedicated classification exists"
      },
      "loc": {
        "kloc_conversion": "LOC / 1000",
        "method": "sum of included CK per-file loc static metrics"
      },
      "model_versions": {
        "snapshot_models": "risk-2.0.0"
      },
      "profile_id": "health-scoring-profile-v1",
      "risk_multiplier": {
        "formula": "1 + ml_trust * finding_risk_score",
        "risk_score_range": [
          0.0,
          1.0
        ]
      },
      "scoring_engine_version": "1.1.0",
      "severity_base_points": {
        "critical": 8.0,
        "high": 5.0,
        "low": 1.0,
        "medium": 3.0
      },
      "trust_multipliers": {
        "rule": 1.0,
        "satd_ml": 1.0,
        "security_override": 1.0
      }
    },
    {
      "active_profile": {
        "include_test_findings": false,
        "name": "Balanced",
        "trust": 0.5,
        "weights": {
          "code-design": 1.0,
          "documentation": 1.0,
          "requirement": 1.0,
          "security": 1.0,
          "test": 1.0
        }
      },
      "analysis_engine": {
        "extraction_logic_version": "v2",
        "rule_set_version": "v1",
        "tool_versions": {
          "ck": "0.7.0",
          "pydriller": "2.10"
        },
        "version_identifier": "codesage-v2"
      },
      "churn": {
        "cap_commits": 20,
        "formula": "1 + min(commits_90d, cap) / cap",
        "source": "persisted per-file ProcessMetric.commits_90d",
        "window_days": 90
      },
      "health_formula": {
        "current_k": 25.0,
        "formula": "100 * (1 - min(1, (D / KLOC) / k))",
        "k_status": "placeholder_not_calibrated",
        "version": "linear-debt-density-v1"
      },
      "health_scope": {
        "generated": "excluded from both debt and LOC",
        "policy_version": "health-scope-v1",
        "production": "included",
        "test": "included only when active_profile.include_test_findings is true",
        "unknown_and_example": "included",
        "vendor_third_party": "included because no reliable dedicated classification exists"
      },
      "loc": {
        "kloc_conversion": "LOC / 1000",
        "method": "sum of included CK per-file loc static metrics"
      },
      "model_versions": {
        "snapshot_models": "risk-2.0.0, satd-1.0.0"
      },
      "profile_id": "health-scoring-profile-v1",
      "risk_multiplier": {
        "formula": "1 + ml_trust * finding_risk_score",
        "risk_score_range": [
          0.0,
          1.0
        ]
      },
      "scoring_engine_version": "1.1.0",
      "severity_base_points": {
        "critical": 8.0,
        "high": 5.0,
        "low": 1.0,
        "medium": 3.0
      },
      "trust_multipliers": {
        "rule": 1.0,
        "satd_ml": 1.0,
        "security_override": 1.0
      }
    }
  ]
}
```
