# Observe a Scan Lifecycle from the CLI

This runbook follows one scan through the API, Celery workers, ML service, and
PostgreSQL. Run the commands from `infra/` while the local Compose stack is up.

## 1. Check the stack

```bash
cd infra
docker compose ps --all
curl --fail --silent http://localhost:8000/api/healthz
```

`postgres`, `redis`, `ml`, `api`, `worker`, `score-worker`, and `web` should be
running. The one-shot `migrate` container should have exited with code 0.

## 2. Obtain an authenticated session

Sign in at <http://localhost:3000>. In browser developer tools, open
**Application → Cookies → http://localhost:3000** and copy the value of the
`codesage_session` cookie.

Keep it in the current terminal only:

```bash
export CODESAGE_COOKIE='paste-cookie-value-here'
export API='http://localhost:8000/api'
```

Do not paste the cookie into source files, shell scripts, screenshots, or chat.
It grants the same access as the signed-in browser until it expires or is logged
out.

Confirm the session and note its `workspace_id`:

```bash
curl --silent --show-error \
  --cookie "codesage_session=$CODESAGE_COOKIE" \
  "$API/auth/session" | jq
```

## 3. Select a repository and branch

List connected repositories:

```bash
curl --silent --show-error \
  --cookie "codesage_session=$CODESAGE_COOKIE" \
  "$API/projects" | jq
```

Copy a repository ID and set it below:

```bash
export REPO_ID='paste-repository-id-here'
export BRANCH='main'
```

Check the available branches:

```bash
curl --silent --show-error \
  --cookie "codesage_session=$CODESAGE_COOKIE" \
  "$API/repos/$REPO_ID/branches" | jq
```

## 4. Follow service logs

In a second terminal, run:

```bash
cd infra
docker compose logs --follow --since=1m api worker ml score-worker
```

The normal path is:

```text
API accepts request → Redis queues scan → worker clones and analyses repository
→ worker calls ML → snapshot/findings are persisted → score-worker calculates
the profile-dependent score
```

## 5. Start a scan

Back in the first terminal:

```bash
SCAN_RESPONSE="$(curl --silent --show-error --fail-with-body \
    --request POST \
    --cookie "codesage_session=$CODESAGE_COOKIE" \
    --header 'Content-Type: application/json' \
    --data "{\"branch\":\"$BRANCH\"}" \
    "$API/repos/$REPO_ID/scan")"

printf '%s\n' "$SCAN_RESPONSE" | jq
export SCAN_ID="$(printf '%s' "$SCAN_RESPONSE" | jq --raw-output '.scan_id')"
echo "$SCAN_ID"
```

The initial status should normally be `queued`. A second start request for the
same branch should return `409 SCAN_ALREADY_RUNNING` until the first scan reaches
a terminal state.

## 6. Watch API state transitions

```bash
watch -n 2 "curl --silent \
  --cookie 'codesage_session=$CODESAGE_COOKIE' \
  '$API/repos/$REPO_ID/scan/$SCAN_ID' | jq"
```

Expected successful transition:

```text
queued → running → done
```

Other terminal states are `error` and `cancelled`. Press `Ctrl+C` to stop
`watch`; it does not stop the scan.

## 7. Inspect the database record

The database owner is used here only for local debugging. It bypasses the
application's row-level security, so never use this pattern in application code.

```bash
docker compose exec postgres psql \
  --username codesage_owner \
  --dbname codesage \
  --command "
SELECT
  a.id,
  r.owner || '/' || r.name AS repository,
  b.name AS branch,
  a.commit_sha,
  a.status,
  a.start_time,
  a.completion_time,
  a.failure_information
FROM analysis_attempt a
JOIN branch b ON b.id = a.branch_id
JOIN repository r ON r.id = b.repository_id
WHERE a.id = '$SCAN_ID';
"
```

After persistence begins, inspect the generated data:

```bash
docker compose exec postgres psql \
  --username codesage_owner \
  --dbname codesage \
  --command "
SELECT
  s.id AS snapshot_id,
  s.finding_count,
  count(DISTINCT sf.id) AS source_files,
  count(DISTINCT f.id) AS stored_findings,
  max(ss.status) AS score_status
FROM snapshot s
LEFT JOIN source_file sf ON sf.snapshot_id = s.id
LEFT JOIN source_location sl ON sl.source_file_id = sf.id
LEFT JOIN finding f ON f.source_location_id = sl.id
LEFT JOIN snapshot_score ss ON ss.snapshot_id = s.id
WHERE s.analysis_attempt_id = '$SCAN_ID'
GROUP BY s.id, s.finding_count;
"
```

No row is expected before the snapshot has been created. Score status normally
moves from `pending` or `running` to `ready`.

## 8. Cancel a queued or running scan

To exercise cancellation, start another scan and immediately run:

```bash
curl --silent --show-error --fail-with-body \
  --request POST \
  --cookie "codesage_session=$CODESAGE_COOKIE" \
  "$API/repos/$REPO_ID/scan/$SCAN_ID/stop" | jq
```

The terminal status should become `cancelled`. Cancellation is cooperative, so a
worker that is inside a tool step may take a short time to observe the request.

## 9. Verify the completed result

List scan history:

```bash
curl --silent --show-error \
  --cookie "codesage_session=$CODESAGE_COOKIE" \
  "$API/repos/$REPO_ID/scans?branch=$BRANCH" | jq
```

Fetch the latest health report:

```bash
curl --silent --show-error --fail-with-body \
  --cookie "codesage_session=$CODESAGE_COOKIE" \
  "$API/repos/$REPO_ID/health?branch=$BRANCH" | jq
```

If the scan is `done` but the report returns `SCORE_PENDING`, watch the
`score-worker` logs and retry after its `snapshot_score` row becomes `ready`.

## 10. Diagnose a failed scan

Use all three views together:

```bash
docker compose logs --since=10m api worker ml score-worker
```

```bash
curl --silent --show-error \
  --cookie "codesage_session=$CODESAGE_COOKIE" \
  "$API/repos/$REPO_ID/scan/$SCAN_ID" | jq
```

```bash
docker compose exec postgres psql \
  --username codesage_owner \
  --dbname codesage \
  --command "SELECT status, failure_information FROM analysis_attempt WHERE id = '$SCAN_ID';"
```

Common causes are an unreachable repository, a missing branch, GitHub rate
limits, insufficient clone storage, or an unavailable worker. ML failure alone
should degrade to rule-only analysis rather than fail the entire scan.

When finished, clear the session value from the shell:

```bash
unset CODESAGE_COOKIE SCAN_RESPONSE SCAN_ID REPO_ID BRANCH API
```
