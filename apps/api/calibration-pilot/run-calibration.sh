#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"
API_DIR="$REPO_ROOT/apps/api"
COMPOSE=(-f "$REPO_ROOT/infra/docker-compose.yml" -f "$REPO_ROOT/infra/docker-compose.dev.yml")

MANIFEST="$SCRIPT_DIR/candidates.json"
OUTPUT_DIR="$SCRIPT_DIR/benchmark-run"
LIMIT=25
BUILD=1
START_STACK=1

usage() {
  cat <<'EOF'
Usage: run-calibration.sh [options]

Options:
  --limit N          Scan the first N enabled candidates (default: 25)
  --all              Scan every enabled candidate in the manifest
  --manifest PATH    Candidate manifest (default: calibration-pilot/candidates.json)
  --output-dir PATH  Resumable output directory (default: calibration-pilot/benchmark-run)
  --no-build         Start containers without rebuilding images
  --skip-stack       Do not start Docker Compose services
  -h, --help         Show this help

Required environment:
  CODESAGE_SESSION   Value of an authenticated local codesage_session cookie
EOF
}

while (($#)); do
  case "$1" in
    --limit)
      LIMIT="${2:?--limit requires a number}"
      shift 2
      ;;
    --all)
      LIMIT=""
      shift
      ;;
    --manifest)
      MANIFEST="$(realpath -m -- "${2:?--manifest requires a path}")"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="$(realpath -m -- "${2:?--output-dir requires a path}")"
      shift 2
      ;;
    --no-build)
      BUILD=0
      shift
      ;;
    --skip-stack)
      START_STACK=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "${CODESAGE_SESSION:-}" ]]; then
  echo "ERROR: export CODESAGE_SESSION with your authenticated local session cookie." >&2
  exit 2
fi
if [[ ! -f "$MANIFEST" ]]; then
  echo "ERROR: manifest not found: $MANIFEST" >&2
  exit 2
fi
if [[ -n "$LIMIT" && ! "$LIMIT" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: --limit must be a positive integer." >&2
  exit 2
fi

for command in curl docker jq; do
  command -v "$command" >/dev/null || {
    echo "ERROR: required command is missing: $command" >&2
    exit 2
  }
done

if [[ -f "$API_DIR/.venv-linux/bin/activate" ]]; then
  # shellcheck disable=SC1091
  source "$API_DIR/.venv-linux/bin/activate"
elif [[ -f "$API_DIR/.venv/bin/activate" ]]; then
  # shellcheck disable=SC1091
  source "$API_DIR/.venv/bin/activate"
else
  echo "ERROR: no API virtualenv found (.venv-linux or .venv)." >&2
  exit 2
fi

mkdir -p "$OUTPUT_DIR/records" "$OUTPUT_DIR/results"
TOTAL="$(jq '[.repositories[] | select(.enabled != false)] | length' "$MANIFEST")"
TARGET="$TOTAL"
if [[ -n "$LIMIT" && "$LIMIT" -lt "$TOTAL" ]]; then
  TARGET="$LIMIT"
fi

echo "Candidate manifest : $MANIFEST ($TOTAL enabled)"
echo "This run           : $TARGET repositories"
echo "Output directory   : $OUTPUT_DIR"
echo "Existing records   : $(find "$OUTPUT_DIR/records" -maxdepth 1 -name '*.json' -type f | wc -l)"

if ((START_STACK)); then
  echo "Starting CodeSage services..."
  if ((BUILD)); then
    docker compose "${COMPOSE[@]}" up -d --build postgres redis ml migrate api worker score-worker
  else
    docker compose "${COMPOSE[@]}" up -d postgres redis ml migrate api worker score-worker
  fi

  echo "Waiting for http://localhost:8000/api/healthz ..."
  ready=0
  for attempt in $(seq 1 60); do
    if curl --fail --silent http://localhost:8000/api/healthz >/dev/null; then
      ready=1
      break
    fi
    printf '  API not ready (%d/60)\r' "$attempt"
    sleep 2
  done
  echo
  if ((ready == 0)); then
    echo "ERROR: API did not become healthy within 120 seconds." >&2
    exit 1
  fi
fi

export PYTHONPATH="$API_DIR/src${PYTHONPATH:+:$PYTHONPATH}"
runner=(
  python -m codesage_api.calibration.pilot
  --manifest "$MANIFEST"
  --output-dir "$OUTPUT_DIR"
  --api-base http://localhost:8000
  --poll-seconds 3
  --scan-timeout-seconds 1200
  --delay-seconds 5
)
if [[ -n "$LIMIT" ]]; then
  runner+=(--limit "$LIMIT")
fi

echo "Running scans (safe to interrupt and rerun; completed JSON records are reused)..."
PYTHONUNBUFFERED=1 "${runner[@]}" 2>&1 | tee "$OUTPUT_DIR/run.log"

RECORD_COUNT="$(find "$OUTPUT_DIR/records" -maxdepth 1 -name '*.json' -type f | wc -l)"
if ((RECORD_COUNT == 0)); then
  echo "ERROR: no calibration records were exported; calibration was not run." >&2
  exit 1
fi

echo "Running empirical calibration over $RECORD_COUNT records..."
python -m codesage_api.calibration.health \
  --input "$OUTPUT_DIR/records" \
  --percentile 95 \
  --bootstrap-samples 10000 \
  --seed 42 \
  --output-dir "$OUTPUT_DIR/results"

echo
echo "Calibration complete. Production k was not changed."
jq '{dataset, selected_k, bootstrap_95_ci, size_normalization, warnings}' \
  "$OUTPUT_DIR/results/calibration.json"
echo "Full report: $OUTPUT_DIR/results/calibration.md"
