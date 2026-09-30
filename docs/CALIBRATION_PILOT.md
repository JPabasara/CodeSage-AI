# Health-score calibration benchmark

The candidate catalog is
`apps/api/calibration-pilot/candidates.json`. It contains 258 non-fork,
non-archived repositories returned by GitHub's Java repository search. The
catalog applies a neutral `github_size_kb >= 3000` screening threshold, removes
repositories whose metadata identifies them as educational/toy collections,
and is sorted by stars. GitHub repository size is not KLOC; each successful
CodeSage scan records the actual analyzed KLOC.

Every run verifies the same canonical profile before scanning:

- profile: `Balanced`;
- category weights: all `1.0`;
- ML trust: `0.5`;
- test findings: excluded.

The runner uses the normal CodeSage connect, scan, score, and calibration-export
HTTP paths. It does not reimplement a scanner. It resolves the default branch's
commit SHA at run time, writes one JSON record per successful repository,
continues after failures, and can be interrupted and resumed. The runner
never modifies the production `k` in `scoring/config/calibration.yaml`
(currently `100.0`, calibrated from the 2026-09-30 pilot).

## Run a 25-repository pilot

From the repository root, copy the value of the `codesage_session` cookie from
an authenticated local browser session, then run:

```bash
cd "/home/chamodh/probe/sem 5 project/CodeSage-AI"
export CODESAGE_SESSION='paste-cookie-value-here'
./apps/api/calibration-pilot/run-calibration.sh --limit 25
```

The script activates `apps/api/.venv-linux` when present (falling back to
`apps/api/.venv`), builds and starts the required Docker Compose services,
waits for the API, prints timestamped per-repository progress, runs the fixed
P95/10,000-bootstrap/seed-42 calibration, and prints the main result.

## Resume or run a larger benchmark

Rerun the same command with the same output directory. Existing record files
are annotated and skipped:

```bash
./apps/api/calibration-pilot/run-calibration.sh --limit 100
```

Run all 258 enabled candidates only when the machine can remain available for
an extended run:

```bash
./apps/api/calibration-pilot/run-calibration.sh --all
```

Use a separate output directory for an independent run:

```bash
./apps/api/calibration-pilot/run-calibration.sh \
  --limit 30 \
  --output-dir apps/api/calibration-pilot/runs/pilot-02
```

If the stack is already running and contains the current code:

```bash
./apps/api/calibration-pilot/run-calibration.sh --limit 25 --skip-stack
```

Run `./apps/api/calibration-pilot/run-calibration.sh --help` for all options.

## Outputs

The default output directory is `apps/api/calibration-pilot/benchmark-run/`:

- `records/*.json`: one calibration observation per successful repository;
- `resolved-manifest.json`: resolved SHA and status for every attempted entry;
- `failures.json`: connection, scan, timeout, and export failures;
- `run-summary.json`: attempted/success/failed counts and canonical profile;
- `run.log`: timestamped progress log;
- `results/calibration.json`: machine-readable statistics;
- `results/repositories.csv`: per-repository values and outlier flags;
- `results/calibration.md`: human-readable calibration report.

Review failures, PMD/tool degradation, mixed/missing provenance, IQR/MAD
outliers, and the KLOC-versus-D/KLOC Spearman result before treating pilot P95
as a candidate production constant. Candidate inclusion is not evidence that a
repository is scan-compatible; exclusions discovered during the run remain in
the resolved manifest rather than being silently replaced.
