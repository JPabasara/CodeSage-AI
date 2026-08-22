# Team plan — now to mid-evaluation (Tue 25 Aug 2026)

*Working plan · written 17 Aug 2026 · Group 16. Not a deliverable. Nine days.*

---

## The goal

By Tuesday the 25th, three things should be true:

1. **It runs on a real URL**, not on a laptop.
2. **One complete path works end to end** — sign in, connect a repository, run a scan, see the dashboard.
3. **Every merge is checked automatically**, so "it works" is something a marker can verify rather than take our word for.

Anything that does not serve those three waits until after the 25th.

---

## 1. Who owns what

The whole point of the split is that **two people never edit the same file**.

| Folder | Owner | What it is |
|---|---|---|
| `apps/web/` | **Janidu** | The Next.js dashboard |
| `apps/api/` | **Chamodh** | FastAPI, the scan worker, the database |
| `apps/ml/` | **Nathasha** | The model service and training |
| `infra/`, `.github/`, **all Dockerfiles** | **Janidu** | Deployment and CI |
| `docs/` | shared | One person per file, agreed in the group chat |

> **Note the last row of Janidu's column.** Dockerfiles live inside `apps/api/` and `apps/ml/`, but they belong to whoever does deployment. Chamodh and Nathasha do not edit them. If one needs changing, ask.

### The one file everyone shares

`docs/api/openapi.yaml` — the API contract.

**Nobody edits it alone.** A change to it is its own pull request, with no code in it, and both other people approve it. That file is why three folders can be worked on at once without constant talking: it already says what every field is called and what every endpoint returns, so the frontend can be built before the backend answers, and the other way round.

If you find yourself wanting to change it mid-task, stop and raise it in the group. Changing the contract quietly is how the last merge became painful.

---

## 2. Rules that stop the merge mess repeating

The last merge had eight conflicting files. Every one was a shared file two branches touched.

1. **Branch names say who and what:** `web/janidu/profiles-page`, `api/chamodh/scan-endpoints`, `ml/nathasha/satd-service`.
2. **Only touch your own folder.** Need something in someone else's? Ask them to do it.
3. **Pull `main` into your branch every morning.** Ten small merges are painless; one nine-day merge is not.
4. **Small pull requests, often.** One a day is a good target. A pull request nobody can read does not get reviewed, it gets waved through.
5. **Never run `git add -A` from the top folder.** `apps/ml/data/raw/` is a git repository inside our git repository and would be committed as a broken link. Add paths by name.

---

## 3. Why Janidu goes first

Some work touches files in *everyone's* folder — the Dockerfiles, the compose file, the CI setup. If that happens while Chamodh and Nathasha are mid-flight, we get the same merge mess again.

So the order is:

```
Mon 17 – Tue 18    Janidu only, on the shared files.  One pull request.
                   Chamodh and Nathasha may start branches, but do not
                   touch any Dockerfile, infra/ or .github/ — ever.

Tue 18 evening     That pull request merges.  ← green light
                   Everyone pulls main and carries on.

Wed 19 onward      All three working in parallel, in separate folders.
```

After that one pull request, **Janidu never edits `apps/api/` or `apps/ml/` again.**

---

## 4. What we found when we checked the deployment

Three things were assumed to work and do not. All three are Janidu's Phase 0.

| Finding | Why it matters |
|---|---|
| **There is no `apps/web/Dockerfile`** | `infra/docker-compose.yml` says to build the web app from that folder, but the file does not exist. **The six-container stack cannot be built today.** Nobody noticed because the frontend has only ever been run with `pnpm dev` |
| **The frontend's API address is frozen when the image is built** | Next.js replaces `NEXT_PUBLIC_API_BASE_URL` with plain text at build time — it does *not* read it when running. Setting it in the compose file does nothing to a built image. Deploy it anywhere and it still points at `localhost:8000` |
| **`docker compose up` has never been run end to end** | We have never seen all six containers build and talk to each other. Whatever is wrong, we want to know now, not on the 24th |

