# Deployment implementation log

*Janidu · infra, CI and Dockerfiles · append a new entry per phase.*

What this file is: a plain record of **what was changed, why, and how to check it still works**. Written so a teammate who has never opened a Dockerfile can follow it. Newest entry at the top.

**Trying to run it, not change it?** Go straight to **[Reference — the three ways to run it, and what each one can prove](#reference--the-three-ways-to-run-it-and-what-each-one-can-prove)**: frontend with MSW, the whole stack in Docker, the live site — and the list of what cannot be tested locally.

New to Docker Compose? **[Reference — Docker Compose, explained](#reference--docker-compose-explained)** at the foot of this file covers the private network, where the passwords come from, and what changes in production.

---

## Entry 5 — 26 Aug 2026 — Phase 4 (finish the deployment) — **PLAN, nothing ticked yet**

**Plan reference:** [team plan §6, Phase 4 (J4.1–J4.6)](team-plan-to-mid-evaluation.md#phase-4--finish-the-deployment-wed-26-aug-onward).

Entries 1–4 got `api` and `web` live. This entry is the rest: the two containers that were
never started, and turning "green CI" into "green CI *deploys*". **Written before doing it**, so
every step below is an instruction, not a record. Come back and mark each one when it is done.

> **Everything under "What is broken before you start" was verified against the code on
> 26 Aug 2026, not assumed.** The commands used are given, so anyone can re-run them.

### What is missing

| Gap | What it costs today |
|---|---|
| `worker` is **stopped** on Railway | Entry 4 stopped it because every Celery task was `raise NotImplementedError`. **That is no longer true** — `tasks/scan_pipeline.py` is real code now. Press **Scan** on the live site today and the job is accepted, written to Upstash, and nothing ever picks it up. The scan sits at 0% forever |
| `ml` was **never deployed** | Nothing classifies comments and nothing measures risk. See the honest note in Step 4 — this costs less than it sounds like, for a reason that is itself a problem |
| **No CD** | A merge to `main` builds and publishes three images and then stops. A human has to open Railway and click Redeploy. §10 of the team plan asks for this and it was never done |
| ~~**Branch protection has a hole in it**~~ **— DONE 26 Aug** |
| **Migrations are a laptop step** | `alembic upgrade head` has only ever been run by hand, from one machine, against Neon. Nothing in the pipeline runs it |

---

### What is broken before you start — three findings

Do not skip to Step 3. Deploying the worker on top of these produces a service that starts,
reports healthy, accepts jobs, and fails every one of them.

#### Finding 1 — **the published `api` image has no CK jar.** This is the blocker

`apps/api/Dockerfile` copies the whole `vendor/` directory to `/opt/ck/` and sets
`CODESAGE_CK_JAR=/opt/ck/ck.jar`. But the jar is **gitignored** — root `.gitignore` line 42 is
`apps/api/vendor/*.jar` — so `vendor/` in a fresh checkout holds exactly one file, `README.md`.

CI checks out the repository fresh. So **every image CI has ever published has an empty
`/opt/ck/`** — and so does every local `docker compose build`.

```bash
# Both print only README.md / an empty directory today
ls apps/api/vendor/
docker run --rm --entrypoint sh ghcr.io/jpabasara/codesage-ai/api:latest -c 'ls -l /opt/ck/'
```

What that does at run time — `extractors/ck_metrics.py`:

```python
jar = ck_jar or Path(get_settings().ck_jar)
if not jar.exists():
    raise CKExtractionError(f"CK jar was not found at {jar}.")
```

`run_scan` catches it in its broad `except Exception`, writes phase `error` and the message
*"The repository could not be analysed."* onto the attempt row, and moves on. **The user sees a
scan that failed for no stated reason.** The real cause is only in the worker log.

**Nobody has noticed because the tests cannot see it.** `tests/unit/extractors/test_ck_metrics.py`
has two tests and both are structurally blind to this:

| Test | What it does | Why it cannot catch this |
|---|---|---|
| `test_ck_csv_is_aggregated_per_file` | `jar.touch()` — an **empty file** — then monkeypatches `subprocess.run` to write the CSVs itself | Java never runs. It proves the CSV aggregation, not that CK exists |
| `test_missing_ck_jar_has_a_clear_failure` | Passes a path that does not exist and asserts the error message | It proves the failure is *well-worded*. It never asks whether the real jar is present |

Both pass `ck_jar=` explicitly, so **neither reads `settings.ck_jar`** and neither ever looks at
`/opt/ck/`. The one thing that would catch it — "does the built image contain a runnable CK?" — is
not asked anywhere. CI is green and proves nothing about this.

Worth fixing alongside Step 2: a single smoke test that runs `java -jar $CODESAGE_CK_JAR` inside
the built image would have turned this into a red tick on 20 August.

`apps/api/vendor/README.md` also says to fetch the jar from
`github.com/mauricioaniche/ck/releases`. **That page is empty** — the project publishes tags but
no release assets (`gh api repos/mauricioaniche/ck/releases` → `[]`). The jar lives on Maven
Central instead.

**The fix is Step 2.**

#### Finding 2 — `CODESAGE_MIGRATION_DATABASE_URL` is missing from `apps/api/.env.example`

Every other setting is there. This one is not, and it is the one Step 5 needs. §9 of the team
plan says that file is the checklist that makes redeploying-from-scratch possible — a missing row
is exactly the failure it exists to prevent. Its absence has already caused one bug: J0.4,
Entry 2. Add it.

#### Finding 3 — nothing in the API calls the ML service

`detection/satd/client.py` (ML-1) is fully written. `detection/risk/client.py` (ML-2) is
`raise NotImplementedError`. **Neither is imported by the scan pipeline:**

```bash
grep -rEn "detection\.satd|detection\.risk" apps/api/src/codesage_api/tasks/
# → no matches
```

`scan_pipeline.py` imports `detection.rules.engine` and nothing else from `detection/`. Its own
docstring describes a stage 3 that runs "ML-1 and ML-2" — that stage was never wired up.

So deploying `ml` gives a service that answers correctly and that **nothing ever asks**. It is
still worth deploying (Step 4 says why), but be honest about what it buys.

---

### Step 1 — Fix the required checks on the existing ruleset (J0.8)

> **Correction, 26 Aug 2026.** An earlier draft of this entry said branch protection was never
> set up. **That was wrong**, and the mistake is worth recording because it is easy to repeat:
> `gh api repos/{owner}/{repo}/branches/main/protection` returns `404 Branch not protected` even
> when a **ruleset** is active and enforcing. That endpoint only reports *classic* branch
> protection. Rulesets live at `gh api repos/{owner}/{repo}/rulesets`. **A 404 from the classic
> endpoint is not evidence that `main` is unprotected.**

#### What is already in place

Ruleset **`main-branch-protection-with-packages`** (id `21084626`), created 20 Aug 2026,
`enforcement: active`, targeting `~DEFAULT_BRANCH`, with **no bypass actors** — nobody, including
the repository owner, can merge around it.

| Rule | Setting | Verdict |
|---|---|---|
| `deletion` | on | ✅ `main` cannot be deleted |
| `non_fast_forward` | on | ✅ no force-pushes to `main` |
| `pull_request` | `required_approving_review_count: 1` | ✅ one human approval, as intended |
| | `require_extra_approval_for_unattributed_changes: true` | ✅ |
| | `dismiss_stale_reviews_on_push: false` | ⚠️ see below |
| `required_status_checks` | `strict_required_status_checks_policy: true` | ✅ a branch must be current with `main` before merging |
| | 4 contexts required | ⚠️ **this is the defect** |

#### The defect: one of the four required contexts is ambiguous

The required contexts are:

```
web — tests, types, contract, lint      ✅ static, unique
api — tests, layer check                ✅ static, unique
ml — tests                              ✅ static, unique
images — build                          ⚠️ ONE name, THREE check runs
```

`images` is a three-leg matrix (`web`, `api`, `ml`) and every leg reported under the *same* name.
When several check runs share a name, GitHub resolves the requirement against one of them — so a
**failing `ml` image build could sit behind a passing `web` image build and the merge would still
be allowed.** The gate looks green and is not.

It was also fragile in a second way: the name was built from an expression that appended
`" and publish"` on `main`, so the check was called `images — build` on a pull request and
`images — build and publish` on `main`. Requiring the `main` spelling would have blocked every
pull request forever.

**Both are fixed by the one-line change already made to `.github/workflows/ci.yml`:**

```diff
   images:
-    name: images — build${{ github.event_name == 'push' && ' and publish' || '' }}
+    name: images — ${{ matrix.name }}
```

Three static, unique names — `images — web`, `images — api`, `images — ml` — identical on a pull
request and on `main`, each naming the folder that failed.

#### One PUT does it, and the ordering trap is avoidable

An earlier draft of this step prescribed a three-move dance — drop the images context, merge the
rename, add the three new ones back — because `images — build` stops existing the moment the
rename merges, and a name that does not exist blocks every pull request forever.

**That dance is unnecessary.** The rename pull request *itself* produces `images — web`,
`images — api` and `images — ml`, so requiring all six **while that pull request is open** is
satisfied immediately by its own run. One PUT, no window in which `main` is under-protected.

The three folder jobs keep their names throughout, so they never stop being enforced.

#### The command

```bash
RS="$LOCALAPPDATA/Temp/rs.json"
gh api repos/JPabasara/CodeSage-AI/rulesets/21084626 > "$RS"

RS_WIN="$RS" python - <<'PY'
import json, os, subprocess

CORRECT = [
    "web — tests, types, contract, lint",
    "api — tests, layer check",
    "ml — tests",
    "images — web",
    "images — api",
    "images — ml",
]

rs = json.load(open(os.environ['RS_WIN'], encoding='utf-8'))
for rule in rs['rules']:
    if rule['type'] == 'required_status_checks':
        rule['parameters']['required_status_checks'] = [
            {"context": c, "integration_id": 15368} for c in CORRECT
        ]

body = {k: rs[k] for k in ('name','target','enforcement','conditions','rules','bypass_actors')}
payload = json.dumps(body, ensure_ascii=True)
assert payload.isascii()

subprocess.run(['gh','api','-X','PUT','repos/JPabasara/CodeSage-AI/rulesets/21084626',
                '--input','-'], input=payload.encode('ascii'), check=True)
PY
```

`integration_id: 15368` is GitHub Actions, matching the contexts that were already there. It pins
each requirement to a check reported by Actions, so no other app can satisfy it.

#### ⚠️ Two encoding traps that cost an hour on 26 Aug — do not repeat them

Both bit while doing exactly this, and both are invisible until a pull request hangs.

**1. `/tmp` is not shared between Git Bash and Windows Python.** `gh ... > /tmp/rs.json` in MINGW
writes somewhere Windows Python cannot open, and the script dies with `FileNotFoundError`. Use
`$LOCALAPPDATA/Temp`, as above.

**2. `json.load(open(path))` decodes as cp1252 on Windows, not UTF-8** — and **every one of our
check names contains an em dash**. `—` (UTF-8 `e2 80 94`) is read as `â€"`, and writing that back
stores the double-encoded `c3 a2 e2 82 ac e2 80 9d`. The result: three required checks under names
no job will ever report, and a pull request stuck on *"Expected — Waiting for status to be
reported"* with every real check green.

**Why it was not obvious.** Printing the mangled string to a cp1252 console encodes `â€"` straight
back to `e2 80 94`, which the terminal renders as `—`. It reads as correct on screen while being
wrong in the API. Checking it by eye confirms nothing.

Two habits close both off:

- read with `encoding='utf-8'` explicitly, and **rebuild the context list from literals** rather
  than repairing strings that may already be mangled;
- send the body as `json.dumps(body, ensure_ascii=True).encode('ascii')`, so the payload is pure
  ASCII with `—` escapes and no stdin encoding can touch it.

**Verify at the byte level, never by printing:**

```bash
RS="$LOCALAPPDATA/Temp/rs.json"
gh api repos/JPabasara/CodeSage-AI/rulesets/21084626 > "$RS"
python -c "
import os
raw = open(os.environ['LOCALAPPDATA']+'/Temp/rs.json','rb').read()
print('corrupted:', b'Ã¢â¬â' in raw)
print('correct:  ', b'â' in raw)"
```

Expect `corrupted: False` and `correct: True`.

#### Confirm the pull request actually unblocked

```bash
gh pr view <n> --json mergeStateStatus,reviewDecision
```

`CLEAN` means every rule is satisfied. **`BLOCKED` while all checks are green and the review is in
is not a stale cache** — that was the first guess on 26 Aug and it was wrong. It means a required
context name does not match any check being reported. Compare the two lists byte for byte:

```bash
gh api repos/JPabasara/CodeSage-AI/rulesets/21084626   --jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context'
gh pr view <n> --json statusCheckRollup --jq '.statusCheckRollup[].name'
```

#### One setting worth changing while you are here

`dismiss_stale_reviews_on_push: false` means **an approval survives any later push to the branch.**
Someone approves a one-line change, more commits land, and it merges on the strength of a review
of code nobody read. With `require_last_push_approval` also `false`, nothing catches it.

Turning it on costs a re-approval whenever a branch changes after review, which on a three-person
team is a small price:

```bash
gh api repos/JPabasara/CodeSage-AI/rulesets/21084626 > /tmp/rs.json

python - <<'PY'
import json, subprocess
rs = json.load(open('/tmp/rs.json'))
for rule in rs['rules']:
    if rule['type'] == 'pull_request':
        rule['parameters']['dismiss_stale_reviews_on_push'] = True
body = {k: rs[k] for k in ('name', 'target', 'enforcement', 'conditions', 'rules', 'bypass_actors')}
subprocess.run(['gh', 'api', '-X', 'PUT',
                'repos/JPabasara/CodeSage-AI/rulesets/21084626',
                '--input', '-'], input=json.dumps(body), text=True, check=True)
PY
```

#### Know this before Step 6

**One required approval and no bypass actors means `main` moves only when a second person is
available.** That is the correct setting and it should stay — but under auto-deploy it also means
a production hotfix needs someone else awake. If that ever bites during the evaluation window, the
fix is to add yourself as a **bypass actor** (`Settings → Rules → main-branch-protection-with-packages`),
use it, and remove it afterwards — deliberately, and visibly, rather than by weakening the rule
permanently.

---

### Step 2 — Put the CK jar into the image (J4.1) — **DONE 26 Aug 2026**

The jar must not go into git — 16 MB of build output, and the `.gitignore` rule is right. It is
instead **fetched during the build**, pinned and checksummed, so CI, a laptop and Railway all get
identical bytes and there is nothing to remember to do.

#### What changed

| File | Change |
|---|---|
| `apps/api/Dockerfile` | `# syntax=docker/dockerfile:1.7` as line 1; `COPY vendor/ /opt/ck/` replaced by a pinned, checksummed `ADD`; a `RUN` that executes CK and greps its usage line |
| `apps/api/.dockerignore` | `vendor/` excluded — nothing copies it now, and a hand-downloaded jar would put 16 MB back into every build context |
| `apps/api/vendor/README.md` | Rewritten. Its download instructions pointed at an empty releases page, and the folder is no longer read by the build |

```dockerfile
# syntax=docker/dockerfile:1.7      ← MUST be line 1. A comment above it and Docker
                                    #  silently ignores it, and --checksum stops working.
ENV CODESAGE_CK_JAR=/opt/ck/ck.jar
ADD --chmod=0644 --checksum=sha256:2ddfdc275b6b59c2033e03253c4fec511c338fe494a10b70f651bc039a72c74d     https://repo1.maven.org/maven2/com/github/mauricioaniche/ck/0.7.0/ck-0.7.0-jar-with-dependencies.jar     /opt/ck/ck.jar

RUN java -jar "$CODESAGE_CK_JAR" 2>&1 | grep -q "^Usage java -jar ck.jar"
```

Three details, each of which was checked rather than assumed:

- **`--chmod=0644`.** `ADD` defaults to **0600, root-only**. This image has no `USER` directive so
  root reads it either way — but the `web` image already runs as a non-root user, and the day
  anyone hardens this one the same way, a 0600 jar becomes an unreadable jar and every scan fails
  on a permission error that looks nothing like its cause.
- **The `RUN` smoke test cannot use the exit code.** CK with no arguments prints its usage and
  **exits 1**. So the assertion is `grep`, whose status is the pipeline's, and which only succeeds
  on the real usage line. This proves the JRE can *execute* the jar, not merely that a file of the
  right size landed.
- **Maven Central, not GitHub.** `gh api repos/mauricioaniche/ck/releases` returns `[]` — the
  project publishes tags but no release assets. A Maven Central coordinate is immutable, so version
  + digest means the build gets exactly this file or fails.

#### Verified, not assumed

| Check | Result |
|---|---|
| `docker build apps/api` | Succeeds |
| `ls -l /opt/ck/ck.jar` in the built image | `-rw-r--r-- root root 16052728` |
| `sha256sum` in the image | `2ddfdc27…72c74d` — matches the pin exactly |
| `java -jar $CODESAGE_CK_JAR` in the image | Prints CK's usage line — the JRE runs it |
| `vendor/README.md` inside the image | **Absent** — `/opt/ck/` holds only `ck.jar` |
| **A wrong checksum fails the build** | Built a throwaway Dockerfile with a zeroed digest → `ERROR: failed to solve: digest mismatch`, exit 1. **The gate genuinely gates** |

That last row is the one that matters. An unverified pin is decoration; this one was made to fail
on purpose, once, so we know it can.

#### Still owed

`AnalysisEngineVersion.ck_version` should record `"0.7.0"`, the same string the Dockerfile pins.
Without it, REL-10's *"same revision, consistent results"* is a claim nothing can check —
historical snapshots would be silently incomparable across a CK bump. **Chamodh**, one field.

#### Commands

```bash
docker build -t api-ckcheck apps/api
docker run --rm --entrypoint sh api-ckcheck -c 'ls -l /opt/ck/ck.jar && sha256sum /opt/ck/ck.jar'
docker run --rm --entrypoint sh api-ckcheck -c 'java -jar "$CODESAGE_CK_JAR" 2>&1 | head -1'
docker rmi api-ckcheck
```

Expect 16,052,728 bytes, the digest above, and CK's usage line.

---

### Found while verifying Step 2 — `main` could not migrate at all

Not a deployment change, but it blocked Step 2's end-to-end check and it was broken **on `main`**,
for everyone, so it belongs in the record.

`docker compose up -d` on a clean volume failed at the `migrate` service, exit 255:

```
UserWarning: Revision 20260825_0002 is present more than once
FAILED: Multiple head revisions are present for given argument 'head'
```

**Cause.** Two pull requests each added a migration and each numbered it `20260825_0002`:

| File | Came in with |
|---|---|
| `20260825_0002_membership_definer_lookup.py` | [#83](https://github.com/JPabasara/CodeSage-AI/pull/83) `fix/login/freeze` |
| `20260825_0002_seed_security_rules.py` | [#81](https://github.com/JPabasara/CodeSage-AI/pull/81) `integrate/repo-health` |

Both were green. Both merged. Neither conflicted, because they are *different files* — git had no
reason to object. The collision is in a value *inside* them, and git does not read revision ids.

**Why CI did not catch it.** The backend tests build their schema from ORM metadata, not by
running the migration chain, so a broken chain is invisible to them. It surfaces only when someone
actually migrates — a teammate on a clean clone, or the Railway pre-deploy command in Step 5. From
the outside it reads as a database outage.

**The fix — renumbered into a line:**

```
20260812_0001  complete_erd
20260825_0002  membership_definer_lookup     ← deliberately left alone
20260825_0003  seed_security_rules           ← was 0002
20260825_0004  repository_metadata           ← was 0003
```

**`membership_definer_lookup` keeps `0002` on purpose.** It is the live sign-in fix, so it is the
one most likely already applied to Neon. Renumbering an *applied* revision leaves the database's
`alembic_version` pointing at an id no file declares, and the next migration fails with something
far more confusing than this. The two that moved both landed on 26 Aug and are almost certainly
nowhere yet.

Safe to reorder because they are independent: the membership migration touches `membership`, the
other two touch `process_metric`, `rule_definition` and `repository`. Both moved migrations also
guard their DDL with `inspect()` checks and use `ON CONFLICT DO NOTHING`, so re-running them is a
no-op rather than an error.

**Verified after the fix:**

```
Running upgrade 20260812_0001 -> 20260825_0002, Let the sign-in workspace lookup see MEMBERSHIP.
Running upgrade 20260825_0002 -> 20260825_0003, Align process facts and seed security rules.
Running upgrade 20260825_0003 -> 20260825_0004, Add repository metadata.

alembic_version = 20260825_0004      27 tables      all six containers healthy
/api/healthz 200   ·   /api/projects 401 signed out   ·   /  307 → /login
```

#### The fix un-skipped the six RLS tests — and two of them were broken

**This is the good news buried in the incident.** Entry 3 flagged, under *"the most important thing
on this page"*, that six Row-Level Security tests reported as **skipped** while the suite showed
green. Those tests are the ones proving one workspace cannot read another's data.

`tests/integration/test_rls.py` builds its schema by running the real migrations —
`command.upgrade(config, "head")` against a throwaway Postgres container. With two heads on `main`
that call raised, the fixture gave up, and the tests skipped. **The chain being broken was hiding
the security suite.**

Repairing the chain made them run for the first time, and CI immediately went red — correctly. Two
genuine defects, neither related to the migration numbering:

**1. `NotNullViolation` on `theme_preference`.**

```
null value in column "theme_preference" of relation "app_user" violates not-null constraint
```

The column is `nullable=False` with `default=Theme.SYSTEM` — an **ORM-level** default, not a
`server_default`. SQLAlchemy fills it in only when a row is inserted through the ORM; this test
uses raw SQL, which goes straight past it. `test_database_constraints.py` already passes
`"theme_preference": "system"` for exactly this reason. Fixed by spelling it out.

> **Worth Chamodh's judgement:** a `NOT NULL` column whose only default lives on the mapping is a
> trap for every raw statement — migrations, backfills, `psql`. Adding
> `server_default=text("'system'")` and a one-line migration would close it at the database. Not
> done here, because it changes the schema and `apps/api` is his.

**2. `permission denied for function app_workspace_for_user`.**

The initial migration deliberately locks that function down:

```sql
REVOKE EXECUTE ON FUNCTION app_workspace_for_user(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION app_workspace_for_user(uuid) TO codesage_app;
```

But the fixture connects as `codesage_rls_test_app`, a *different* role, and hand-granted itself
table privileges only. So the test role had a privilege set the real deployment does not have, and
lacked one it does.

Fixed with `GRANT codesage_app TO codesage_rls_test_app` — membership, so the fixture inherits
whatever the migration grants, now and later, rather than maintaining a second copy of production's
grant list that drifts from it.

**Verified locally:** `8 passed` in `test_rls.py` — running, not skipping — and `112 passed,
2 xfailed` for the whole suite, with `lint-imports` reporting 3 contracts kept, 0 broken.

#### The guard, added to CI

`.github/workflows/ci.yml`, in the `api` job, immediately after Install:

```yaml
- name: Migration chain has exactly one head
  run: |
    out="$(alembic heads 2>&1)"
    echo "$out"
    if printf '%s' "$out" | grep -q "present more than once"; then
      echo "::error::Two migrations declare the same revision id."
      exit 1
    fi
    n="$(alembic heads 2>/dev/null | grep -c .)"
    if [ "$n" -ne 1 ]; then
      echo "::error::Expected exactly one Alembic head, found $n."
      exit 1
    fi
```

`alembic heads` reads the versions directory and opens no database connection, so it needs no
services and costs a fraction of a second.

**Both failure modes were reproduced before trusting it**, by dropping a throwaway migration into
`alembic/versions/` and deleting it again:

| Injected | `alembic heads` | Caught by |
|---|---|---|
| A second migration with the same `down_revision` | 2 lines | the count check |
| A second migration with the same **revision id** — the real bug | 2 lines **and** `present more than once` | both checks |

A guard that has never been made to fail is a guess.

> **This is the second time on this page that a green tick proved nothing.** The other is the CK
> jar (Finding 1). Both have the same shape: CI checked what the code *says* and never checked what
> the artefact *does*. Worth remembering when adding the next check.

---

### Step 3 — Deploy `worker` (J4.2)

The service still exists on Railway with its variables and settings intact — Entry 4 removed the
*deployment*, not the service. If it is still there this is a Redeploy plus new variables. If it
was deleted, create it from the table below.

| Setting | Value |
|---|---|
| Image | `ghcr.io/jpabasara/codesage-ai/api:latest` — **the same image as `api`** |
| Start command | `celery -A codesage_api.worker worker --loglevel=INFO --concurrency=1` |
| Domain, port, health check | **none** — it serves no HTTP |
| Volume | **none.** Clones are throwaway scratch; paid storage is for the database only (§9) |

⚠️ **The variable list in team plan §6a Step 7 is now out of date.** It says *"only
`CODESAGE_DATABASE_URL` and `CODESAGE_REDIS_URL`. Nothing else is needed."* That was true when
every task was a stub. A worker that really clones and analyses needs more:

```
CODESAGE_DATABASE_URL=postgresql+psycopg://codesage_app:PASS@ep-xxxx-pooler.region.aws.neon.tech/neondb?sslmode=require
CODESAGE_REDIS_URL=rediss://...upstash.io:6379?ssl_cert_reqs=required
CODESAGE_ML_SERVICE_URL=http://ml.railway.internal:8001
CODESAGE_ML_TIMEOUT_SECONDS=30
CODESAGE_GITHUB_TOKEN=<a read-only PAT>
CODESAGE_LOG_LEVEL=INFO
```

Four notes on those:

- **`CODESAGE_CLONE_DIR` and `CODESAGE_CK_JAR` are deliberately absent.** Both are `ENV` lines in
  the Dockerfile, so the image already carries the right values. Setting them here would only
  create a second place to get them wrong.
- **`CODESAGE_ML_SERVICE_URL` is Railway's private address**, and it only works after Step 4.
  Until then leave it unset: the default `http://localhost:8001` fails fast, which is exactly the
  degraded mode the pipeline is designed around.
- **`?ssl_cert_reqs=required`** on the Redis URL. Without it Celery warns *"Secure redis scheme
  specified (rediss) with no ssl options"* and does not verify the certificate (Entry 4).
- **`CODESAGE_GITHUB_TOKEN`** is optional but wanted: it lifts the anonymous GitHub rate limit
  from 60 requests/hour, which a demo can exhaust. A classic PAT with **no scopes ticked** —
  public repository metadata needs no permission at all.

**Memory.** A clone plus CK plus PyDriller on a real repository is not small. Start at **1 GB**
and watch the first real scan. Railway kills a container that exceeds its limit and the scan dies
with it, which looks exactly like a code bug and is not one.

**Concurrency stays at 1.** Each scan needs its own clone and its own ~2 GB. PERF-07's three
concurrent analyses is `--scale worker=3` locally and a replica count on Railway — a dashboard
number, not a code change. Do **not** raise `--concurrency` instead; that puts three clones inside
one container's disk.

**Done when:** the worker's deployment log shows `celery@… ready` and a connection to Upstash
rather than a retry loop.

---

### Step 4 — Deploy `ml` (J4.3)

**Read Finding 3 first.** Nothing calls this service today. Deploy it anyway, for three reasons
worth being able to say out loud:

1. It is one of the four containers in the SAD's deployment view. A deployment view that does not
   match the deployment is a defect in the document, not a detail.
2. It proves the image CI publishes actually runs somewhere other than a laptop — which is the
   entire point of §5.
3. The moment Chamodh wires stage 3 into `scan_pipeline.py`, the address is already there and
   already correct. Nobody has to deploy anything under pressure.

| Setting | Value |
|---|---|
| Image | `ghcr.io/jpabasara/codesage-ai/ml:latest` |
| Port | `8001` |
| Health check path | `/healthz` |
| Public domain | **none** — workers reach it privately |
| Start command | `uvicorn codesage_ml.main:app --host :: --port 8001` |
| Variables | none required |

⚠️ **The start-command override is not optional, and it is the thing that will cost an hour if it
is missed.** Railway's private network is **IPv6-only**. The image's own `CMD` binds
`--host 0.0.0.0`, which is IPv4 — so the service starts, its health check may even pass, and every
call from the worker to `ml.railway.internal` is refused. Binding `::` accepts both, so nothing
else has to change. *(Confirm against Railway's current private-networking docs before blaming the
code — if they have changed this, the plain image works as-is.)*

**Do not attach a volume for `/models`.** The image declares `VOLUME ["/models"]` and
`CODESAGE_ML_ARTIFACT_DIR=/models`, and `apps/ml/models/` in git holds only `.gitkeep` — trained
artifacts are gitignored (`models/*.joblib`). So on Railway that directory is empty, and:

| Endpoint | Behaviour with no artifact |
|---|---|
| `GET /healthz` | `{"status":"ok"}` |
| `GET /version` | answers, reporting `v1.0` / `mock-1.0.0` |
| `POST /classify` | **falls back to `_FallbackPipeline`** in `registry.py` — a keyword matcher on "todo", "fixme", "doc", "test". Not the trained model |
| `POST /risk` | returns **deterministic pseudo-random numbers** seeded on the file path, tagged `mock-1.0.0` |

That is not a failure — `load_satd_model()` is written to degrade this way on purpose. But
**`/classify` answering 200 does not mean the trained model is deployed.** Read `model_version` in
the response body, not the status code.

Getting the real SATD model up there is a separate job: train from `apps/ml/training/satd`,
produce `satd_v1.joblib`, and put it somewhere the container can read — a Railway volume mounted
at `/models`, or baked into a variant image. **Nathasha's call, and it needs
[model-evaluation-notes.md](model-evaluation-notes.md) read first**, because the first training
run's numbers were not real. Not a Phase 4 step.

Once `ml` is up, set `CODESAGE_ML_SERVICE_URL=http://ml.railway.internal:8001` on **`worker`** —
not on `api`, which never performs inference — and raise `CODESAGE_ML_TIMEOUT_SECONDS` back to
`30` from the `5` that Phase 1 set while `ml` was absent.

> **A bug to hand to Chamodh while you are in there.** `detection/satd/client.py` calls
> `httpx.post(url, json=payload, timeout=30.0)` — a hardcoded literal. It never reads
> `settings.ml_timeout_seconds`, so the variable we set on Railway does nothing for the one call
> it was added for. One line.

---

### Step 5 — Make migrations part of the deploy (J4.4)

Today `alembic upgrade head` runs from a laptop. Under auto-deploy that is a bug waiting to
happen: merge a migration, the new code deploys in three minutes, and it queries a column that
does not exist.

**Use Railway's pre-deploy command on the `api` service.** It runs to completion *before* the new
version takes traffic, so a failed migration aborts the deploy instead of half-applying itself
underneath a live site.

| Setting | Value |
|---|---|
| Pre-deploy command (`api` service **only**) | `alembic upgrade head` |

Then add the variable that command needs, which the `api` service does **not** currently have:

```
CODESAGE_MIGRATION_DATABASE_URL=postgresql+psycopg://codesage_owner:PASS@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require
```

Three things about that line, every one of which has already cost this project time:

1. **The `-pooler` host must NOT be used here.** Alembic needs a connection of its own; the pooler
   is for the API's many short requests. Use the direct endpoint — the same one Phase 1 step 5
   used.
2. **`postgresql+psycopg://`, never `postgresql://`.** The image ships psycopg 3; the bare prefix
   makes SQLAlchemy load psycopg2, which is not installed. Entry 4, fault 2.
3. **End the URL at `?sslmode=require`.** Entry 4, fault 1 — an `&` was lost and the resulting
   `channel_binding` value killed the process on its first query.

**`codesage_owner`, not `codesage_app`** — and that is the whole reason two roles exist.
`codesage_app` cannot create tables and must not be able to, because Row-Level Security is
silently ignored for a table's owner.

**Do not put the pre-deploy command on `worker`.** Both services run the same image, and two of
them racing `alembic upgrade head` against one database is a lock fight for no benefit.

Add the row to `apps/api/.env.example` too (Finding 2), so the checklist is true again.

---

### Step 6 — Auto-deploy on `main` (J4.5)

> §10 of the team plan puts a condition on this and it is worth repeating: **do it *after* the
> first manual deploy works.** It does — Entries 1–4 are that. Automating something nobody has
> done by hand only hides the failure.

**Not** by pointing Railway at the GitHub repository. That makes Railway build the code itself,
which throws away the images CI publishes and means the thing deployed is not the thing that was
tested. The whole of §5 is that the artefact CI built is the artefact that runs.

So: CI publishes the images, then tells Railway to pull them.

#### 6a — A Railway token, as a repository secret

The repository currently has **no secrets at all** (`gh secret list` → empty). Create a **project
token** in Railway (project → Settings → Tokens), scoped to the `production` environment, then:

```bash
gh secret set RAILWAY_TOKEN
```

A *project* token, not a personal one: it can only touch this project, and it does not stop
working when a person rotates their own credentials or leaves.

#### 6b — A `deploy` job at the end of `.github/workflows/ci.yml`

```yaml
  # ── Deploy (J4.5) ──────────────────────────────────────────────────────────
  # Runs ONLY on main, and only after the images it deploys actually exist.
  # Every service runs `:latest` from GHCR, so a redeploy re-pulls the image the
  # `images` job has just published.
  deploy:
    name: deploy — Railway
    runs-on: ubuntu-latest
    needs: [images]
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    # A GitHub Environment, so the token is scoped to it and every deploy is
    # listed on the repository's Deployments tab — a free audit trail.
    environment: production
    env:
      RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
    steps:
      - name: Install the Railway CLI
        run: npm i -g @railway/cli

      # api FIRST and alone: its pre-deploy command runs `alembic upgrade head`,
      # and the schema must be migrated before a worker starts reading it. If
      # this step fails the ones below never run — which is the point.
      - name: Deploy api (runs migrations)
        run: railway redeploy --service api --yes

      - name: Deploy worker
        run: railway redeploy --service worker --yes

      - name: Deploy web
        run: railway redeploy --service web --yes

      # ml has no schema dependency and nothing calls it yet, so a failure here
      # must not paint the whole deploy red.
      - name: Deploy ml
        continue-on-error: true
        run: railway redeploy --service ml --yes
```

Add `deployments: write` to the workflow's top-level `permissions:` block if you keep the
`environment:` key.

⚠️ **Verify the CLI flags before trusting this.** `railway redeploy --service <name> --yes` is the
documented shape, but Railway's CLI moves. Run `railway redeploy --help` once, locally, and fix
the job to match — rather than debugging it through five pushes to `main`.

⚠️ **And verify the redeploy actually re-pulls.** A service pinned to `:latest` should resolve a
fresh digest on redeploy, but "should" is not "does". After the first automatic deploy, open the
`api` deployment log and confirm the pulled **digest** differs from the previous deployment's. If
it does not, pin the services to the immutable tag instead — CI already publishes
`type=sha,format=long`, so `ghcr.io/jpabasara/codesage-ai/api:sha-<commit>` always exists — and
change the job to set each service's image rather than redeploy it.

#### 6c — GHCR must be pullable

Packages published by Actions default to **private**. `api` and `web` already deploy from GHCR so
this is solved for those two, but **confirm `ml` is the same before Step 4** — otherwise the
service sits in `Deploying` with an authentication error that reads like a network problem.

Repository → Packages → each package → Package settings → visibility public, *or* give Railway a
GHCR pull credential.

---

### Step 7 — Verify, in this order (J4.6)

Not "it looks up". Each of these can pass while the next one fails.

| # | Check | Expected |
|---|---|---|
| 1 | `https://api.codesageai.dev/api/healthz` | `{"status":"ok"}` |
| 2 | `https://api.codesageai.dev/api/projects` **in a private window** | **401** `NOT_AUTHENTICATED`. Never skip this — a 200 here means every workspace's data is readable by anyone with the address |
| 3 | Sign in at `https://codesageai.dev` | Lands on `/projects` and the list loads. No 401 — J2.7 fixed that |
| 4 | Worker deployment log | `celery@… ready`, connected to Upstash |
| 5 | Connect a small **Java** repository and press Scan | Progress moves **past 25%**. 25% is where the CK step begins — a failure there means Step 2 did not take |
| 6 | The scan reaches `done` | A snapshot exists and the dashboard renders a grade |
| 7 | From the worker container, `GET http://ml.railway.internal:8001/healthz` | `{"status":"ok"}` — proves Step 4's IPv6 bind |
| 8 | Merge a trivial commit to `main` | CI goes green, the `deploy` job runs, and the Railway deployment log shows a **new image digest** |

Check 5 is what this whole entry exists for. Use a **Java** repository: v1.0 analyses Java only
(`analysed_extensions` is `[".java"]`), so a Python repository scans successfully and finds
nothing — which looks like a bug and is not one.

---

### Money

Entry 4 measured ~25¢/day for `api` + `web` + `worker`. Four containers running continuously is
roughly **$12–20/month**, matching §9's estimate.

The spending cap stays at **$15**, and it is a safety net, not a budget. Control the money by
controlling *when things run*, never by lowering the cap — a hard limit reached mid-demo stops the
services.

The cheapest honest arrangement for the run-up to the evaluation:

- `api` and `web` — **up**, continuously. The site has to answer.
- `worker` — **up** from now on. It is no longer dead weight; it *is* the scan.
- `ml` — **start it for the demo, stop it afterwards.** Nothing calls it (Finding 3), so it is the
  one container whose absence changes nothing.
- **Do not enable Serverless / App Sleeping before the evaluation.** A first request that takes
  several seconds to wake reads as "the site is broken".

---

### What Phase 4 does *not* fix

Better said out loud than asked about:

| Still true after Phase 4 | Whose |
|---|---|
| `GET /api/profiles`, `GET /api/profiles/active`, `PUT /api/profiles/active` are `raise NotImplementedError` → **501**. The Profiles screen works only against MSW | Chamodh |
| `/readyz` and `/version` are stubs → **501** (`install_exception_handlers` turns `NotImplementedError` into the contract envelope). Still never a health-check target | Chamodh |
| ML-1 and ML-2 are not wired into the scan pipeline (Finding 3) | Chamodh |
| `detection/risk/client.py` is `raise NotImplementedError` | Chamodh |
| The deployed `ml` answers `/classify` from a keyword fallback, not the trained model | Nathasha |
| Playwright never runs in CI — the `web` job runs `pnpm test:run`, which is vitest only. The end-to-end suite is a local gate | Janidu |
| `ruff` is advisory on `apps/api` (31 findings, Entry 3) | Chamodh |
| Six RLS tests still skip, because the test database never runs `01-init.sql` (Entry 3) | Chamodh |

---

## Entry 4 — 20–21 Aug 2026 — Phase 1 (deploy) — **COMPLETE**

**Plan reference:** §6, Phase 1 (J1.1–J1.15) and the step-by-step guide in §6a.

**Status: J1.1–J1.15 done and verified. Phase 1 is closed.** The live path works end to end:
sign-in completes, a user row exists in Neon, and the browser lands on `/projects`.

> **Read this before you "fix" anything here.** The Projects page loads and then shows
> *"Couldn't load projects: 401"*. **That is correct behaviour at the end of Phase 1, not a
> fault.** The explanation is in [The 401 that is supposed to happen](#the-401-that-is-supposed-to-happen)
> below. Do not change CORS, cookie or Railway settings to chase it — they are all correct.

### What is live

| | Address |
|---|---|
| Site | `https://codesageai.dev` |
| Backend | `https://api.codesageai.dev` |
| Database | Neon, `ap-southeast-1`, 27 tables |
| Broker | Upstash Redis, `ap-southeast-1` |
| Services | Railway `codesageai/production` — `api`, `worker`, `web` in Singapore. `ml` deliberately not deployed |

### Verified, not assumed

| Check | Result |
|---|---|
| `GET /api/healthz` | `{"status":"ok"}` — J1.11 |
| `GET /api/projects` signed out | **401** `NOT_AUTHENTICATED` — J1.12 |
| `GET /api/auth/login` | 302 to Asgardeo, correct `client_id` and `redirect_uri`, PKCE S256 |
| Handshake cookie | `HttpOnly; Secure; SameSite=lax; Path=/api/auth` |
| **Sign-in on the live site** | **Completes. Lands on `/projects`, page renders — J1.13** |
| **`app_user` rows** | **Present. A real sign-in wrote one** |
| **`user_session` row** | **Live after sign-in** |
| **Sign out from the app rail** | **Ends the session** (it is the one frontend call that already sends the cookie) |
| `codesageai.dev` | 307 → `/projects` |
| Web image contents | `api.codesageai.dev` baked in, no `localhost:8000` |
| Neon grants | `codesage_app` has SELECT on all 27 tables; both RLS functions executable |
| Neon RLS | 17 tables, FORCE on, `tenant_isolation` policies present |
| `codesage_app` login | works on both pooled and direct endpoints |
| Worker → Upstash | `celery@… ready` |
| Spending cap | **$15 — J1.14** |

### The decision that shaped this phase: buying `codesageai.dev`

Registered at Spaceship, DNS on Spaceship (its Advanced DNS Manager flattens a `CNAME` at the apex,
so no Cloudflare was needed). Two effects, both worth knowing:

**1. It removed a bug we would otherwise have had to fix in `apps/api`.** Every `*.up.railway.app`
address is a separate *site* to a browser, because that suffix is on the public suffix list. Our
session cookie is `SameSite=Lax`, so a frontend on one Railway address would never have sent it to a
backend on another — sign-in would succeed and every subsequent request would return 401.
`codesageai.dev` and `api.codesageai.dev` are the same site, so `Lax` works and
`routers/auth.py` needs no change.

**2. It let the web image be built once, correctly.** The API address is frozen in at build time, so
without a domain we would have had to deploy, wait for Railway to invent an address, rebuild, and
redeploy. Instead `WEB_API_BASE_URL` was set in GitHub first and the image built with the real
address before anything was deployed.

Railway's **Hobby plan is required, not optional**: the Trial plan allows 1 custom domain in total
and we need two. Hobby allows 2 per service.

### What J1.13 was stuck on, and what fixed it

Three separate faults, each producing the *same* outward symptom — a deployment that fails its
healthcheck while the service still shows Online and `/api/healthz` still returns 200.

| # | Last line of the traceback | Cause | Fix |
|---|---|---|---|
| 1 | `invalid channel_binding value: "('requiresslmode=require', 'require')"` | the `&` between query parameters was lost | end the URL at `?sslmode=require` |
| 2 | `ModuleNotFoundError: No module named 'psycopg2'` | URL began `postgresql://`, so SQLAlchemy loaded its default driver; the image ships psycopg **3** | prefix must be `postgresql+psycopg://` |
| 3 | `SettingsError: error parsing value for field "cors_origins"` | `CODESAGE_CORS_ORIGINS` written as plain text | must be `["https://codesageai.dev"]` |

Fault 1 starts fine and fails on the first query. Faults 2 and 3 kill the process at **import**,
before uvicorn binds a port — which is why the healthcheck can never pass.

Once all three were corrected the `api` service started, sign-in completed on the first attempt, and
Neon showed the new `app_user` and `user_session` rows.

### The 401 that is supposed to happen

**Symptom:** you sign in, you land on `https://codesageai.dev/projects`, the page renders — and then
shows *"Couldn't load projects: 401"*.

**This is three different things, and only the last one fails:**

| | Result |
|---|---|
| Sign-in | works — a full page navigation, so the browser carries the cookie by itself |
| The `/projects` page | loads and renders |
| The page's background data call | **401** |

**Cause.** The session cookie is set on `api.codesageai.dev`; the page is served from
`codesageai.dev`. Those are different **origins**, and a browser leaves cookies out of a
cross-origin request unless the code asks for them. `apps/web/src/lib/api/client.ts` calls
plain `fetch(...)` with no options, so no cookie is sent, so `deps.get_current_user_id`
correctly refuses.

**This is J2.7 on the Phase 2 list** — add `credentials: "include"` to every request — and §6a
Step 10 already warns about it in writing. The session is real, the cookie is the right kind and on
the right site; nobody is sending it yet.

**Proof it is this and not a config fault:** open DevTools → Network → the `projects` request and
confirm it carries **no `Cookie` header**. If the cookie is absent from the *request*, no amount of
server-side CORS or cookie configuration can change the answer. Checked on the live site: the
`Cookie` header is absent and the response carries
`access-control-allow-origin: https://codesageai.dev`, so CORS is already correct.

**The wall behind this wall.** After J2.7 the same endpoint will return **500, not 200**, because
`routers/projects.py::list_projects` is still `raise NotImplementedError` — as is every other
business endpoint. That is Chamodh's C1.1. **401 → 500 is progress, not a regression.** Do not read
it as J2.7 having failed.

### Two things that cost time and should not cost it again

**A failed deployment leaves the previous container serving.** So "the URL still returns 200" proves
the *old* build is alive and says nothing about the change you just made. Trust the deployment
badge, not the URL.

**`/api/healthz` never touches the database** — deliberately, so a database blip cannot make an
orchestrator restart a healthy API. Sign-in is therefore the first request that opens a database
connection, and every database misconfiguration stays invisible until then.

### Smaller findings

- **TXT verification records need their leading underscore** (`_railway-verify.api`). Stripping it
  leaves the domain unverified and no certificate is issued.
- **"TCP Proxy" is not "Generate Domain".** A TCP proxy publishes a raw unencrypted `host:port`;
  both created ones were deleted.
- **Attach custom domains with an explicit port** — `api` → 8000, `web` → 3000. Otherwise the
  generated `*.up.railway.app` address works while the custom domain returns 502.
- **`web` needs `PORT=3000`.** It is the one runtime variable that image reads; everything else was
  frozen in at build time.
- **Celery warns** `Secure redis scheme specified (rediss) with no ssl options`. Appending
  `?ssl_cert_reqs=required` to `CODESAGE_REDIS_URL` silences it and turns certificate checking on.
- **`Failed to find Server Action "0000…"`** in the web logs is a browser holding a page from the
  previous deployment. Harmless; a hard refresh clears it.
- The `neondb_owner` password was pasted into a chat transcript during this work. **Rotated** on
  21 Aug (Neon → Reset password). See the open item below.
- **`worker` had nothing to do and was costing money.** Every Celery task
  (`tasks/scan_pipeline.py`, `tasks/progress.py`, `tasks/cancel.py`) is `raise NotImplementedError`,
  and `POST /api/repos/{id}/scan` is a stub too — so nothing can even enqueue a job. It was polling
  an empty Upstash queue and billing for memory. Stopped until Chamodh's Phase B lands.
- **Do not enable Railway's Serverless / App Sleeping before the evaluation.** It saves money by
  sleeping an idle service, but the first request then takes seconds to wake — during a live demo
  that reads as "the site is broken".

### Current state of the services

`worker` is **stopped**. `api` and `web` are **left running**.

This is a deliberate deviation from J1.15, which said to stop all three until the 23rd. That step
assumed a four-day idle gap. Phase 2 started on the 21st instead, and **J2.9 — "walk the whole path
on the live URL" — needs `api` and `web` up**. At the measured ~25¢/day for all three, stopping them
for two days saves about 50 cents and costs a restart cycle. `worker` is stopped because it is dead
weight regardless (see above), not to save the 50 cents.

**Stop a service without destroying it:** service → **Deployments** tab → ⋮ on the active
deployment → **Remove**. Compute billing stops; environment variables, custom domains, port mappings
and settings all survive. CLI equivalent: `railway link` then `railway down`.

**Never delete the *service*** — that takes the domains and variables with it. The action you want
is on the *deployment* row.

**Restart:** same Deployments tab → ⋮ → **Redeploy**. Use Redeploy on the existing deployment rather
than triggering a fresh build, or you get whatever is on the branch at that moment instead of the
image that was verified here.

### How to check it still works

After any restart, in this order:

1. `https://api.codesageai.dev/api/healthz` → `{"status":"ok"}`
2. `https://api.codesageai.dev/api/projects` **in a private window** → **401** `NOT_AUTHENTICATED`.
   Never skip this. A 200 here would mean every workspace's data is readable by anyone with the
   address.
3. `https://codesageai.dev` → sign in → you land on `/projects` and the page renders.
   *A 401 on the page's data is expected until J2.7 — see above.*
4. `https://codesageai.dev` returns a page, not a **502**. A 502 on the custom domain while the
   `*.up.railway.app` address works means the domain lost its explicit port.

### Phase 1 sign-off

| Step | Status |
|---|---|
| J1.1–J1.12 | Done and verified |
| J1.13 | **Done** — sign-in completes on the live site, user row in Neon |
| J1.14 | **Done** — spending cap at $15 |
| J1.15 | **Done, adapted** — `worker` stopped; `api` and `web` intentionally left up for Phase 2 J2.9 |

**Next: Phase 2 (§6b), J2.1 onward.** Where it actually stands, checked against the code rather than
assumed:

| # | Step | Status |
|---|---|---|
| J2.1 | `pnpm gen:types` | **Done** — `src/lib/types/api.ts` generated from `docs/api/openapi.yaml` |
| J2.2 | Rename every field to snake_case | **Not started** — `src/lib/types/index.ts` still has `latestHealth`, `codeDesign`, `scanId`, `repoId`, `commitSha`, `wMl` |
| J2.3 | Category filter: five chips, `defect` removed | **Done** — matches the contract enum exactly |
| J2.4 | Profiles page: five weights plus the trust slider | **Not started** — `weights` has 4 keys; the contract wants `CategoryWeights` (5) plus slider `s` |
| J2.5 | Add `cancelled` to the scan states | **Not started** — `ScanPhase` in `index.ts` lacks it; the contract has it |
| J2.6 | Sign-in button points at the real backend | **Done** — a plain `<a>`, never a fetch |
| J2.7 | Add `credentials: "include"` to every request | **Not started** — this is the 401 above |
| J2.8 | Update the mock handlers to the new shapes | **Not started** — `fixtures.ts` still camelCase, 4 weights |
| J2.9 | Redeploy and walk the whole path on the live URL | Blocked on the above |

J2.2 is the large one — roughly 244 call sites, and the compiler lists every one.

---

## Entry 3 — 20 Aug 2026 — J0.5, J0.6 and J0.7 (CI)

**Plan reference:** §6, Phase 0, steps J0.5, J0.6, J0.7. Also §10.

**Status:** written, and every command verified on a clean Linux machine. **The workflow itself has not run on GitHub yet** — that needs a push. J0.7's "images are pullable by tag" is unproven until then. Do not tick it off before you have seen a green run.

### Files changed

| File | New? | What it does |
|---|---|---|
| `.github/workflows/ci.yml` | new | The whole pipeline — checks, image builds, publishing |
| `apps/web/package.json` | edited | Added a `typecheck` script (`tsc --noEmit`); there wasn't one |

### What runs, and who owns a red tick

One job per folder, deliberately — so a failure names its owner without anyone reading a log.

| Job | Steps | Owner |
|---|---|---|
| `web` | contract check → type check → lint → tests | Janidu |
| `api` | layer check → pytest → ruff *(advisory)* | Chamodh |
| `ml` | pytest → ruff | Nathasha |
| `images` | build `web`, `api`, `ml`; publish to GHCR **on `main` only** | Janidu |

### Why the steps are in that order

**Contract check first.** `docs/api/openapi.yaml` is the one file all three of us share. If it breaks, everyone is broken. Ten seconds to find out, instead of three minutes of tests first.

**Layer check second.** `lint-imports` checks the *shape* of the code, not whether it works: scoring must stay pure, workers must never score. A human reading one file cannot see this. A machine can.

**Tests last.** They are the slowest.

### Building vs publishing

Two different things, one job:

| | On a pull request | On `main` |
|---|---|---|
| Build the images | ✅ yes | ✅ yes |
| Upload them to GitHub | ❌ no | ✅ yes |

Building on a pull request answers *"does this still compile on a clean machine?"* — that is the point of J0.6. Uploading is only useful once the code is actually merged, so it waits for `main`.

There is also no choice about it: a pull request from someone else's fork gets a read-only token and **cannot** upload even if we wanted it to.

### Verified on a clean Linux machine

I did not just run these on this laptop. I exported the repository fresh, put it inside an empty `python:3.12-slim` container with no virtualenv and nothing pre-installed, and ran the exact commands CI will run:

| Job | Result |
|---|---|
| `web` | contract check OK · types clean · 0 lint errors · **25 tests pass** |
| `api` | install OK · **layer check: 3 rules kept, 0 broken** · 28 passed |
| `ml` | install OK · **ruff: all checks passed** |
| the workflow file itself | `actionlint`: no problems |

> My first attempt failed, but the mistake was mine, not CI's: I exported only `apps/api`, and one of its tests reads `docs/api/openapi.yaml` from the top of the repository. CI checks out everything, so it is fine.
>
> **Remember this if anyone ever tries to make jobs "only run when their folder changes".** A change to `docs/api/openapi.yaml` alone must still run the `api` job. We do not do that filtering today — leave it that way.

### Three things CI does not check, and why

These are decisions, not things I forgot.

**1. Ruff (Python style) does not fail the build.** There are 31 existing style complaints, **all in `apps/api`**. None came from this work.

Why not just fix them? They are in Chamodh's folder, and he is working in those files right now. Editing 18 of his files would cause exactly the merge mess §2 exists to prevent. The alternative — turning it on anyway — gives a pipeline that is red from day one, and a permanently red pipeline can never be used for branch protection.

So it runs and prints its findings, but does not block.

> **Chamodh:** `ruff check --fix .` fixes 26 of the 31 automatically. Once it is clean, remove `--exit-zero` from the workflow. `apps/ml` is already clean.

**2. Prettier (formatting) is not checked.** It currently complains about 82 files. Fixing them means one huge commit of pure whitespace right before we merge Phase 0 — and J2.2 is going to rewrite all those files anyway. §10 asks for "Lint", which is ESLint, and that passes cleanly.

**3. Mypy (Python types) is not checked.** It is misconfigured and refuses to start at all — unrelated to anything here, and not in §10's list.

### ⚠️ The most important thing on this page

> **RESOLVED 26 Aug 2026 — see Entry 5.** The cause was not only `conftest.py`. `test_rls.py` builds its schema by running the migrations, and `main` had two Alembic heads, so the upgrade raised and the fixture gave up. Repairing the chain made all six run; two then failed on real defects (a missing `theme_preference` and a missing function GRANT), both since fixed. **8 passed.**

**Six security tests are not actually running.** They report as "skipped", and the reason they print is misleading:

> *"Docker/PostgreSQL is unavailable"*

The real reason is:

```
role "codesage_app" does not exist
```

The test database never runs `infra/postgres/init/01-init.sql`, so the user account the tests need was never created. The tests quietly give up.

**Why this matters:** those six tests are the ones proving *one customer cannot see another customer's data*. Right now the suite says "30 passed" and looks perfectly healthy while checking none of that. §12's rule is *"never claim something is done when it is a skeleton"* — this is that, hidden behind a green tick.

What I could do from outside: CI now runs pytest with `-rs`, which forces it to **print why anything skipped**, so it is visible rather than buried. The real fix is in `apps/api/tests/conftest.py` — Chamodh's file. **Raise it with him.**

### Where the images go (J0.7)

After a merge to `main`, three images are uploaded to GitHub's built-in registry:

```
ghcr.io/jpabasara/codesage-ai/web
ghcr.io/jpabasara/codesage-ai/api
ghcr.io/jpabasara/codesage-ai/ml
```

Each gets two labels: `latest`, and the exact commit ID it was built from. The commit ID one matters — it lets you deploy or roll back to a *specific* version rather than whatever "latest" happens to mean today.

Small trap avoided: our repository is `JPabasara/CodeSage-AI`, but this registry **rejects capital letters**. `docker/metadata-action` lowercases it automatically. Writing the name by hand would have failed.

> ⚠️ **The `web` image has the API address baked inside it.** Not a setting it reads when it starts — it is frozen into the image at build time (see Entry 1).
>
> Right now that address is `http://localhost:8000`, so **the published web image only works on a laptop.**
>
> **When Railway gives us a real API address (J1.4):** add a repository variable called `WEB_API_BASE_URL` under *Settings → Secrets and variables → Actions → Variables*, then re-run this workflow to build a new image. Setting it in Railway will not work — by then it is too late.

### Still to do

| Step | What is needed |
|---|---|
| Verify J0.5/J0.6 | Open the Phase 0 pull request and see the jobs go green |
| Verify J0.7 | Merge to `main`, then `docker pull ghcr.io/jpabasara/codesage-ai/api:latest` |
| J0.8 | Branch protection on `main` — a GitHub settings change, not code. Require `web`, `api`, `ml`, `images` |

Packages published by Actions default to **private**. If teammates cannot pull, make them public under the repository's Packages settings.

---

## Entry 2 — 20 Aug 2026 — J0.3 and J0.4 (the whole stack up)

**Plan reference:** §6, Phase 0, steps J0.3 and J0.4.

**Status:** done. **Six containers healthy at the same time — the first time in this project.**

```
NAME                  SERVICE    STATUS
codesage-api-1        api        Up (healthy)
codesage-ml-1         ml         Up (healthy)
codesage-postgres-1   postgres   Up (healthy)
codesage-redis-1      redis      Up (healthy)
codesage-web-1        web        Up (healthy)
codesage-worker-1     worker     Up (healthy)
```

### Files changed

| File | New? | What changed |
|---|---|---|
| `infra/docker-compose.yml` | edited | Added `CODESAGE_MIGRATION_DATABASE_URL`; healthchecks for `api`, `ml`, `worker` |
| `apps/api/.dockerignore` | new | Build context 253 MB → 481 kB |
| `apps/ml/.dockerignore` | new | Build context 17 MB → 53 kB |

### The four things that were wrong

**1. Migrations could not run.** `CODESAGE_MIGRATION_DATABASE_URL` was never set in compose, so Alembic fell back to the default in `config.py` — `localhost:5432`, password `changeme`. Inside a container that fails with a connection error that looks like broken Docker networking and is nothing of the sort.

There are **two** database URLs on purpose. `codesage_app` is the role Row-Level Security applies to and it deliberately cannot create tables; migrations run as `codesage_owner`. Confirmed working: the migration created 27 tables, and the API connects as `codesage_app`.

**2. Only three of six containers could ever report "healthy".** `postgres`, `redis` and `web` had healthchecks; `api`, `ml` and `worker` had none, so they showed `running` forever. J0.3's success condition was literally unobservable. Added:

- `api` and `ml` — a one-line Python `urlopen`, because `python:3.12-slim` ships neither curl nor wget and adding one would be a whole layer to ask a question Python can ask itself.
- `worker` — `celery inspect ping`, because the worker serves no HTTP and has no port to poll. A green tick means it genuinely answered over the broker, not merely that the process has not exited.

`web`'s healthcheck stays in its Dockerfile, not here, because the api image serves **both** `api` and `worker` and they need different checks — a single image-level `HEALTHCHECK` would be wrong for one of them.

**3 and 4. Build contexts were enormous.** Docker sends the entire context to the daemon before the first instruction runs, so this was pure waiting on every build:

| | Before | After | What was in it |
|---|---|---|---|
| `apps/api` | 253 MB | 481 kB | `.venv` — a Windows virtualenv the Linux image never uses |
| `apps/ml` | 17 MB | 53 kB | training datasets the inference service never reads |
| `apps/web` | 2.0 GB on disk | 5 kB | `node_modules` + 1.3 GB of accumulated `.next` |

This is not tidiness. CI has no warm context and would have paid that transfer on **every pull request**.

### `/readyz` returns 500 — expected, not a defect

> **Superseded 22 Aug 2026 — it is now 501, not 500.** Commit `8fe16f9` registered a handler for
> `NotImplementedError` (`errors.py::install_exception_handlers`), so every stub answers **501** in
> the contract's error envelope instead of escaping as an unhandled 500. That was a CORS fix as much
> as a tidiness one — an unhandled exception is caught outside `CORSMiddleware`, so its response
> carries no `Access-Control-Allow-Origin` and the browser reports a CORS failure instead of the
> real error. **The conclusion below is unchanged: never point a health check at `/readyz`.**

`GET /readyz` answers `Internal Server Error`. It is a stub: `routers/system.py` line 38 is `raise NotImplementedError`, and `/version` on line 44 is the same. The docstring describes what it will check one day; the body was never written.

Leave it alone:

- it is on `ops_router`, which `main.py` marks *"not in the contract"*;
- `/api/healthz` is the health endpoint the plan actually ticks (§5), and J1.7 checks that one;
- `apps/api/` is Chamodh's. Writing a real readiness probe is backend work.

> **⚠️ Carry this into J1.** Point Railway's healthcheck at **`/api/healthz`**, never `/readyz`. Railway would see the error status (500 when this was written, 501 since 22 Aug) and refuse to route traffic to a container that is working perfectly.

`/api/healthz` and `/readyz` differ on purpose: `healthz` checks only that the process is alive, so a database blip cannot make an orchestrator restart a healthy API. That is why the compose healthcheck uses it.

### How to verify the containers really talk to each other

Since `/readyz` is a stub, prove it directly:

```powershell
docker compose exec api python -c "import redis,os; print(redis.Redis.from_url(os.environ['CODESAGE_REDIS_URL']).ping())"
docker compose exec api python -c "import urllib.request; print(urllib.request.urlopen('http://ml:8001/healthz').read())"
```

Verified 20 Aug 2026: `True` and `{"status":"ok"}`. Postgres needs no separate check — `alembic upgrade head` ran *from inside the api container*, which proves more than any probe.

End-to-end checks, all passing:

| Check | Result | Meaning |
|---|---|---|
| `GET :8000/api/healthz` | `{"status":"ok"}` | API alive |
| `GET :8000/api/projects` | **401** | auth is real, not decorative (same check as J1.8) |
| `GET :3000/` | 200 | frontend serves, redirects to `/projects` |

### Full runbook, from nothing

```powershell
cd infra
docker compose down -v --remove-orphans
docker compose build
docker compose up -d postgres redis      # wait for (healthy)
docker compose up -d api
docker compose exec api alembic upgrade head
docker compose up -d                     # allow ~90s: worker start_period is 45s
docker compose ps
```

---

## Entry 1 — 20 Aug 2026 — J0.1 and J0.2 (web image + API address)

**Plan reference:** [team-plan-to-mid-evaluation.md](team-plan-to-mid-evaluation.md) §6, Phase 0, steps J0.1 and J0.2.

**Status:** done and verified by actually building and running the image.

### Files changed

| File | New? | What it does now |
|---|---|---|
| `apps/web/Dockerfile` | new | Builds the frontend into a runnable container image |
| `apps/web/.dockerignore` | new | Lists what must **not** be sent into the build |
| `apps/web/next.config.ts` | edited | Added `output: "standalone"` |
| `infra/docker-compose.yml` | edited | Moved the API address from `environment:` to `build.args:` |

Nothing in `apps/api/` or `apps/ml/` was touched.

---

### The Dockerfile, in plain words

A Dockerfile is a recipe. Ours has four steps, and **only the last one ships**. The first three are scaffolding that gets thrown away, which is how the final image stays small.

| Stage | What happens | Ships? |
|---|---|---|
| `base` | Install Node and pnpm. Set registry timeouts. | no |
| `deps` | Copy *only* `package.json` + lockfiles, then `pnpm install`. | no |
| `builder` | Copy the source, run `pnpm run build`. | no |
| `runner` | Copy just the built output onto a clean Node image. | **yes** |

**Why `deps` is separate from `builder`.** Docker caches each step. Because `deps` only sees the lockfiles, editing a React component does not invalidate it — so you do not reinstall 831 packages to change a button colour. If install and build were one step, every edit would cost five minutes.

**Why `runner` starts from a fresh image.** The final image has no pnpm, no source code, no test tools, no dev dependencies. Less to download, and less that could be attacked. It runs as the `node` user, not root.

**What `output: "standalone"` does.** Normally `next start` needs the whole `node_modules` folder (~700 MB) sitting next to it. `standalone` tells Next to work out which files it *actually* imports and bundle them into `.next/standalone/server.js`. Final image: **285 MB instead of ~700 MB**. The command becomes plain `node server.js`.

One quirk worth knowing: standalone deliberately leaves out `.next/static` and `public/`, because Next assumes a CDN will serve them. We have no CDN, so the Dockerfile copies them back in by hand. If you ever see a deployed page load with no CSS, that is the line that broke.

---

### The important part: build time vs run time

This is the thing that was wrong, and the thing most likely to confuse someone later.

> **Anything starting with `NEXT_PUBLIC_` is frozen into the JavaScript when the image is built. Setting it when the container runs does nothing.**

Why: the browser runs that code, and the browser cannot read your server's environment variables. So Next.js does a find-and-replace during `next build`, swapping `process.env.NEXT_PUBLIC_API_BASE_URL` for a literal piece of text like `"http://localhost:8000"`. By the time a container starts, the address is already baked into a `.js` file that users download.

| Setting | Whose is it | Decided when | Set where |
|---|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | frontend | **build** | `build.args:` in compose / `--build-arg` |
| `NEXT_PUBLIC_API_MOCKING` | frontend | **build** | forced to `disabled` in the Dockerfile |
| `CODESAGE_DATABASE_URL` | backend | run | `environment:` in compose / Railway dashboard |
| `CODESAGE_ASGARDEO_*` | backend | run | `infra/.env` locally, Railway dashboard live |

Backend settings are read at run time because Python reads the environment while it is running. Frontend `NEXT_PUBLIC_*` settings cannot work that way. **Same-looking syntax, completely different mechanism.**

#### What was wrong

`infra/docker-compose.yml` had:

```yaml
web:
  environment:
    NEXT_PUBLIC_API_BASE_URL: http://localhost:8000   # did nothing
```

That line had no effect whatsoever. Deployed anywhere, the site still called `localhost:8000` — meaning the user's *own laptop*, where nothing is listening. Now:

```yaml
web:
  build:
    args:
      NEXT_PUBLIC_API_BASE_URL: ${CODESAGE_WEB_API_BASE_URL:-http://localhost:8000}
```

**Consequence to remember:** changing the API address now means **rebuilding the web image**, not restarting it. `docker compose build web`.

---

### How MSW, `localhost`, and the `.env` files fit together

Three different `.env` files exist and they are unrelated to each other. This trips people up.

| File | Read by | In git? | Purpose |
|---|---|---|---|
| `apps/web/.env.local` | `pnpm dev` on your laptop | no (gitignored) | Your personal frontend dev settings |
| `infra/.env` | `docker compose` | no (gitignored) | Asgardeo client id/secret |
| `apps/api/.env.example` | nobody — it is a checklist | yes | Lists every backend setting that must exist |

#### What MSW actually is

MSW = **Mock Service Worker**. A *service worker* is a small script the browser runs in the background that sits between the page and the network. It can see `fetch()` calls leaving the page and answer them itself, with fake data, without any server existing.

That file is `apps/web/public/mockServiceWorker.js`. The fake answers live in `apps/web/src/lib/mocks/`.

It is switched on by one line in `src/components/msw-provider.tsx`:

```ts
const on = process.env.NEXT_PUBLIC_API_MOCKING === "enabled"
```

So the whole fake backend is controlled by one string. `apps/web/.env.local` sets it to `enabled`, which is why the dashboard shows data on your laptop even when Chamodh's API is not running. That is the point of it — the frontend could be built before the backend answered.

#### The trap this created

Next.js reads `.env` files **during `next build`**. If `.env.local` had been copied into the Docker build, the production image would have been built with `NEXT_PUBLIC_API_MOCKING=enabled` — and the deployed site would have answered its own API calls with fake data.

It would have looked perfect. Green dashboard, data everywhere, nothing talking to the real backend. That is the worst kind of bug: one that demos beautifully and proves nothing.

Blocked in two places, deliberately:

1. `.dockerignore` excludes `.env*`, so the file never reaches the build.
2. The Dockerfile sets `NEXT_PUBLIC_API_MOCKING=disabled` explicitly, rather than trusting that it is absent.

#### Why sign-in is different from everything else

A service worker can intercept `fetch()`. It **cannot** intercept a full page navigation — a click that makes the browser leave the page entirely.

Sign-in is exactly that: OIDC needs the browser to physically travel to Asgardeo and come back. MSW can never touch it. This is why the sign-in button must be a plain `<a href>` link and never a `fetch` (that is step J2.6), and why sign-in hits the real backend even with mocking switched on.

#### Two different fallbacks in the code, on purpose

```ts
// src/lib/api/client.ts        — data calls
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? ""

// src/app/(auth)/login/page.tsx — sign-in
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"
```

Empty string means "same origin" — the request goes to the page's own address, so the service worker sees it and can fake it. The absolute address means "really go to the backend". Data calls are fakeable; sign-in is not.

#### A knock-on effect for later — worth knowing before J2.7

Once the image is built with a real address, the frontend and backend are on **different origins**. Every request becomes cross-origin, and browsers do not send cookies cross-origin unless you ask twice:

- the frontend must send `credentials: "include"` on every request (**J2.7**);
- the backend must list the frontend's address in `CODESAGE_CORS_ORIGINS` (already supported).

Miss either and every call returns 401 while looking correct in the code. This is the single most likely cause of "it worked locally".

---

### Problems hit while doing this

| Problem | Fix |
|---|---|
| Install died at package **828 of 831** on a registry timeout, throwing away 5½ minutes | Added a BuildKit cache mount for the pnpm store plus longer fetch timeouts, so a retry resumes instead of restarting |
| That cache mount broke `COPY`, because pnpm hardlinks out of its store and hardlinks do not survive being copied between stages | Set `npm_config_package_import_method=copy` |

**Note for CI (J0.5–J0.7):** pnpm 11 spent **5 min 19 s** on its supply-chain policy check *before downloading anything*. Budget for it, and cache the store with `actions/cache`.

---

### How to check this still works

```bash
# builds, and prints the address that got baked in
cd apps/web
docker build -t web-check .
docker run --rm --entrypoint sh web-check \
  -c 'grep -roh "http://localhost:8000" .next/static/chunks | head -1'

# prove the build argument works — should print the other address
docker build --build-arg NEXT_PUBLIC_API_BASE_URL=https://example.com -t web-check2 .
docker run --rm --entrypoint sh web-check2 \
  -c 'grep -roh "https://example.com" .next/static/chunks | head -1'
```

Verified on 20 Aug 2026: image builds, 285 MB, container reports `healthy`, runs as non-root, `/` redirects to `/projects` with 200, and the two builds above produce two different addresses.

---

### Is this the industry-standard way to set the API address?

**Yes — this is the approach Next.js documents itself**, and it is what their official Docker example does. It is a normal, defensible choice. But it is worth knowing there are three common approaches and why we are on this one.

| Approach | How | Trade-off |
|---|---|---|
| **1. Build argument** ← ours | Bake the address in at build time | Standard and simple. But the image is tied to one API address |
| **2. Relative URLs + reverse proxy** | Frontend calls `/api/...`; nginx or an ingress forwards it to the backend | Arguably the most common at scale. No address to bake, and **no CORS at all**. Needs a proxy in front |
| **3. Runtime config injection** | Serve a tiny `/config.js` the page reads on load | One image runs in every environment. More moving parts |

**Why option 1 is right for us:** we have no reverse proxy, and web and api are separate Railway services on separate addresses. Options 2 and 3 both solve a problem we do not have yet — several environments from one image.

**The honest caveat.** The plan's §5 slogan is *"build once, run anywhere"*. That is fully true of the `api`, `worker` and `ml` images: same image, settings supplied at run time. For `web` it is really *"build once **per API address**"*. With one deployment that costs nothing. If we later add a staging environment, that is the moment to move to option 2 — and it is a small change, not a rewrite.

Worth being able to say out loud at the evaluation, because "why is the frontend different?" is a fair question and the answer is a property of how browsers work, not a shortcut we took.

---

### Not done yet

J0.3 onwards: run all six containers together, then CI, image publishing, and branch protection.

*(J0.3 and J0.4 landed the same day — see Entry 2 above. Remaining: J0.5 CI, J0.6 build all three images in CI, J0.7 publish to GHCR, J0.8 branch protection.)*

---

# Reference — the three ways to run it, and what each one can prove

*Written 26 Aug 2026, for Chamodh and Nathasha as much as for Janidu. Not a log entry — this is
the page to send someone who says "how do I check this works?". Every claim here was checked
against the running code on 26 Aug 2026.*

There are three ways to run Code Sage AI. **They are not interchangeable, and each one can prove
things the others cannot.** Picking the wrong one is how you end up debugging a problem that does
not exist.

| | 1 · Frontend + MSW | 2 · Docker Compose | 3 · The live site |
|---|---|---|---|
| **What runs** | one Next.js dev server | six containers on your laptop | Railway + Neon + Upstash |
| **What you need installed** | Node + pnpm | Docker Desktop | a browser |
| **Start-up** | ~10 seconds | ~90 seconds, first build ~6 minutes | none |
| **Data you see** | invented fixtures | whatever the real API returns | real |
| **Good for** | screens, layout, states, the scan animation | the API, the database, the worker, RLS | cookies, HTTPS, the demo |
| **Cannot prove** | anything about the backend | anything about HTTPS or cross-site cookies | nothing much — but it costs money and everyone sees your mistakes |

---

## 1 · Frontend only, with MSW

**What it is.** One Next.js dev server. No Python, no Docker, no database. MSW (Mock Service
Worker) is a script the browser runs in the background — `apps/web/public/mockServiceWorker.js` —
that sits between the page and the network and answers `fetch()` calls itself, from the fixtures in
`apps/web/src/lib/mocks/`. Nothing leaves your machine.

```powershell
cd apps/web
pnpm install
pnpm dev              # http://localhost:3000
```

`apps/web/.env.local` — gitignored, so each person makes their own. Copy `.env.example`:

```ini
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_API_MOCKING=enabled
NEXT_PUBLIC_SESSION_COOKIE_NAME=codesage_session
```

### ⚠️ The thing that will stop you in the first thirty seconds

**You will land on `/login` and be unable to leave.** This is not a bug and it is not MSW failing.

Since J3.3 there is a `src/middleware.ts` that redirects any visitor with no session cookie
straight to `/login`. Middleware runs **on the server, before the page is sent** — a service worker
lives in the browser and cannot possibly intercept it. So MSW is irrelevant here: no cookie, no
app.

Measured on 26 Aug 2026 against a dev server on port 3199:

```
GET /              →  307  →  /login
GET /projects      →  307  →  /login
GET /projects      with header `Cookie: codesage_session=fake`   →  200
```

**Any value works.** The cookie is `httpOnly`, so the edge cannot read its contents — the
middleware checks only that it *exists*. That is the correct design (the API is the real security
boundary, SEC-10), and it is exactly what makes the workaround safe.

### Two ways past it — pick by what you are doing

**(a) Working on screens, offline, no backend at all — use `e2e` mode.**

```ini
NEXT_PUBLIC_API_MOCKING=e2e
```

`e2e` mocks the data endpoints **and** `/api/auth/session`, so the rail shows a signed-in user
without any API existing. Then hand yourself a cookie once, in DevTools → Application → Cookies →
`http://localhost:3000`:

```
name:  codesage_session
value: local-dev
```

Refresh. The whole app opens. This is precisely what Playwright does — see `e2e/session.ts`,
which seeds the same cookie for the same reason.

**(b) Testing a real sign-in — use `enabled` mode and run the backend.**

```ini
NEXT_PUBLIC_API_MOCKING=enabled
```

`enabled` mocks every *data* endpoint but deliberately lets `/api/auth/session` **pass through** to
the real API — which is the only way to test a genuine Asgardeo sign-in while keeping the mock
dashboard. You need the API running (mode 2, `docker compose up -d postgres redis api`) and
`http://localhost:8000/api/auth/callback` registered in the Asgardeo console.

The difference in one line, from `src/lib/mocks/browser.ts`:

| Mode | Data endpoints | `/api/auth/session` |
|---|---|---|
| `enabled` | mocked | **passed through to the real API** |
| `e2e` | mocked | **mocked**, honouring the seeded cookie |
| `disabled` | real | real |

### Sign-in can never be mocked, in any mode

A service worker can intercept `fetch()`. It **cannot** intercept a full-page navigation — a click
that makes the browser leave the page entirely. OIDC is exactly that: the browser physically
travels to Asgardeo and comes back.

This is why the sign-in button is a plain `<a href>` and never a `fetch` (J2.6), and why
`src/app/(auth)/login/page.tsx` falls back to `http://localhost:8000` while
`src/lib/api/client.ts` falls back to `""`. Empty means *same origin*, so the worker sees the
request and can fake it. An absolute address means *really go to the backend*.

### What mode 1 proves, and what it cannot

| Proves | Cannot prove |
|---|---|
| Every screen, every layout, light and dark | That any endpoint exists |
| Loading / empty / error states — the fixtures can return anything | That the contract in `docs/api/openapi.yaml` matches what the API sends |
| The scan state machine end to end, including Stop | That a scan actually works |
| Keyboard and screen-reader behaviour | Anything about cookies, CORS, HTTPS or the database |

> A green mode-1 app tells you the **frontend** is correct. It tells you nothing at all about the
> other two thirds of the system — by design. That is what let the frontend get built before the
> backend answered.

---

## 2 · The whole stack in Docker Compose

**What it is.** Six containers on your laptop: `postgres`, `redis`, `ml`, `migrate`, `api`,
`worker`, `web`. Closest thing to the deployment that does not cost money.

```powershell
cd infra
docker compose build
docker compose up -d          # allow ~90s: the worker's start_period alone is 45s
docker compose ps             # everything should say (healthy)
```

`web` is on <http://localhost:3000>, `api` on <http://localhost:8000>. **Nothing else is
published** — `postgres`, `redis` and `ml` are on the private network with no door to the outside.
Reach them through a container:

```powershell
docker compose exec postgres psql -U codesage_owner codesage
docker compose exec api python -c "import urllib.request; print(urllib.request.urlopen('http://ml:8001/healthz').read())"
```

You also need `infra/.env` — gitignored, copied from `infra/.env.example`, holding the Asgardeo
client id and secret. Everything else has a working fake value committed in
`docker-compose.yml`, on purpose. See `infra/README.md`.

**Mocking is always off here, and there is no flag to flip.** `apps/web/Dockerfile` hardcodes
`ENV NEXT_PUBLIC_API_MOCKING=disabled`, and `.dockerignore` excludes `.env*` so `.env.local` never
reaches the build. Both are deliberate: an image built with mocking on would demo beautifully and
prove nothing. If you want mock data, use mode 1.

### To scan something, two things must be true

**a. The CK jar must be in the image.** Until Entry 5 Step 2 lands, `apps/api/vendor/` is empty in
a fresh clone and every scan ends in phase `error` with *"The repository could not be analysed."*
Interim fix on your own machine — download the jar into `apps/api/vendor/ck.jar` and
`docker compose build api`:

```
https://repo1.maven.org/maven2/com/github/mauricioaniche/ck/0.7.0/ck-0.7.0-jar-with-dependencies.jar
```

**b. Use a Java repository.** `analysed_extensions` is `[".java"]` — v1.0 analyses Java only,
because CK is a Java-only extractor. A Python repository scans *successfully* and finds nothing,
which looks like a failure and is not.

### Three commands worth memorising

| You changed | Run |
|---|---|
| a Dockerfile or app source | `docker compose up -d --build` |
| `environment:` in compose | `docker compose up -d` |
| **`NEXT_PUBLIC_API_BASE_URL`** | `docker compose build web` — **a restart is not enough** |

Three concurrent scans (PERF-07): `docker compose up -d --scale worker=3`.

### What mode 2 proves, and what it cannot

| Proves | Cannot prove |
|---|---|
| Every real endpoint, with real data from a real Postgres | Anything about **HTTPS** — it is plain http throughout |
| Migrations apply cleanly from nothing | The **`Secure`** cookie flag: compose sets `CODESAGE_COOKIE_SECURE=false`, because plain http can never carry a Secure cookie |
| The worker: clone, CK, PyDriller, rules, finalize | **Cross-site cookies.** Locally `web` and `api` are both `localhost`, so a host-only cookie just works. Live they are `codesageai.dev` and `api.codesageai.dev`, and the cookie needs `CODESAGE_COOKIE_DOMAIN=.codesageai.dev` |
| Row-Level Security and tenant isolation | **CORS in anger.** `CODESAGE_CORS_ORIGINS` is `["http://localhost:3000"]` here and the browser is lenient about same-host ports |
| That the private network works — nothing is exposed that should not be | Neon's **pooled vs direct** endpoints, `sslmode=require`, `channel_binding` |
| Sign-in, if Asgardeo has the localhost callback registered | Upstash's `rediss://` TLS and `?ssl_cert_reqs=required` |

> **This is the single most valuable row in this document.** Every one of Phase 1's three
> deployment failures (Entry 4) and the cookie-domain bug were in the right-hand column. They are
> *structurally* invisible in compose — not because nobody looked, but because the conditions
> that trigger them do not exist on a laptop.

---

## 3 · The live site

| | Address |
|---|---|
| Site | `https://codesageai.dev` |
| Backend | `https://api.codesageai.dev` |
| Database | Neon, `ap-southeast-1` |
| Broker | Upstash Redis, `ap-southeast-1` |
| Services | Railway `codesageai/production` |

Nothing to install. Sign in and use it.

**What only the live site can prove:** HTTPS and certificates; `Secure` + `SameSite=Lax` cookies
across two hostnames; CORS between two real origins; Neon's pooler under real latency; Upstash TLS;
that the *published image* — not your local build — actually runs; and that a custom domain is
routing to the right port. (A **502** on `codesageai.dev` while the `*.up.railway.app` address
works means the domain lost its explicit port. Entry 4.)

**What is confusing about it:** a failed deployment leaves the **previous** container serving. So
`/api/healthz` returning 200 proves the *old* build is alive and says nothing about the change you
just pushed. **Trust the deployment badge, not the URL.**

After any restart, check in this order:

1. `https://api.codesageai.dev/api/healthz` → `{"status":"ok"}`
2. `https://api.codesageai.dev/api/projects` **in a private window** → **401**. Never skip it
3. `https://codesageai.dev` → sign in → `/projects` renders with data
4. `https://codesageai.dev` returns a page, not a 502

---

## What cannot be tested locally — the actual list

Two different questions get muddled here. Keep them apart.

### A. Not testable locally because the *environment* is different

These are properties of being deployed. No amount of local work reaches them.

| # | What | Why it is invisible locally | Where it bit us |
|---|---|---|---|
| 1 | The **`Secure`** cookie flag | Plain http cannot carry a Secure cookie, so compose sets `CODESAGE_COOKIE_SECURE=false` | — |
| 2 | **Cookie domain across two hosts** | `web` and `api` are both `localhost` locally, so a host-only cookie works. Live it must be `.codesageai.dev` or `middleware.ts` bounces every signed-in visitor back to `/login` | commit `ff27d8e` |
| 3 | **CORS between real origins** | Same reason. `credentials: "include"` plus `CODESAGE_CORS_ORIGINS` only matter when the origins genuinely differ | J2.7, Entry 4 |
| 4 | **HTTPS, certificates, DNS, the apex CNAME** | There is no TLS locally | Entry 4: the `_railway-verify` TXT record |
| 5 | **Custom-domain port mapping** | Compose publishes ports directly | Entry 4: 502 on the custom domain |
| 6 | **Neon**: pooled vs direct endpoints, `sslmode=require`, `channel_binding` | Local Postgres is one plain container | Entry 4, faults 1 and 2 |
| 7 | **Upstash**: `rediss://` TLS, `?ssl_cert_reqs=required` | Local Redis is plain `redis://` | Entry 4 |
| 8 | **Railway's IPv6-only private network** | Compose's private network is IPv4, so `--host 0.0.0.0` works locally and fails there | Entry 5, Step 4 |
| 9 | **The published image itself** | Compose *builds* from your working tree; Railway *pulls* what CI built. A file that is gitignored exists for you and not for CI | Entry 5, Finding 1 — the CK jar |
| 10 | **`CODESAGE_CORS_ORIGINS` parsing** | It must be JSON — `["https://codesageai.dev"]`. Plain text kills the process at import | Entry 4, fault 3 |
| 11 | **Real Asgardeo sign-in against the deployed callback** | The console's redirect list is per-address. A localhost callback proves nothing about the live one | J1.10 |
| 12 | **The deployed model artifact** | `apps/ml/models/` is empty in git; what a deployed `ml` loads depends on what is mounted there | Entry 5, Step 4 |

> Rows 2, 3, 6, 7 and 9 all share one shape: **something that is a single thing locally becomes two
> things in production.** One host becomes two hosts. One database container becomes a pooler and a
> direct endpoint. Your working tree becomes a git checkout. That is the whole category.

### B. Not testable *anywhere* yet, because the code is not written

Different problem. These fail identically on a laptop and on the live site — do not go looking for
an environment cause.

| Endpoint | Answers | Owner |
|---|---|---|
| `GET /api/profiles` | **501** | Chamodh |
| `GET /api/profiles/active` | **501** | Chamodh |
| `PUT /api/profiles/active` | **501** | Chamodh |
| `GET /readyz` | **501** — an unfinished stub. **Never point a health check at it**; use `/api/healthz` | Chamodh |
| `GET /version` | **501** — same | Chamodh |

**So the Profiles screen only works in mode 1.** Against a real API, locally or live, it 501s. That
is the single biggest gap between "the demo works" and "the product works", and it is worth knowing
before someone clicks Profiles in front of an evaluator.

Also not wired, though nothing returns an error for it: **ML-1 and ML-2 are never called by the
scan pipeline** (Entry 5, Finding 3). A scan produces rule findings only. No SATD findings appear,
and every `risk_score` is 0.0 — which is the documented degraded mode, so it looks entirely normal.

### C. Testable locally, and easy to assume otherwise

Worth stating, because people skip these:

- **Row-Level Security and tenant isolation** — fully testable in compose, and much easier to
  inspect there than on Neon.
- **The worker, end to end** — clone, CK, PyDriller, rules, finalize. Once the jar is in place,
  mode 2 exercises everything the live worker does.
- **Migrations from nothing** — `docker compose down -v` then up is a truer test than Neon, because
  Neon is never empty.
- **Sign-in** — a real Asgardeo round trip works against `localhost:8000`, provided that callback
  is registered in the console.

---

# Reference — Docker Compose, explained

*Not a log entry: background for anyone who has never used Docker Compose. Everything here was checked against our actual running stack on 20 Aug 2026.*

### 1. The one idea

A **container** is one program in a sealed box. Compose runs several boxes at once and wires them together.

`infra/docker-compose.yml` is a description of six boxes. One command starts all six:

```powershell
docker compose up -d
```

Compose does three things for you:

1. **Builds or downloads** each image.
2. **Creates a private network** and puts every box on it.
3. **Starts them in the right order**, waiting where you told it to wait.

That is the whole thing. The rest is detail.

---

### 2. The private network — the part most people get wrong

When you run `docker compose up`, Compose creates a virtual network. Ours is called `codesage_default` (project name `codesage`, from `name:` at the top of the file).

**Every service is given a hostname equal to its service name.** So inside that network, `postgres` is a real address, like a tiny private internet.

#### The correction

> "Is it a port only the owner can access from outside?"

**No.** It is not about *who*. It is about *where from*.

- **Inside the network:** everything can reach everything. No restriction at all.
- **From your laptop:** you can only reach what has been explicitly **published**.

It's a wall, not a lock. Credentials don't help you cross it — there is nothing to connect to.

#### Proof, measured on our stack

Same five ports, tried from two places:

| Service | From your laptop | From another container |
|---|---|---|
| postgres :5432 | ❌ refused | ✅ reachable |
| redis :6379 | ❌ refused | ✅ reachable |
| ml :8001 | ❌ refused | ✅ reachable |
| **api :8000** | ✅ **reachable** | ✅ reachable |
| **web :3000** | ✅ **reachable** | ✅ reachable |

`api` and `web` are reachable from the laptop because they are the only two with a `ports:` line. That is the *only* difference.

#### Why deliberately

Your database holds everything. If port 5432 were open on a deployed machine, the entire internet could try passwords against it forever. Not publishing it means there is no door to knock on.

The compose file says this in a comment for a reason: *"An open database port is the single easiest thing to forget before a demo."*

---

### 3. `ports:` vs `EXPOSE` — read the arrow

You saw this in `docker compose ps`:

```
SERVICE    PORTS
api        0.0.0.0:8000->8000/tcp     ← published
web        0.0.0.0:3000->3000/tcp     ← published
ml         8001/tcp                   ← NOT published
postgres   5432/tcp                   ← NOT published
worker     8000/tcp                   ← NOT published
```

**The arrow `->` is what matters.**

| | Means | Effect |
|---|---|---|
| `8000/tcp` | `EXPOSE 8000` in a Dockerfile | **Documentation only.** Opens nothing |
| `0.0.0.0:8000->8000/tcp` | `ports:` in compose | Really opens a door on your machine |

`worker` shows `8000/tcp` only because it shares the API's Dockerfile, which has `EXPOSE 8000`. The worker serves no HTTP at all. Nothing is open.

#### Reading a `ports:` line

```yaml
ports:
  - "3000:3000"        # host:container
```

Left = port on your laptop. Right = port inside the container. They need not match — `"8080:3000"` would mean `localhost:8080` on your machine.

`0.0.0.0` means **every network interface**, so anyone on your Wi-Fi could reach it. Compare `docker-compose.dev.yml`:

```yaml
ports:
  - "127.0.0.1:5433:5432"
```

`127.0.0.1` means **this machine only**, not the network. That is the safer form, and why the dev override is written that way.

#### Getting into an unpublished container anyway

```powershell
docker compose exec postgres psql -U codesage_owner codesage
```

`exec` runs the command *inside* the box, so the network boundary never comes into it. This is how you inspect the database without opening a port.

---

### 4. Where do the values come from?

There are **three** sources, and mixing them up causes most confusion.

#### Source 1 — written literally in the file (committed to git)

```yaml
postgres:
  environment:
    POSTGRES_USER: codesage_owner
    POSTGRES_PASSWORD: devpassword
```

`devpassword` is **hardcoded in `docker-compose.yml`** and committed. It does not come from `.env`.

**Is that a security hole? No** — and it is worth knowing why:

- the database is not published, so nothing outside your laptop can use it;
- it is a throwaway database that `docker compose down -v` deletes;
- production never sees this file at all (see §7).

You will see `devpassword` and `dev-only-change-me`. Both are deliberate, both are local-only.

#### Source 2 — `${...}` substituted from `infra/.env`

```yaml
CODESAGE_ASGARDEO_CLIENT_SECRET: ${CODESAGE_ASGARDEO_CLIENT_SECRET:-}
```

`${NAME:-default}` means *"use `NAME` if it is set, otherwise the default"*.

Compose fills these in from `infra/.env` — the file next to the compose file. That file is **gitignored** because these are real credentials.

> ⚠️ **`infra/.env` is read by Compose itself, for `${...}` substitution only.** It is *not* handed to the containers. A value reaches a container only if a `${...}` in `environment:` puts it there. Two different things that both involve a file called `.env`.

**Rule of thumb:** real secret → `${...}` + `.env`. Fake local value → write it literally.

#### Source 3 — defaults in the code

If nothing sets a variable, `apps/api/src/codesage_api/config.py` has a fallback:

```python
database_url: str = "postgresql+psycopg://codesage_app:changeme@localhost:5432/codesage"
redis_url:    str = "redis://localhost:6379/0"
```

These exist so you can run the API **directly on your laptop**, outside Docker, without setting anything. They say `localhost` because that is where things are when nothing is containerised.

**Yes — these are the "if not provided" defaults, and they bite.** This is exactly the J0.4 bug: `CODESAGE_MIGRATION_DATABASE_URL` was not set in compose, so Alembic used the default, tried `localhost:5432` *from inside the container*, and failed. Inside a container `localhost` means **the container itself**, not your laptop.

#### Which wins

```
compose `environment:`   ← highest, always wins
        ↓
a .env file next to the running app   (not present in our images)
        ↓
the default in config.py   ← lowest, the "nobody told me" value
```

---

### 5. Reading that database URL

```
postgresql+psycopg://codesage_app:devpassword@postgres:5432/codesage
└────────┬────────┘   └────┬────┘ └────┬────┘ └───┬──┘ └┬─┘ └───┬──┘
      driver           username   password      host   port   database
```

| Piece | Meaning |
|---|---|
| `postgresql+psycopg` | Which database, and which Python driver. Not a real network scheme |
| `codesage_app` | The login role |
| `devpassword` | Its password — local only |
| **`postgres`** | **The hostname — this is the service name from the compose file** |
| `5432` | Port inside the private network |
| `codesage` | Which database on that server |

**`@postgres` is the key insight.** It is not a domain name that exists on the internet. Compose invented it. Type `postgres` into your browser and nothing happens; inside the network it resolves to the database container.

#### Why there are two URLs

```yaml
CODESAGE_DATABASE_URL:           ...codesage_app:...      # everyday use
CODESAGE_MIGRATION_DATABASE_URL: ...codesage_owner:...    # creating tables
```

Two roles on purpose:

| Role | Can | Why |
|---|---|---|
| `codesage_owner` | create and change tables | runs migrations |
| `codesage_app` | read and write rows only | **Row-Level Security is silently ignored for a table's owner.** If the app connected as the owner, tenant isolation would do nothing while appearing to work |

That is the single most important line in `infra/postgres/init/01-init.sql`.

#### "Are these mine?"

They are **the project's**, written once into the compose file and shared by everyone who clones the repo. Not personal, not generated for you. Every teammate's local stack uses the identical `devpassword`, and that is fine because it is a disposable local database.

Only two files are *yours* and never shared: `infra/.env` and `apps/web/.env.local`.

---

### 6. What each teammate has to do

Cloning the repo gives you `docker-compose.yml` with all the fake passwords already in it. You additionally need:

| File | Why | How |
|---|---|---|
| `infra/.env` | Asgardeo credentials — real secrets, gitignored | Copy from a teammate privately, or the Asgardeo console |
| `apps/web/.env.local` | Your frontend dev settings | Only needed for `pnpm dev`, not for Docker |

Everything else works from a clean clone. `apps/api/.env.example` is the checklist of every backend setting — it is committed precisely so nobody has to guess.

---

### 7. What actually happens in production

**The compose file is not used in production at all.** Railway, Neon and Upstash never read it. It is a local-development tool.

| Local | Production |
|---|---|
| `postgres` container, `devpassword` | **Neon** — managed Postgres, real password, TLS |
| `redis` container | **Upstash** — managed Redis |
| values in `docker-compose.yml` | values typed into the **Railway dashboard** |
| `docker compose up` | Railway pulls the published image and runs it |

The URLs keep the same shape but stop being local:

```
# local
postgresql+psycopg://codesage_app:devpassword@postgres:5432/codesage

# Neon
postgresql+psycopg://codesage_app:REAL_SECRET@ep-cool-name-123.eu-central-1.aws.neon.tech/codesage?sslmode=require
```

The host changes from an invented compose name to a real internet address, and `sslmode=require` appears because the traffic now crosses the public internet. Redis likewise becomes `rediss://` — **two s's**, meaning TLS.

**This is why the code never hardcodes any of it.** Every setting arrives from the environment, so the same image runs on your laptop and on Railway with nothing recompiled. That is the plan's §5 idea in one sentence.

> The exception is the frontend, for a reason specific to browsers — see Entry 1 of the log.

**Secrets in production live only in the Railway dashboard**, never in git. If you delete the Railway services you must retype them, which is why `apps/api/.env.example` must be kept accurate.

---

### 8. Commands worth knowing

Run these from `infra/`.

#### Daily

| Command | Does |
|---|---|
| `docker compose up -d` | Start everything, in the background |
| `docker compose ps` | What is running, and its health |
| `docker compose logs -f api` | Follow one service's output. **First thing to run when something breaks** |
| `docker compose down` | Stop and remove containers, **keep the data** |
| `docker compose restart api` | Restart one service |

#### After changing something

| You changed | Run |
|---|---|
| a `Dockerfile` or app source | `docker compose up -d --build` |
| `environment:` in compose | `docker compose up -d` (recreates it) |
| **`NEXT_PUBLIC_API_BASE_URL`** | `docker compose build web` — **a restart is not enough**, see log Entry 1 |

#### Digging in

| Command | Does |
|---|---|
| `docker compose exec api bash` | A shell inside the API container |
| `docker compose exec postgres psql -U codesage_owner codesage` | The database, without opening a port |
| `docker compose exec api alembic upgrade head` | Run migrations |
| `docker compose config` | Show the final file with every `${...}` filled in — **the fastest way to see what a variable actually became** |

#### Starting over

```powershell
docker compose down -v          # -v ALSO DELETES THE DATABASE
docker compose build
docker compose up -d
```

#### Flags

| Flag | Meaning |
|---|---|
| `-d` | Detached — run in the background and give you your prompt back |
| `-f <file>` | Use a specific compose file. Repeatable: later files override earlier ones |
| `-v` | **On `down` only: delete the volumes.** Your data is gone. Fine locally, never in production |
| `--build` | Rebuild images before starting |
| `-f` on `logs` | Follow — keep printing as new lines arrive |
| `--remove-orphans` | Delete containers from services no longer in the file |

Opening the database port for a moment, without editing the main file:

```powershell
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
```

Typing the second `-f` is the point — the default stays locked, and opening it is something you did deliberately and can see in your shell history.

---

### 9. Five things that will confuse you once

1. **`localhost` inside a container means the container**, not your laptop. Use the service name — `postgres`, not `localhost`.
2. **`EXPOSE` in a Dockerfile opens nothing.** Only `ports:` does. Look for the `->` arrow.
3. **`infra/.env` is read by Compose, not given to containers.** Only `${...}` in `environment:` puts a value into a container.
4. **`down -v` deletes your database.** Without `-v` the data survives.
5. **`NEXT_PUBLIC_*` needs a rebuild, not a restart.** It is baked into JavaScript at build time.
