#!/usr/bin/env bash
set -euo pipefail

: "${CODESAGE_DATABASE_URL:?Set CODESAGE_DATABASE_URL to the database to verify}"

container="codesage-backup-verify-${RANDOM}"
dump_file="$(mktemp /tmp/codesage-backup-verify.XXXXXX.dump)"
source_manifest="$(mktemp /tmp/codesage-source-manifest.XXXXXX)"
restored_manifest="$(mktemp /tmp/codesage-restored-manifest.XXXXXX)"
source_data="$(mktemp /tmp/codesage-source-data.XXXXXX)"
restored_data="$(mktemp /tmp/codesage-restored-data.XXXXXX)"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -f "$dump_file" "$source_manifest" "$restored_manifest" "$source_data" "$restored_data"
}
trap cleanup EXIT

manifest_sql="SELECT table_name, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', table_name), false, true, '')))[1]::text::bigint AS rows FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name"

pg_dump --format=custom --no-owner --no-acl "$CODESAGE_DATABASE_URL" >"$dump_file"
psql "$CODESAGE_DATABASE_URL" --no-align --tuples-only --command "$manifest_sql" >"$source_manifest"
pg_dump --data-only --column-inserts --no-owner --no-acl "$CODESAGE_DATABASE_URL" >"$source_data"

docker run --detach --name "$container" --publish 127.0.0.1::5432 --env POSTGRES_PASSWORD=verify --env POSTGRES_DB=codesage postgres:16 >/dev/null
until docker exec "$container" pg_isready --username postgres --dbname codesage >/dev/null 2>&1; do
  sleep 1
done
docker cp "$dump_file" "$container:/tmp/backup.dump"
docker exec "$container" pg_restore --username postgres --dbname codesage --no-owner --no-acl /tmp/backup.dump
docker exec "$container" psql --username postgres --dbname codesage --no-align --tuples-only --command "$manifest_sql" >"$restored_manifest"

diff --unified "$source_manifest" "$restored_manifest"
restored_port="$(docker port "$container" 5432/tcp | sed 's/.*://')"
restored_url="postgresql+psycopg://postgres:verify@127.0.0.1:${restored_port}/codesage"
pg_dump --data-only --column-inserts --no-owner --no-acl "${restored_url/postgresql+psycopg/postgresql}" >"$restored_data"
diff --unified "$source_data" "$restored_data"

(cd apps/api && CODESAGE_DATABASE_URL="$restored_url" alembic current)
echo "Row counts, deterministic data dump, and Alembic revision match."