**One earlier worry turned out to be fine:** the API image already installs Java for the CK tool ([apps/api/Dockerfile:25](../../apps/api/Dockerfile#L25)) and sets `CODESAGE_CK_JAR`. Nothing to do.

---

## 5. The idea that shapes the whole deployment

> **Get the project deployable *anywhere*, and the choice of host becomes a small decision you can change later.**

Concretely: if a clean machine that has never seen your laptop can build and run the images, then any host can run them. If it only builds on your machine, you do not have a deployment — you have a laptop.

**That is what CI is really for here.** CI does exactly what a hosting platform does: check out the code fresh, build the images, run the tests. If CI is green, the app is portable, proven rather than assumed.

Then one extra step makes it real: **CI pushes the built images to GitHub Container Registry** (free for public repositories). After that, deploying anywhere is "pull this image and run it" — Railway, a rented server, DigitalOcean, all identical. Build once, run anywhere.

This is why deployment work comes before frontend work, and why it does not block anyone.

### Where we stand on being deployable anywhere

| Needed | Status |
|---|---|
| API image builds, with Java for CK | ✅ done |
| ML image builds | ✅ done |
| Every setting comes from an environment variable | ✅ nothing reads the environment directly |
| The required variables are written down | ✅ `apps/api/.env.example` |
| Database migration is a step you can run | ✅ alembic |
| A health endpoint for the platform to check | ✅ `/api/healthz` |
| Services keep nothing in memory | ✅ sessions live in the database |
| **Web image builds** | ❌ Phase 0 |
| **Frontend API address is configurable** | ❌ Phase 0 |
| **CI** | ❌ Phase 0 |
| **Images published** | ❌ Phase 0 |

---

## 6. Janidu — deployment, CI, then frontend

### Phase 0 — the shared files (Mon 17 – Tue 18). One pull request.

| # | Step | Done when |
|---|---|---|
| J0.1 | Write `apps/web/Dockerfile` | It builds the production Next.js app |
| J0.2 | Pass the API address in as a **build argument**, not a runtime setting | Building with a different address produces an image that points somewhere else |
| J0.3 | Run `docker compose up` and make all six containers build and start | Six containers healthy at the same time, first time ever |
| J0.4 | Fix whatever step 3 reveals | Step 3 passes from a clean checkout |
| J0.5 | CI: on every pull request run frontend tests, type check, contract check, backend tests, layer check | A pull request that breaks any of them shows red |
| J0.6 | CI: build all three images | The build runs on a clean machine, not just yours |
| J0.7 | CI: push the images to GitHub Container Registry | The images are pullable by tag |
| J0.8 | Make failing checks block merging (branch protection on `main`) | A red pull request cannot be merged |

**Merge this, then tell the group. That is the green light.**

### Phase 1 — deploy (Wed 19)

> **Changed 20 Aug 2026: we are buying `codesageai.dev`.** That is not cosmetic. It removes two
> problems this phase would otherwise have hit, and it changes the order of the steps — the web
> image is now built *before* anything is deployed, not after. Read *Why the domain comes first* in
> the guide below before starting.

| # | Step | Done when |
|---|---|---|
| J1.1 | Register `codesageai.dev` at Spaceship, keep its own DNS | The domain is yours and Advanced DNS Manager opens |
| J1.2 | Write down the three live addresses | Site, backend and callback decided, in a file you can copy from |
| J1.3 | Set `WEB_API_BASE_URL` in GitHub, re-run CI on `main` | The published `web` image contains `https://api.codesageai.dev`, not `localhost` |
| J1.4 | Neon: create the database, create the `codesage_app` role **by hand**, collect both connection strings | Two roles exist; you have the un-pooled owner string and the pooled app string |
| J1.5 | Point `apps/api/.env` at Neon and run the migration | 27 tables — check them in Neon's web console |
| J1.6 | Create an Upstash account, get a Redis address | It responds |
| J1.7 | Deploy three containers to Railway from the published images | `api`, `worker` and `web` running (`ml` stays off — see §9) |
| J1.8 | Fill in every setting in the Railway dashboard | Nothing secret is in the repository |
| J1.9 | Attach both custom domains and add the DNS records | Both addresses load over https with a valid certificate |
| J1.10 | Add the live callback address in the Asgardeo console | It matches the deployed address exactly, character for character |
| J1.11 | Check `/api/healthz` answers | 200 |
| J1.12 | **Check `/api/projects` returns 401 when signed out** | This is the security working — do not skip it |
| J1.13 | Sign in on the live site | You reach the dashboard |
| J1.14 | Set a spending limit of about $15 | Not $5 — see §9 |
| J1.15 | Stop the Railway services until the 23rd | Usage drops to nothing; Neon and Upstash stay up |

---

## 6a. Guide — Phase 1, step by step

*Written for someone doing this for the first time. Every step is listed; nothing is assumed.*

### Before you start

Accounts you will need: **Spaceship** (the domain), **Neon**, **Upstash**, **Railway**, and the
**Asgardeo** console we already use. A card for the domain (about $13 a year) and for Railway ($5).

Open a scratch file — **not in the repository** — and keep these four things in it as you go. You
will paste each one into two or three different dashboards:

1. the Neon connection string for the **owner** role
2. the Neon connection string for the **app** role
3. the Upstash Redis address
4. a freshly generated `CODESAGE_SECRET_KEY`

---

### Why the domain comes first

Two problems disappear the moment we own a domain, and both were going to cost a day.

**1. Sign-in would have appeared to work and then failed on every request.**

Railway gives each service its own address, like `codesage-api-production.up.railway.app`. Those
*look* like two names under one roof. Browsers do not see them that way: every `*.up.railway.app`
name is treated as a **completely separate site**, because that suffix sits on the public list
browsers use to decide where one owner's territory ends and another's begins.

Our session cookie is marked `SameSite=Lax`, which means *"only send me when the request comes from
my own site"*. So the frontend on one Railway address would never have sent the cookie to the
backend on another. You would sign in successfully, land on the dashboard, and then watch every
request come back 401 — with nothing visibly wrong in the code.

With our own domain the site goes on `codesageai.dev` and the backend on `api.codesageai.dev`.
Those **are** the same site, so the cookie is sent. **No backend change is needed** — which matters,
because the fix would have been in `apps/api`, and that is Chamodh's folder (§1).

**2. The web image would have needed rebuilding after the deploy.**

The frontend's API address is frozen into the image when it is *built*, not read when it runs
(deployment log, Entry 1). Without a domain the order would have been: deploy the backend, wait for
Railway to invent an address, put that address into GitHub, rebuild the image, then deploy the
frontend. Owning the domain means **we choose the address before anything exists**, so the image is
built once, correctly, up front.

That is why J1.3 sits before J1.7.

> **A note on `.dev`.** Browsers refuse to load a `.dev` address over plain `http` — https is
> compulsory and built into the browser itself. That suits us: our session cookie is already marked
> `Secure`, meaning https-only, so there is nothing to work around.

---

### Step 1 — Register the domain (J1.1)

**Registrar: Spaceship. DNS: Spaceship's own. No Cloudflare needed.**

Buy `codesageai.dev` there and leave the nameservers as they come. Nothing else to set up yet — the
records go in at step 8.

> **Why this needed checking at all.** Railway asks you to point a name at *its* address using a DNS
> record called a `CNAME`. The rules of DNS do not permit a `CNAME` on a **bare** domain like
> `codesageai.dev` — only on a name in front of it, like `api.codesageai.dev`. Some DNS hosts work
> around this (the feature is called *CNAME flattening*, or an *ALIAS* record); many do not.
> Railway's own documentation names Route 53, Azure DNS and GoDaddy as hosts that cannot, and tells
> you to move the domain to Cloudflare.
>
> **Spaceship can.** Its Advanced DNS Manager takes a `CNAME` with the host `@` and resolves it as
> an ALIAS behind the scenes, answering queries with plain address records — so the bare domain
> works and the root's mail and authority records keep working alongside it. That is why we can keep
> everything in one place.
>
> Two consequences, both at step 8: create the apex record as a **`CNAME` with host `@`** rather
> than looking for an "ALIAS" type in the dropdown, and do not be surprised when a DNS lookup shows
> an `A` record rather than the `CNAME` you typed. That is the flattening working.

**If you end up on a registrar whose DNS cannot do this**, you have two ways out: move the
nameservers to a free Cloudflare account, or put the site on `app.codesageai.dev` instead of the
bare domain — every host handles a subdomain `CNAME` without any special feature.

---

### Step 2 — Decide the addresses (J1.2)

| What | Address |
|---|---|
| The site people visit | `https://codesageai.dev` |
| The backend | `https://api.codesageai.dev` |
| Where sign-in comes back to | `https://api.codesageai.dev/api/auth/callback` |

Write these down. They go into five different dashboards, and a single typo in any one of them costs
an hour of confused debugging. Copy and paste them everywhere; never retype them.

---

### Step 3 — Build the web image with the real address (J1.3)

In GitHub: **Settings → Secrets and variables → Actions → Variables tab → New repository variable**.

- Name: `WEB_API_BASE_URL`
- Value: `https://api.codesageai.dev` — **no trailing slash**

Then **Actions → CI → Run workflow → main**, and wait for green.

Now prove it worked rather than assume it.

```powershell
docker pull ghcr.io/jpabasara/codesage-ai/web:latest
docker run --rm --entrypoint sh ghcr.io/jpabasara/codesage-ai/web:latest -c 'grep -rho api.codesageai.dev .next/static/chunks | sort -u; grep -rho localhost:8000 .next/static/chunks | sort -u'
```

You want to see `api.codesageai.dev` printed and **nothing** on the second line.

| What it prints | What it means |
|---|---|
| `api.codesageai.dev` only | Correct. Carry on. |
| `localhost:8000` | **Stop.** The image was built before the variable existed. Re-run the workflow on `main`, pull again, re-check. |
| nothing at all | The command did not run — see the box below |

Getting this wrong is not a small mistake. The site would load perfectly and send every one of its
requests to the *visitor's* own laptop, where nothing is listening.

> **Two PowerShell traps, both hit while writing this.**
>
> 1. **A trailing `\` does not continue a line.** That is bash. PowerShell uses a backtick, so a
>    pasted multi-line bash command fails with `sh: can't open '\'`. Keep these on one line.
> 2. **Do not put double quotes inside a command you hand to `sh -c`.** PowerShell 5.1 strips them
>    on the way to a native program, so anything they were protecting is then read by `sh` itself.
>    A `|` inside a quoted regular expression becomes a real pipe, and you get
>    `sh: http://localhost:8000: not found`. The command above avoids double quotes entirely, which
>    is why it survives.

Verified 20 Aug 2026: the published image contains `api.codesageai.dev` and no `localhost:8000`.

---

### Step 4 — Neon (J1.4)

**This is the step most likely to go wrong**, and the reason is worth understanding rather than
copying past.

Create the project, pick the region closest to you, let Neon create a database. Neon gives you one
role, and that role owns everything.

**Our application deliberately does not connect as that role.** Postgres has a feature that keeps
one workspace's rows invisible to another, and it is *switched off for whoever owns the tables* —
silently, with no error. Connect as the owner and every isolation rule in the database stops
applying while appearing to work perfectly. So there are two roles on purpose: one owns the tables
and runs migrations, and a second, weaker one is what the application connects as.

| | `neondb_owner` | `codesage_app` |
|---|---|---|
| Who made it | Neon, automatically | you, with the SQL below |
| Can it create or alter tables? | yes | **no** |
| Used by | `alembic upgrade head`, once | the API and the worker, always |
| Ends up in | `CODESAGE_MIGRATION_DATABASE_URL` (your laptop) | `CODESAGE_DATABASE_URL` (Railway) |

#### 4a. Create the second role

Locally that second role is created by `infra/postgres/init/01-init.sql` — but that file only runs
inside our own Postgres container. **Neon never sees it.** Skip this and J1.5 fails with
`role "codesage_app" does not exist`.

So in Neon's **SQL Editor**, run the following. Substitute the owner role Neon actually gave you
(usually `neondb_owner`), the database name it actually created (usually `neondb`), and **a password
you invent** for the app role — nothing gives you this one, you are creating a brand-new login:

```sql
CREATE ROLE codesage_app WITH LOGIN PASSWORD '<invent-a-strong-one>'
    NOSUPERUSER NOCREATEDB NOCREATEROLE;

GRANT CONNECT ON DATABASE neondb TO codesage_app;
GRANT USAGE   ON SCHEMA   public TO codesage_app;

ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO codesage_app;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO codesage_app;
```

Check it took:

```sql
SELECT rolname FROM pg_roles WHERE rolname LIKE 'codesage%';
```

> **Those last two statements are why step 4 must come before step 5.** They are a standing
> instruction about *future* tables — "whenever the owner creates one, let `codesage_app` read and
> write its rows". Run the migration first and the tables arrive with no permissions attached, and
> the API will connect happily and then fail on every query.

#### 4b. Collect the two connection strings

Both come from the same **Connect** dialog on the Neon dashboard, with two settings changed between
them. Take them now, while you are here.

| | For the migration (step 5) | For Railway (step 7) |
|---|---|---|
| **Role** dropdown | `neondb_owner` | `codesage_app` |
| **Connection pooling** toggle | **off** | **on** |
| Host you end up with | `ep-xxxx.region.aws.neon.tech` | `ep-xxxx**-pooler**.region.aws.neon.tech` |

Then **change the prefix on both** from `postgresql://` to `postgresql+psycopg://`. Neon writes the
plain form; our code needs the driver named. Leave `?sslmode=require&channel_binding=require` alone —
`sslmode` is why Neon accepts the connection at all, and `channel_binding` just adds a check that
you are talking to the real server.

> **Why pooling is off for one and on for the other.** The pooler holds a small set of open
> connections and lends them out a statement at a time. That is exactly right for the API and the
> worker, which make many short requests. It is wrong for Alembic, which changes the shape of the
> database and needs a connection that stays its own for the whole job. Using the pooled address for
> a migration is a good way to get a failure halfway through.
>
> The pooled host is the same name with `-pooler` inserted before the region, so the two strings
> differ by seven characters. Read carefully.

---

### Step 5 — Run the migration (J1.5)

From your laptop, not from a container.

#### 5a. Put the address in `apps/api/.env`

Do **not** set a Windows environment variable. `alembic/env.py` reads the address through the
application's own settings, which load `apps/api/.env` — and that file is already gitignored, so the
password never reaches the repository.

Open `apps/api/.env` (it exists already, with the local docker settings in it) and point the
migration line at Neon, keeping the local one commented out so you can switch back:

```
# ── Migrations: currently pointed at NEON (J1.5) ────────────────────────────
# Direct endpoint, NOT the -pooler one.
CODESAGE_MIGRATION_DATABASE_URL=postgresql+psycopg://neondb_owner:PASS@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require&channel_binding=require
# CODESAGE_MIGRATION_DATABASE_URL=postgresql+psycopg://codesage_owner:devpassword@localhost:5433/codesage
```

No quotes around the value — a `.env` file is not a shell.

**Leave `CODESAGE_DATABASE_URL` alone.** That one is for running the API on your laptop and should
stay pointed at local docker. Neon's `codesage_app` address belongs in Railway, not here.

> **Remember to switch back** when you next want to migrate the local database. The Neon line is
> live; comment it and uncomment the one below it. Otherwise a routine `alembic upgrade head` on
> your laptop quietly runs against the deployed database.

#### 5b. Run it

`alembic` is installed in the api's own virtual environment, not on your PATH — which is why
`alembic` on its own reports "not recognized":

```powershell
cd apps\api
.\.venv\Scripts\Activate.ps1
alembic upgrade head
```

#### 5c. Check it

Open Neon's **Tables** view and count: **27**. Fewer than that means the migration stopped partway
through — read the error and fix the cause. Do not simply run it again and hope.

---

### Step 6 — Upstash (J1.6)

Create a Redis database, in a region near whichever Railway region you pick. Copy the address that
starts `rediss://` — two s's, meaning encrypted.

What Redis is doing here: it is the queue the API drops scan jobs into and the worker picks them up
from, plus somewhere to keep *"this scan is 40% done"* and *"this scan was cancelled"*. It holds
nothing you would miss.

Two things to watch:

- Celery needs the encrypted address spelled `rediss://`, and may want `?ssl_cert_reqs=required`
  added on the end. If the worker will not connect, try that first.
- Upstash's free plan counts commands, and Celery talks to the broker continuously even when there
  is nothing to do. Look at the counter on the first day rather than at the end of the month.

> **If it fights you for more than half an hour, stop and use Railway's own Redis instead**
> (Railway → New → Database → Redis). It costs a few cents a month, needs no encryption fiddling,
> and nothing valuable lives in it. §9 chose Upstash so the data survives Railway being switched
> off — that reasoning is sound for the database and does not apply here at all.

---

### Step 7 — Railway (J1.7, J1.8)

One project, three services. Every one runs an image we already published, so nothing is built on
Railway.

> **You need the Hobby plan, not the free trial — and the reason is the domain.** Railway's
> documentation limits the **Trial plan to 1 custom domain in total**, while **Hobby allows 2 per
> service**. We need two: `codesageai.dev` on `web` and `api.codesageai.dev` on `api`. So the trial
> cannot do this deployment at all. Hobby's allowance is comfortably enough — it even leaves room
> for `www.codesageai.dev` later, which counts as a second domain on the `web` service.
>
> Hobby is $5 of minimum spend that comes with $5 of credit, so it is the same money §9 already
> budgeted.

#### Service `api`

| Setting | Value |
|---|---|
| Image | `ghcr.io/jpabasara/codesage-ai/api:latest` |
| Port | `8000` |
| Health check path | **`/api/healthz`** |

> ⚠️ **Never point the health check at `/readyz`.** It returns 500 by design — it is an unfinished
> stub (deployment log, Entry 2). Railway would see the 500 and refuse to send traffic to a
> container that is working perfectly.

Variables — Railway's **Raw editor** accepts this whole block in one paste:

```
CODESAGE_DATABASE_URL=postgresql+psycopg://codesage_app:PASS@ep-xxxx-pooler.region.aws.neon.tech/neondb?sslmode=require&channel_binding=require
CODESAGE_REDIS_URL=rediss://...upstash.io:6379
CODESAGE_ASGARDEO_BASE_URL=https://api.asgardeo.io/t/<your-org>
CODESAGE_ASGARDEO_CLIENT_ID=...
CODESAGE_ASGARDEO_CLIENT_SECRET=...
CODESAGE_ASGARDEO_REDIRECT_URI=https://api.codesageai.dev/api/auth/callback
CODESAGE_FRONTEND_BASE_URL=https://codesageai.dev
CODESAGE_CORS_ORIGINS=["https://codesageai.dev"]
CODESAGE_COOKIE_SECURE=true
CODESAGE_SECRET_KEY=<generate a fresh one>
CODESAGE_ML_TIMEOUT_SECONDS=5
CODESAGE_LOG_LEVEL=INFO
```

Four of those need explaining:

- **`CODESAGE_DATABASE_URL` uses the `-pooler` host**, unlike the migration address in step 5. The
  API and the worker make many short requests, which is what the pooler is for. Step 5 deliberately
  used the un-pooled one because Alembic needs a connection of its own.

- **`CODESAGE_CORS_ORIGINS` must be written in square brackets with double quotes**, exactly as
  above. The setting is read as a *list*, not as text, and the plain form shown in
  `apps/api/.env.example` would stop the service from starting at all. `infra/docker-compose.yml`
  already writes it the correct way — copy that shape.
- **`CODESAGE_COOKIE_SECURE=true`** — locally it is `false`, because plain http cannot carry a
  Secure cookie. Anywhere real it must be `true`.
- **`CODESAGE_ML_TIMEOUT_SECONDS=5`**, lowered from the default 30, because we are deliberately not
  deploying the ML service. The system is built to carry on without it, but at the default setting
  it waits half a minute before giving up on every call. Five seconds stops a scan crawling.

Generate the secret key with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

#### Service `worker`

| Setting | Value |
|---|---|
| Image | `ghcr.io/jpabasara/codesage-ai/api:latest` — **the same image as `api`** |
| Start command | `celery -A codesage_api.worker worker --loglevel=INFO --concurrency=1` |
| Domain, port, health check | **none** — it serves no web traffic |

Variables: only `CODESAGE_DATABASE_URL` and `CODESAGE_REDIS_URL`. Nothing else is needed.

**Do not attach a storage volume.** Each scan clones a repository into roughly 2 GB of scratch space
and throws it away afterwards. Paid storage is for the database only (§9).

One image serving two services with different commands is the design, not a shortcut — the API and
the worker share the domain model, so shipping two images would mean maintaining the same contract
on both sides of a network boundary.

#### Service `web`

| Setting | Value |
|---|---|
| Image | `ghcr.io/jpabasara/codesage-ai/web:latest` — the one you rebuilt in step 3 |
| Port | `3000` |
| Variables | **`PORT=3000`, and nothing else** |

`PORT` is the one exception, and it is not optional. Railway injects a `PORT` of its own choosing,
and Next reads it at startup — so without this the container listens on Railway's port while the
custom domain is routing to 3000, and every request returns **502**. Setting it explicitly makes the
two agree. *(Hit on 20 Aug: the generated Railway domain worked while `codesageai.dev` gave 502.)*

Everything **else** the frontend needs was frozen into the image when it was built, and any other
variable you set here is read by nobody. If the site points at the wrong backend, the fix is step 3
and a rebuild — never a setting on this screen.

#### `ml` is not deployed

Deliberately. §9 explains why, and the design already treats the model service as optional: the scan
finishes without it, every rule finding still appears, and risk comes back as "not measured".

---

### Step 7b — When a deployment will not go Active

Every failure in Phase 1 on 20 Aug looked identical from the outside, and the trap is in that
sameness. Read this before changing anything.

#### The symptom that misleads

A failed deployment shows `1/1 replicas never became healthy` and 11 healthcheck attempts. Meanwhile
the service still says **Online** and `https://api.codesageai.dev/api/healthz` still answers **200**.

> **Railway keeps the previous container running when a new deployment fails.** So a green healthcheck
> from outside proves the *old* build is alive — it says nothing about the change you just made.
> The deployment badge, not the URL, is what tells you whether your fix is live.

And `/api/healthz` never touches the database on purpose (it is a liveness check), so no amount of
polling it will reveal a broken database setting. **Signing in is the first request that opens a
database connection.** That is why everything looked healthy for an hour while the URL was wrong.

#### How to read the log

Deploy Logs, not Network Logs — Network Logs only shows status codes. Then scroll to the **very
bottom**. A Python traceback's middle is the call chain and is identical every time; the answer is
the last line, the one beginning with an error name:

| Last line | What it means | Fix |
|---|---|---|
| `ModuleNotFoundError: No module named 'psycopg2'` | URL says `postgresql://`, so SQLAlchemy loaded its default driver. The image ships psycopg **3** | prefix must be `postgresql+psycopg://` |
| `SettingsError: error parsing value for field "cors_origins"` | `CODESAGE_CORS_ORIGINS` written as plain text | must be `["https://codesageai.dev"]` |
| `invalid channel_binding value: "('requiresslmode=require', ...)"` | the `&` between query parameters was lost | end the URL at `?sslmode=require` |

The first two kill the app at **import**, before uvicorn binds a port — hence a healthcheck that can
never pass. The third starts fine and fails later, on the first query.

#### The database URL, spelled out

Neon's copy button gives you something that will not work as-is. Three edits, every time:

```
postgresql://codesage_app:PASS@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require&channel_binding=require
└─ 1 ─┘                        └── 2 ──┘                                          └────── 3 ──────┘
```

1. `postgresql://` → **`postgresql+psycopg://`** — this names the driver. Neon cannot know it
2. add **`-pooler`** to the host (or toggle Connection pooling on before copying)
3. **delete `&channel_binding=require`** — `sslmode=require` alone still encrypts the connection

---

### Step 8 — Point the domain at Railway (J1.9)

**First, in Railway.** On the **`api`** service: Settings → Networking → **Custom Domain** → type
`api.codesageai.dev`. Railway responds with a target address ending in `.up.railway.app` — copy it.
Do the same on **`web`** with `codesageai.dev`, and copy that target too. They are two different
targets; do not mix them up.

**Then, in Spaceship.** Open the domain → **Advanced DNS Manager** → **DNS records → Custom
records**, and add two:

| Type | Host | Value |
|---|---|---|
| `CNAME` | `api` | the target Railway showed for **api** |
| `CNAME` | `@` | the target Railway showed for **web** |

> **The `@` record is the bare domain, and it is the one that needed checking.** Choose the plain
> `CNAME` type and put `@` in the host field — do **not** go looking for an "ALIAS" option. Spaceship
> converts it automatically and serves it as an address record. If you later run a DNS lookup on
> `codesageai.dev` and see an `A` record instead of the `CNAME` you typed, nothing is wrong; that is
> the conversion doing its job.

> **Two traps hit on 20 Aug, both worth 20 minutes each.**
>
> 1. **Railway also asks for a TXT record, and its name starts with an underscore** —
>    `_railway-verify.api`, and `_railway-verify` for the apex. The underscore is required; it marks
>    a record meant for machines rather than browsers. Strip it and verification never completes,
>    the domain stays yellow, and no certificate is issued. If Spaceship's host field refuses a
>    leading underscore, type the whole name instead: `_railway-verify.api.codesageai.dev`.
> 2. **Use "Generate Domain" or "Custom Domain", never "TCP Proxy".** A TCP proxy publishes a raw
>    `host:port` endpoint for non-HTTP services. On a web service it is both useless and an
>    unencrypted way into the container. Delete any you created.
>
> Both domains also need their **port** set explicitly when you attach them: `api` → 8000,
> `web` → 3000. Leaving it to Railway's guess is how `codesageai.dev` ends up returning 502 while
> the generated `*.up.railway.app` address works.

Wait for Railway to report the certificate as issued — usually a couple of minutes, occasionally
longer while the DNS change spreads. Then open `https://api.codesageai.dev/api/healthz` in a browser.

Once both custom domains work, remove the temporary `*.up.railway.app` domain from `api`. Leaving it
means the backend is reachable at an address that is not in the CORS list and not on our cookie's
site — harmless, but it makes future debugging ambiguous. One address, one answer.

---

### Step 9 — Asgardeo (J1.10)

In the Asgardeo console, open the application and add to **Authorized redirect URLs**:

```
https://api.codesageai.dev/api/auth/callback
```

**Keep the existing `localhost` entry too**, so local development still works.

If the console also asks for allowed origins, add `https://codesageai.dev`.

§13 lists this as the most likely thing to break, and the cause is always the same: one character
different. Copy and paste it from your scratch file. Watch especially for a trailing slash.

---

### Step 10 — The three checks (J1.11–J1.13)

Do these in order. Each one tells you something the others do not.

**1. `https://api.codesageai.dev/api/healthz`** → `{"status":"ok"}`
The backend is alive and the domain reaches it.

**2. `https://api.codesageai.dev/api/projects`, in a private window** → **401**
This is the one never to skip. It proves the application refuses strangers. A 200 here would mean
every workspace's data is readable by anyone with the address.

**3. `https://codesageai.dev`** → sign in → you land on the projects page.

If step 3 fails, work through it in this order — each stage rules out the one before:

| What you see | Almost always |
|---|---|
| The browser never reaches Asgardeo | `CODESAGE_ASGARDEO_REDIRECT_URI` wrong in Railway |
| It reaches Asgardeo but errors on the way back | The callback URL is not registered in Asgardeo, or differs by a character |
| You come back but land on the login page again | `CODESAGE_COOKIE_SECURE`, or `CODESAGE_FRONTEND_BASE_URL` |
| You reach the dashboard but its data calls return 401 | The CORS list — **or see the note below** |

> **Expect 401s on the dashboard's data at this point, and do not chase them.** The frontend does
> not yet ask the browser to attach the session cookie to its requests — that is **J2.7**, already
> on the Phase 2 list. The cookie exists and is the right kind; nobody is sending it yet. Sign-in
> itself will work, because that is a full page navigation rather than a background request.
> Changing backend settings to chase these will only break something that is currently correct.
>
> The live path is finished at **J2.9**, not here. Phase 1 is done when sign-in completes and the
> two checks above pass.

---

### Step 11 — Money, and switching it off (J1.14, J1.15)

Railway → your workspace → **Usage** → set the limit to **$15**.

**Not $5.** Railway *stops your services* when a hard limit is reached, and a cap at exactly the plan
minimum could take the site down in the middle of the evaluation. The cap is a safety net against
something stuck in a loop overnight. It is not how you control the bill.

You control the bill by not leaving things running. From Railway's own per-second prices, memory
works out at roughly **$10 per GB per month** and active CPU at roughly **$20 per vCPU per month** —
and an idle container uses almost no CPU. Our three services sitting idle come to about
**25 cents a day**, so the $5 credit is around two weeks of continuous uptime. A two-minute scan
costs a few cents.

> §9 estimated $10–20 a month and "about ten days". That was the conservative reading, based on
> provisioned box sizes. Railway bills **actual memory in use**, not the ceiling you are allowed, so
> the real figure is friendlier. The advice does not change — stop things when they are not needed —
> but you have more headroom than the plan assumed.

So the plan is:

1. Deploy on the 19th, run the three checks.
2. **Stop all three services.** Stopped services cost nothing.
3. Restart on the 23rd and leave them up through the evaluation.

**Neon and Upstash stay on the whole time** — they are free, and they hold the data. Your database
survives Railway being switched off entirely.

---

### When you are done

Record it. Add **Entry 4** to
[deployment-implementation-log.md](deployment-implementation-log.md) covering what you set where,
anything that surprised you, and how to check it still works. The value of that file is that the
next person — or you in three weeks — does not have to re-derive any of this.

Then tell the group the live addresses, and start Phase 2 — beginning with **J2.7**, not J2.1.
See §6b for the running order and why it differs from the numbering.

## 6b. Phase 2 — frontend (Fri 21 – Sun 23)

This is Phase 10.6 from the build guide.

**The order below is not the order the steps are numbered in.** The J-numbers are fixed labels —
they are referenced in `deployment-implementation-log.md` and in messages to the rest of the team,
so renumbering them would break those references. The **Order** column is what you actually follow.

Three of the nine are already done. Of the six that remain, one rule matters more than the rest:

> **J2.2, J2.5 and the type half of J2.4 all edit the same file — `src/lib/types/index.ts`.**
> Make all three edits, *then* run the type checker once. Doing them separately means working
> through the same ~244 compiler errors three times over.

| Order | # | Step | Done when |
|---|---|---|---|
| ✅ | J2.1 | `pnpm gen:types` | **Done.** `src/lib/types/api.ts` is generated from the contract |
| ✅ | J2.2 | Rename every field to snake_case | **Done.** Types match the contract field-for-field |
| ✅ | J2.3 | Category filter: five chips, `defect` removed | **Done.** Five categories show |
| ✅ | J2.4 | Profiles page: five weights plus the trust slider | **Done.** Six numbers, Apply saves them |
| ✅ | J2.5 | Add `cancelled` to the scan states | **Done.** A stopped scan reads *Cancelled*, not *Idle* |
| ✅ | J2.6 | Sign-in button points at the real backend | **Done.** A plain link, never a fetch |
| ✅ | J2.7 | Add `credentials: "include"` to every request | **Done.** Proven live at J2.9 |
| ✅ | J2.8 | Update the mock handlers to the new shapes | **Done.** `pnpm test` green with no backend running |
| **1** | **J2.10** | **Connect a repository from the Projects page** | **Pasting a public GitHub URL adds it to the list, and it is still there after a refresh** |
| **2** | J2.9 | Redeploy and walk the whole path on the live URL | It works there, not just locally |

---

### ✅ J2.7 — Attach the session cookie to every request

**What.** Every function in `src/lib/api/client.ts` calls plain `fetch(...)` with no options. Add
`credentials: "include"` to each one. `src/components/layout/app-rail.tsx` already does this on the
sign-out call — copy that pattern.

**Why it goes first.** It is about ten lines in one file, it depends on nothing else, and it is the
only thing standing between a signed-in user and real data. It also clears a question mark: once it
is done, any 401 you see afterwards is a genuine bug rather than this known gap.

**Done when.** DevTools → Network → the `projects` request carries a `Cookie` header, and the
response changes from **401 to 500**. A 500 is the correct result here — the backend endpoint is
still `raise NotImplementedError`. **401 → 500 is the win.**

**Trap.** Do not stop at the two or three calls the Projects page happens to use. Every function in
the file needs it, or the failure reappears later on a page nobody was testing.

### ✅ J2.1 — Regenerate types from the contract *(already done)*

`src/lib/types/api.ts` is generated from `docs/api/openapi.yaml` by `pnpm gen:types`. It is the
source of truth for the three steps below — when the two disagree, the generated file is right.
Re-run it if the contract changes; `pnpm gen:types:check` fails the build if the file has drifted.

### ✅ J2.2 — Rename every field to snake_case

**What.** The contract uses snake_case (`repo_id`, `latest_health`, `health_score`, `commit_sha`).
Our hand-written `src/lib/types/index.ts` still uses camelCase — `latestHealth`, `codeDesign`,
`scanId`, `repoId`, `commitSha`, `wMl`, `isPreset`. Bring it in line with the generated file.

**Why here.** It is the largest single change and it produces the compiler errors that find
everything else. Everything after this point is easier because of it.

**How.** Change the type definitions **first**, then run `pnpm typecheck` and work down the list it
prints. Do not go hunting through components by hand — the compiler already knows every site.

**Done when.** `pnpm typecheck` passes.

### ✅ J2.5 — Add `cancelled` to the scan states

**Do this inside the J2.2 pass**, while you are already in that file.

**What.** `ScanPhase` in `index.ts` is `"idle" | "queued" | "running" | "done" | "error"`. The
contract has one more: `"cancelled"`. Add it.

**Trap — this one is quiet.** Adding the member will **not** break the build.
`src/components/layout/scan-control.tsx` only asks `phase === "running" || phase === "queued"`, so a
cancelled scan falls into the "not running" branch and renders identically to idle. The compiler
cannot catch this because there is no exhaustive switch to fail. You have to render it deliberately.

**Why it matters.** The contract is explicit that `cancelled` is a distinct terminal phase, **not**
`idle` — precisely so a cancelled attempt is never mistaken for a completed one.

**Done when.** A stopped scan reads *Cancelled*, not *Idle*.

### ✅ J2.4 — Profiles page: five weights plus the trust slider

**This is bigger than the table line suggests.** `src/app/(app)/profiles/page.tsx` is currently a
placeholder — a heading and one sentence. There is no weights UI to edit; the page has to be built.

**Two parts:**

- **The type** — `weights` today has four keys (`security`, `codeDesign`, `satd`, `duplication`).
  The contract's `CategoryWeights` has **five**, matching the five categories, plus a separate trust
  slider `s` where `0` = trust the model and `1` = trust the rules. *Do this half during J2.2.*
- **The UI** — five weight inputs, one slider, an Apply button.

**Done when.** Six numbers on screen, and Apply saves them.

**Expect.** The backend `PUT` is still a stub, so Apply will return 500 until Chamodh's C-phase.
Build and test against the mock handlers; that is what they are for.

### ✅ J2.3 — Category filter: five chips *(already done)*

Verified in `src/components/dashboard/overall-health-card.tsx`: five categories — `code-design`,
`security`, `documentation`, `requirement`, `test` — matching the contract enum exactly. `defect`
appears nowhere in `src/` except in generated comments explaining why it does not exist (the SATDAUG
dataset carries no `defect_debt` label, so it cannot be produced).

### ✅ J2.6 — Sign-in button points at the real backend *(already done)*

`src/app/(auth)/login/page.tsx` is a plain `<a href>` to `/api/auth/login`, not a fetch. That is
required, not a style choice: the browser has to physically leave the page for an OIDC flow, and a
fetch would stay put and never complete the sign-in.

### ✅ J2.8 — Update the mock handlers

**What.** `src/lib/mocks/fixtures.ts` still returns the old shapes — camelCase keys and four
weights. Bring it in line with whatever J2.2, J2.4 and J2.5 settled on.

**Why here and not earlier.** The mocks mirror the types. Updating them before the types are final
means updating them twice.

**Why it matters.** The mocks are what let the frontend be developed and tested while every backend
endpoint is still a stub. If they drift from the real shapes, the tests pass against a fiction and
the live site breaks in ways nothing caught.

**Done when.** `pnpm test` is green with no backend running.

### 1 · J2.10 — Connect a repository from the Projects page

**Why this is a new step.** It was never on anyone's frontend list, and it is
**step 2 of the four-step demo path** — sign in → *connect a repository* → run a scan →
see the dashboard. Without it there is no repository to scan, so nothing downstream can
be demonstrated on the live site.

**What is there now.** `src/components/projects/connect-repo.tsx` is a working form —
input, Connect button, submit handler. It calls an optional `onConnect` prop. The
Projects page renders `<ConnectRepo />` **without passing one**, so `onConnect?.()`
resolves to `undefined`, the input clears, and nothing happens. It looks like it worked.

**Four things are missing, and all four are frontend:**

| | |
|---|---|
| `connectRepo()` in `src/lib/api/client.ts` | `POST /api/projects`, body `{ url }`, with `credentials: "include"` |
| `onConnect` wired on the Projects page | call it, then refresh the list |
| An MSW handler for `POST */api/projects` | so it works with no backend, and the tests cover it |
| Error handling | the contract returns `INVALID_REPOSITORY_URL`, `REPOSITORY_NOT_PUBLIC`, `REPOSITORY_UNREACHABLE` and `ALREADY_CONNECTED` — each needs a message, not a silent failure |

**Depends on Chamodh's C1.2** for real data, but not for the frontend work: build it
against the mock handler exactly as every other screen was built.

**Done when.** Pasting a public GitHub URL adds it to the list, and it is still there
after a refresh.

**Also remove the "Private (GitHub)" tab.** The SRS specifies this panel exactly:

> Connect panel: an example URL text box and a Connect button with inline validation.

No tabs, and no private option. The two-tab layout is something the prototype invented.
Connecting a private repository is **v2** — it needs a GitHub App installation and the
SRS **SEC-04**/**SEC-06** authorization controls, both tagged `[v2]`. The tab currently
advertises a feature two releases away, and it would be on screen during the evaluation.

Note the distinction: **`Repo.visibility` stays.** FR-3 records visibility from v1.0 and
the projects list displays it per row. What moves to v2 is *connecting* a private repo,
not knowing whether a repo is private.

### 2 · J2.9 — Redeploy and walk the whole path on the live URL

Everything in the codebase is ready. What remains is deployment and observation — the steps
below are **yours to do by hand**, in this order.

**What you are actually proving.** Not that the app works: it cannot yet, because every
backend endpoint is still a stub. You are proving that **sign-in, the session cookie, CORS
and routing work on the live site** — that a request arrives authenticated and reaches the
right endpoint. The endpoint having nothing to say yet is Chamodh's half.

#### Before you deploy

| | Step | Why |
|---|---|---|
| 1 | Merge the frontend branch to `main` | CI only pushes images to GHCR from `main` |
| 2 | Confirm CI is green | A red build means the image was never published |
| 3 | Check `WEB_API_BASE_URL` is still `https://api.codesageai.dev` in GitHub | Frozen into the image at **build** time, never read at runtime |
| 4 | Start the `api` and `web` services on Railway | `worker` can stay stopped; nothing enqueues jobs yet |

> **The `NEXT_PUBLIC_API_BASE_URL` trap.** It is baked in at build time. A local
> `.env.local` pointing at `localhost:8000` will ship inside the image if the build arg is
> missing, and the site will silently call a machine that is not there. Verify the built
> image contains `api.codesageai.dev` and no `localhost:8000` before trusting anything else.

#### The walk

Sign in on `https://codesageai.dev`, then open DevTools → Network and click through:
sign in → projects → a dashboard → sign out.

| # | Check | Pass looks like |
|---|---|---|
| 1 | `GET /api/healthz` | `{"status":"ok"}` |
| 2 | `GET /api/projects` in a **private window** | **401** `NOT_AUTHENTICATED` — never skip this |
| 3 | Sign in | You land on `/projects` and the page renders |
| 4 | The `projects` request carries a **`Cookie` header** | **This is J2.7 finally proven.** Request side, not response |
| 5 | Its response is **501**, not 401 | 401 → 501 is the win. The request arrived authenticated |
| 6 | Response has `access-control-allow-origin: https://codesageai.dev` | CORS is correct |
| 7 | The page shows *"This endpoint is not implemented yet."* | The error envelope survives the trip |
| 8 | Connect a repository | Also 501 until **C1.2**. The form, the validation and the messages are all live |
| 9 | Sign out from the rail | Session really ends — re-open `/projects` and you are asked to sign in |

**Done when.** Steps 1–9 pass on the live URL, not on your machine.

#### Expect 501, and do not chase it

`501 This endpoint is not implemented yet.` is the **correct** answer from every stub. It
means the whole chain worked: DNS, TLS, routing, CORS, the cookie, the session lookup, the
tenant binding — all of it — and then the handler had nothing to return. Each endpoint
Chamodh implements turns one 501 into real data with no frontend change.

> **Why 501 and not a CORS error.** Until 22 Aug this walk would have shown a *CORS failure*
> on every data call, and it would have looked like a deployment fault. A stub raises
> `NotImplementedError`, which was unhandled; Starlette's `ServerErrorMiddleware` catches
> unhandled exceptions and sits **outside** `CORSMiddleware`, so its `text/plain` 500 carried
> no `Access-Control-Allow-Origin` and the browser blocked it. `apps/api/errors.py` now
> handles `NotImplementedError` explicitly, which puts the response back inside the CORS
> layer. Registering a handler for bare `Exception` does **not** work — that lands outside
> again. Delete the handler once no endpoint raises `NotImplementedError`.

#### If a step fails

| What you see | Almost always |
|---|---|
| 502 on the custom domain, but `*.up.railway.app` works | The domain lost its explicit port (`api` → 8000, `web` → 3000) |
| Site loads but every call goes to `localhost:8000` | The build arg was missing; rebuild the image |
| Sign-in reaches Asgardeo but errors coming back | The callback URL is not registered, or differs by a character |
| You return from Asgardeo to the login page again | `CODESAGE_COOKIE_SECURE` or `CODESAGE_FRONTEND_BASE_URL` |
| **401** on the data calls, not 501 | The cookie is not being sent — check the *request* for a `Cookie` header before touching any server setting |
| A CORS error rather than a 501 | The API image predates the `NotImplementedError` handler; redeploy `api` |

---

**When Phase 2 is finished**, the frontend is complete and correct against the contract, and every
remaining failure on the live site is a missing backend endpoint. That is the handover point: from
there, each endpoint Chamodh implements turns one 500 into working data with no further frontend
work.

---

## 7. Chamodh — the API and the worker

Start on Monday in `apps/api/src/`. Pull `main` after Janidu's Phase 0 lands on Tuesday evening.

### Phase A — make the read endpoints return real data (Mon 17 – Wed 19)

The frontend needs these to have anything to show.

| # | Step | Done when |
|---|---|---|
| C1.1 | `GET /api/projects` | Returns the workspace's repositories |
| C1.2 | `POST /api/projects` **(demo-critical)** | Connecting a public GitHub repository adds it, and it survives a refresh |
| C1.3 | `GET /api/repos/{id}/branches` | Real branch names from GitHub |
| C1.4 | `GET /api/repos/{id}/scans` | Scan history for a branch |
| C1.5 | `GET /api/profiles` and `GET /api/profiles/active` | Returns the six numbers |
| C1.6 | `PUT /api/profiles/active` | See the warning below |
| C1.7 | Tests: signed out gives 401, signed in gives data, one workspace cannot see another's rows | Tests pass |

> ⚠️ **On applying a profile.** The database guarantees *at most* one active profile — **not at least one**. Clearing the old row and setting the new one must happen in a single transaction. A clear that commits on its own leaves the workspace with no active profile at all. Also remember profiles are **not versioned**: the same row is updated in place.

> **C1.2 is demo-critical and was not marked as such.** It is step 2 of the four-step
> demo path — sign in → *connect a repository* → run a scan → see the dashboard. Every
> later step (C2.x) needs a connected repository to act on, so nothing downstream can be
> demonstrated until this returns real data. Janidu's **J2.10** is the matching frontend
> half; the two can be built in parallel against the mock.

### Phase B — the scan (Thu 20 – Sun 23)

| # | Step | Done when |
|---|---|---|
| C2.1 | `POST /api/repos/{id}/scan` creates an attempt and queues it | Returns 202 with an id |
| C2.2 | `GET .../scan/{id}` reports phase and percentage | The frontend can poll it |
| C2.3 | `POST .../scan/{id}/stop` | The scan stops between stages |
| C2.4 | Progress published to Redis | Percentage moves during a scan |
| C2.5 | Scan pipeline: clone → extract → detect → save | A real repository produces stored findings |
| C2.6 | Rule engine — the four rules already defined | Real findings on real Java files |
| C2.7 | The scoring calculation | `GET /api/repos/{id}/health` returns a real grade |
| C2.8 | Do the summing in SQL, not in Python | Dashboard responds quickly |

### Phase C — demo preparation (Mon 24)

| # | Step | Done when |
|---|---|---|
| C3.1 | Pick a small Java repository that produces good findings | It scans in under two minutes and shows a mix of severities |
| C3.2 | Scan it on the live site and check the dashboard | It looks right |

---

## 8. Nathasha — the model service

Start on Monday in `apps/ml/src/`. Pull `main` after Tuesday evening.

> **Important, and good news: your work is not blocking the demo.** The system is designed to keep working when the model service is unreachable — the scan still finishes, all rule findings appear, and risk comes back as "not measured". So if training runs late, the demo still works. Nobody should re-plan around waiting for models.

### Phase A — the service answers (Mon 17 – Wed 19)

| # | Step | Done when |
|---|---|---|
| A1.1 | The service starts and its health endpoint answers | The API's worker can reach it |
| A1.2 | The SATD endpoint accepts comments and returns predictions, in the shape the contract expects | Even a simple model is fine this week — the shape matters more than the accuracy |
| A1.3 | The risk endpoint accepts metric vectors and returns a score | Same |
| A1.4 | Tests for both endpoints | They pass in CI |

### Phase B — real models (Thu 20 – Sun 23)

| # | Step | Done when |
|---|---|---|
| A2.1 | Train the SATD classifier on SATDAUG | A saved model file exists |
| A2.2 | Evaluate it **per class, with counts** | Numbers written down |
| A2.3 | Serve the trained model instead of the placeholder | Real predictions over HTTP |
| A2.4 | Bug-risk model on the D'Ambros data | Only if time allows |
| A2.5 | Record which model version produced what | Written to the model version table |

> **Never report accuracy**, for either model. Most comments are not debt, so a model that answers "not debt" every time scores well and is useless. Report precision, recall and F1 per class, with how many examples each class had. For the risk model, add AUC.

### Phase C — write-up (Mon 24)

| # | Step | Done when |
|---|---|---|
| A3.1 | Write the model results section of the evaluation document | Per class, with counts, and honest about what is not trained yet |

---

## 9. Deployment plan

### The shape

| Piece | Where | Cost |
|---|---|---|
| Postgres | **Neon** | Free tier |
| Redis | **Upstash** | Free tier |
| web, api, worker, ml | **Railway** | $5 plan, used carefully |

Railway's advantage for us: it has no fixed idea of what a service must be. You give it an image and a command, so the Celery worker — which serves no web traffic and just pulls jobs forever — simply runs. Some platforms have no category it fits into.

### Keeping it inside $5

$5 is a **minimum spend, not a limit**. Four containers running all the time cost roughly $10–20 a month, so $5 buys about **ten days of full uptime**.

Three ways to stay inside it:

1. **Do not run it continuously.** Stopped services cost nothing. Deploy on the 19th, check it, stop it. Restart on the 23rd and leave it up through the evaluation.
2. **Leave the ML container off until needed.** It is the heaviest of the four, and the system is built to work without it. Start it for Nathasha's part of the demo.
3. **Set modest memory limits** on each service. Generous defaults are money spent on nothing.

> **Set the spending cap at about $15, not $5.** When a hard limit is reached Railway *stops your services*. A cap at exactly $5 could take the site down mid-demo. Control the money by controlling when things run; use the cap only as a safety net against something stuck in a loop overnight.

*Check current prices yourself before committing — these pages change.*

### Turning it off and on

You can stop or delete the Railway services whenever you like. The configuration lives in the repository, so bringing it back is minutes.

- **Neon and Upstash stay up** — they are free, and they hold the data. Your database survives Railway being switched off entirely.
- **Secrets live in the Railway dashboard, not in git.** Deleting services means re-entering them. `apps/api/.env.example` lists every one, so keep it accurate.

### Scaling — worth being able to explain

| Part | How it scales | Why |
|---|---|---|
| Web | Add copies | Holds no state |
| API | Add copies | The session is in the database, so any copy can serve any request |
| **Worker** | **Add copies** | The important one. Each worker runs one scan at a time on purpose, because a scan needs its own clone and its own disk space |
| Postgres | A bigger instance | |
| Redis | Rarely the bottleneck | It only holds progress percentages and cancel flags |

The sentence worth saying out loud at the evaluation: **three concurrent scans is a number we change in a dashboard, not a code change.** That falls straight out of the architecture.

### Storage note

Each running scan clones a repository and needs roughly 2 GB of scratch space. **Do not put that on a paid storage volume** — clones are thrown away when the scan ends, so ordinary container disk is right. Keep paid storage for the database only.

---

## 10. Testing and CI

### What runs on every pull request

| Check | What it protects |
|---|---|
| Frontend tests | The dashboard still renders and behaves |
| Type check | Nothing refers to a field that no longer exists |
| Contract check | The contract and the generated types have not drifted apart |
| Backend tests | Database shapes and the scoring formula are still correct |
| Layer check (`lint-imports`) | Scoring stays pure; the worker never calculates scores |
| Lint | |
| **Image build** | It builds on a clean machine, not just on a laptop |

**A red pull request does not get merged.** Turn on branch protection so this is enforced by GitHub, not by good intentions — otherwise it is theatre.

### What to add this week

- **Backend:** tests for the endpoints in Chamodh's Phase A — signed out gives 401, signed in gives data, one workspace cannot see another's rows.
- **Frontend:** the existing tests must survive the rename. They are the safety net for a 244-place change; without them it is guesswork.
- **End to end:** one Playwright test that walks the whole demo path. If that passes, the demo passes.

### Deploying automatically

Once CI is green and steady, have a merge to `main` redeploy. Do this **after** the first manual deploy works — automating something you have never done by hand only hides the failure.

---

## 11. GitHub Project — milestones and issues

### Set it up in this order

**1. Create the labels** (Issues → Labels → New label):

`web` · `api` · `ml` · `infra` · `docs` · `blocked` · `demo-critical`

**2. Create three milestones** (Issues → Milestones → New milestone):

| Milestone | Due | Done when |
|---|---|---|
| **M1 — Buildable and checked** | Tue 18 Aug | All six containers build; CI blocks a failing pull request |
| **M2 — Deployed** | Wed 19 Aug | Live URL; signed-out requests return 401; sign-in works |
| **M3 — One path end to end** | Sun 23 Aug | Scan a real repository on the live site and see the dashboard |
| **M4 — Evaluation ready** | Tue 25 Aug | Rehearsed three times; document finished |

**3. Create a Project board** (Projects → New project → Board):

Columns: `Backlog` · `This week` · `In progress` · `In review` · `Done`

**4. Create one issue per row** in the tables below. Each needs an assignee, a milestone, a label, and one line saying **how we know it is done** — copy the "Done when" column.

**5. Link pull requests to issues.** Put `Closes #12` in the pull request description and GitHub closes the issue when it merges. This is what makes the board update itself instead of rotting.

**6. Anything not needed by the 25th goes in `Backlog` with no milestone.** Being able to show a marker "here is what we deliberately deferred, and why" is worth more than a board where everything looks urgent.

### The issues

| # | Issue | Who | Milestone | Label |
|---|---|---|---|---|
| 1 | Write `apps/web/Dockerfile` | Janidu | M1 | web, infra |
| 2 | API address as a build argument, not a runtime setting | Janidu | M1 | web, infra |
| 3 | Make all six containers build and start together | Janidu | M1 | infra |
| 4 | CI: run tests, type check, contract check, layer check | Janidu | M1 | infra |
| 5 | CI: build all three images | Janidu | M1 | infra |
| 6 | CI: publish images to GitHub Container Registry | Janidu | M1 | infra |
| 7 | Branch protection — a red pull request cannot merge | Janidu | M1 | infra |
| 8 | Neon database created and migrated | Janidu | M2 | infra |
| 9 | Upstash Redis created | Janidu | M2 | infra |
| 10 | Four containers deployed to Railway | Janidu | M2 | infra |
| 11 | Asgardeo callback address set for the live site | Janidu | M2 | infra |
| 12 | Signed-out request returns 401 on the live site | Janidu | M2 | infra, demo-critical |
| 13 | Spending cap set | Janidu | M2 | infra |
| 14 | Regenerate types from the contract | Janidu | M3 | web |
| 15 | Rename every field to snake_case | Janidu | M3 | web |
| 16 | Category filter shows five chips | Janidu | M3 | web |
| 17 | Profiles page: five weights and the trust slider | Janidu | M3 | web |
| 18 | Add `cancelled` to the scan states | Janidu | M3 | web |
| 19 | Sign-in points at the real backend | Janidu | M3 | web, demo-critical |
| 20 | Every request sends the session cookie | Janidu | M3 | web, demo-critical |
| 21 | Mock handlers updated to the new shapes | Janidu | M3 | web |
| 22 | List and connect projects | Chamodh | M2 | api |
| 23 | List branches | Chamodh | M2 | api |
| 24 | Scan history | Chamodh | M2 | api |
| 25 | Read and apply a profile, in one transaction | Chamodh | M2 | api |
| 26 | Endpoint tests: 401, data, tenant isolation | Chamodh | M2 | api |
| 27 | Start a scan | Chamodh | M3 | api, demo-critical |
| 28 | Poll scan status | Chamodh | M3 | api, demo-critical |
| 29 | Stop a scan | Chamodh | M3 | api |
| 30 | Progress published to Redis | Chamodh | M3 | api |
| 31 | Scan pipeline end to end | Chamodh | M3 | api, demo-critical |
| 32 | Rule engine produces real findings | Chamodh | M3 | api, demo-critical |
| 33 | Scoring calculation and the dashboard read | Chamodh | M3 | api, demo-critical |
| 34 | Choose a demo repository | Chamodh | M4 | api, demo-critical |
| 35 | Model service health endpoint | Nathasha | M2 | ml |
| 36 | SATD endpoint returns predictions in the contract's shape | Nathasha | M2 | ml |
| 37 | Risk endpoint returns a score | Nathasha | M2 | ml |
| 38 | Tests for both endpoints | Nathasha | M2 | ml |
| 39 | Train the SATD classifier on SATDAUG | Nathasha | M3 | ml |
| 40 | Evaluate per class, with counts | Nathasha | M3 | ml |
| 41 | Serve the trained model | Nathasha | M3 | ml |
| 42 | Record model versions | Nathasha | M3 | ml |
| 43 | Bug-risk model (only if time allows) | Nathasha | Backlog | ml |
| 44 | Write the model results section | Nathasha | M4 | docs |
| 45 | End-to-end test of the demo path | Janidu | M4 | web |
| 46 | Automatic redeploy when `main` changes | Janidu | Backlog | infra |
| 47 | Update the Gantt chart | Janidu | M4 | docs |
| 48 | Write the mid-evaluation document | all | M4 | docs |


---

## 12. The mid-evaluation document

Create `docs/Progress Evaluations/progress_evaluation_02_2026-08-25.md`, in the same style as the last one:

1. **What works today** — with the live URL. Demonstrate, do not describe.
2. **What is designed but not built** — say it plainly. "Designed and stubbed, not implemented" costs nothing; being caught overstating costs everything.
3. **The architecture, and why** — a modular monolith rather than microservices, and the reasons.
4. **Decisions we reversed, and why** — this is a strength, not an admission. Sign-in moved from the browser to the backend. Six debt categories became five when the dataset turned out to have no label for the sixth. Profiles stopped being versioned. Each one has a written record.
5. **How the work is divided** — folder ownership, and the contract that makes parallel work possible.
6. **Quality** — what CI checks on every pull request, what the tests cover, what they do not.
7. **Model results so far** — per class, with counts. Never accuracy.
8. **Deployment and scaling** — how three concurrent scans is a setting, not a rewrite.
9. **What is next, and what we deliberately deferred.**

**Rule for the whole session:** never claim something is done when it is a skeleton.

---

## 13. Honest risks

| Risk | Likely | What we do |
|---|---|---|
| The first deployment eats a whole day | High | Which is why it is on day three, not day eight |
| Sign-in works locally, fails on the live site | High | Almost always the callback address not matching Asgardeo exactly. Check on the first deploy |
| The frontend rename takes longer than planned | High | It is mechanical and the compiler finds every place. Start Thursday, not Saturday |
| The scan pipeline is not finished by the 23rd | Medium | Demo on a small repository. Five files prove the same pipeline as five hundred |
| Models not trained in time | Medium | **Already handled by the design.** The scan finishes without them |
| Railway bill grows unnoticed | Medium | Cap at $15; keep it stopped when not needed |
| Something breaks on the 24th | Medium | Code freeze Monday midday. After that, only fixes for broken things |

---

## 14. The Gantt chart needs updating

Three things on it no longer match reality:

- **"Implement Multi-tenancy, Auth & RBAC" shows as not started.** Multi-tenancy and sign-in are done. Role-based access is a version 2 feature we decided not to build — it should be removed, not left looking unfinished.
- **There is no row for deployment and none for CI.** Both are happening this week. Work that is not on the chart looks like work that was not planned.
- **The dates run behind.** Better to move them and explain why than to present a chart everyone can see is wrong.

A chart that matches reality is evidence of managing the project. One that does not is evidence of the opposite.
