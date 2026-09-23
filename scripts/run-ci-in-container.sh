#!/bin/sh
set -eu

section() {
    printf '\n\n===== %s =====\n' "$1"
}

section "web: generated API contract"
cd /workspace/apps/web
pnpm gen:types:check

section "web: TypeScript"
pnpm typecheck

section "web: lint"
pnpm lint

section "web: tests"
pnpm test:run

section "api: Alembic head"
cd /workspace/apps/api
ALEMBIC_OUTPUT=$(/opt/api-venv/bin/alembic heads 2>&1)
printf '%s\n' "$ALEMBIC_OUTPUT"
if printf '%s' "$ALEMBIC_OUTPUT" | grep -q "present more than once"; then
    echo "Two migrations declare the same revision id." >&2
    exit 1
fi
ALEMBIC_HEAD_COUNT=$(/opt/api-venv/bin/alembic heads 2>/dev/null | grep -c .)
if [ "$ALEMBIC_HEAD_COUNT" -ne 1 ]; then
    echo "Expected exactly one Alembic head; found $ALEMBIC_HEAD_COUNT." >&2
    exit 1
fi

section "api: architecture"
/opt/api-venv/bin/lint-imports

section "api: migrations, constraints, and RLS"
/opt/api-venv/bin/pytest -q -rs \
    tests/integration/test_rls.py \
    tests/integration/test_database_constraints.py

section "api: all tests"
/opt/api-venv/bin/pytest -q -rs

section "api: advisory Ruff"
/opt/api-venv/bin/ruff check . --exit-zero --output-format=concise

section "ml: tests"
cd /workspace/apps/ml
/opt/ml-venv/bin/pytest -q -rs

section "ml: advisory Ruff"
/opt/ml-venv/bin/ruff check . --exit-zero --output-format=concise

section "all CI test jobs passed"
