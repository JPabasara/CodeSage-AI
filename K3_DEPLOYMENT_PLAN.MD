# Code Sage AI k3s Deployment Plan on Linode

This plan moves the current Railway deployment to one Akamai/Linode Compute Instance running k3s.

The current production stack is:

- `web` at `https://codesageai.dev`
- `api` at `https://api.codesageai.dev`
- `worker`
- `score-worker`
- `ml`
- Neon Postgres outside the app host
- Upstash Redis outside the app host

The target stack is the same app, but running in Kubernetes:

```text
Akamai/Linode Compute Instance
8 GB RAM / 4 vCPU
Ubuntu
k3s

Public:
  codesageai.dev      -> web
  api.codesageai.dev  -> api

Private inside cluster:
  ml
  worker
  score-worker

Outside cluster:
  Neon Postgres
  Upstash Redis
```

The three public container images stay public:

```text
ghcr.io/jpabasara/codesage-ai/web
ghcr.io/jpabasara/codesage-ai/api
ghcr.io/jpabasara/codesage-ai/ml
```

`worker` and `score-worker` use the same `api` image with different Celery commands.

---

## Phase 1 - Add the repo folder structure

Create the Kubernetes deployment files in this repo first. The deployment must be reviewable from Git, not something that exists only on the server.

Add this structure:

```text
infra/
  k3s/
    linode/
      README.md
      namespace.yaml
      secrets.example.env
      configmap.yaml
      migrate-job.yaml
      api.yaml
      web.yaml
      ml.yaml
      worker.yaml
      score-worker.yaml
      ingress.yaml
      keda-worker.yaml
      keda-score-worker.yaml
      networkpolicy.yaml
      github-deployer-rbac.yaml
  scripts/
    bootstrap-linode-k3s.sh
    apply-linode-k3s.ps1
```

What each file is for:

| File                        | Purpose                                                                         |
| --------------------------- | ------------------------------------------------------------------------------- |
| `namespace.yaml`            | Creates the Kubernetes namespace `codesageai`                                   |
| `secrets.example.env`       | Lists required secret names without real values                                 |
| `configmap.yaml`            | Non-secret app settings                                                         |
| `migrate-job.yaml`          | Runs `alembic upgrade head` once before API rollout                             |
| `api.yaml`                  | FastAPI Deployment and internal Service                                         |
| `web.yaml`                  | Next.js Deployment and internal Service                                         |
| `ml.yaml`                   | ML FastAPI Deployment and internal Service                                      |
| `worker.yaml`               | Celery scan worker, queue `scans`                                               |
| `score-worker.yaml`         | Celery score worker, queue `scoring`                                            |
| `ingress.yaml`              | Routes real hostnames to web and api                                            |
| `keda-worker.yaml`          | Scales scan workers from Redis queue length                                     |
| `keda-score-worker.yaml`    | Optional scaling for score workers                                              |
| `networkpolicy.yaml`        | Locks internal traffic after the app works                                      |
| `github-deployer-rbac.yaml` | Namespace-only ServiceAccount and RBAC for the future GitHub k3s deployment job |
| `bootstrap-linode-k3s.sh`   | Server setup script run over SSH                                                |
| `apply-linode-k3s.ps1`      | Local Windows helper for `kubectl apply`                                        |

Do not commit real secrets. Real values come from Railway, Neon, Upstash, Asgardeo, and GitHub.

---

## Phase 2 - Create the Linode Compute Instance

You are currently in Akamai Cloud Manager.

Use **Linodes**, not **Kubernetes**.

Reason: the **Kubernetes** menu creates Linode Kubernetes Engine. This plan is for a normal Linode VPS where we install k3s ourselves.

Steps in Cloud Manager:

1. Go to **Compute -> Linodes**.
2. Click **Create Linode**.
3. Choose **Images**:
   - Distribution: Ubuntu LTS.
4. Choose **Region**:
   - Prefer **Singapore** if available, because the current Railway app, Neon Postgres, and Upstash Redis are already in or near `ap-southeast-1`.
5. Choose **Plan**:
   - **Shared CPU**
   - **Linode 8 GB**
   - 8 GB RAM / 4 CPU
6. Set **Label**:
   - `codesage-k3s-prod`
7. Add **SSH Keys**:
   - Use your own SSH key.
   - Prefer SSH key login instead of password login.
8. Create or attach a **Cloud Firewall**:
   - Allow SSH port `22` only from your own IP address.
   - Allow HTTP port `80` from all IPv4/IPv6.
   - Allow HTTPS port `443` from all IPv4/IPv6.
   - Allow Kubernetes API port `6443` only from your own IP address, or keep it closed and manage through SSH.
9. Click **Create Linode**.
10. Wait until the Linode status is running.
11. Copy the Linode public IPv4 address.

Keep Railway running. Do not change DNS yet.

---

## Phase 3 - SSH into the server

From your computer:

```powershell
ssh root@YOUR_LINODE_IPV4
```

First server checks:

```bash
apt update
apt upgrade -y
hostnamectl set-hostname codesage-k3s-prod
```

Optional but recommended:

```bash
adduser deploy
usermod -aG sudo deploy
```

After this, use the `deploy` user for normal work.

---

## Phase 4 - Install k3s

Install k3s with Traefik disabled.

Reason: k3s includes Traefik by default, but this plan uses `ingress-nginx` so the routing rules are easier to document and match common Kubernetes examples.

Run on the Linode:

```bash
curl -sfL https://get.k3s.io | sh -s - --disable traefik
```

Check it:

```bash
kubectl get nodes
kubectl get pods -A
```

Expected result:

- One node is `Ready`.
- Core k3s system pods are running.

Install Helm on the server. Helm is the tool used below to install ingress-nginx, cert-manager, and KEDA:

```bash
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
helm version
```

Copy kubeconfig for local control later:

```bash
cat /etc/rancher/k3s/k3s.yaml
```

On your local machine, save it as a kubeconfig file and replace `127.0.0.1` with the Linode public IP address.

Keep this file private. It controls the cluster.

---

## Phase 5 - Install ingress-nginx

Ingress is the public entry point.

It receives:

- `https://codesageai.dev`
- `https://api.codesageai.dev`

Then it sends traffic to the correct internal Service.

Install `ingress-nginx` with Helm:

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace
```

Check it:

```bash
kubectl get pods -n ingress-nginx
kubectl get svc -n ingress-nginx
```

The controller should be running. On a single Linode, the public IP is the Linode IP.

---

## Phase 6 - Install cert-manager

cert-manager gets free TLS certificates from Let's Encrypt.

Install with Helm:

```bash
helm repo add jetstack https://charts.jetstack.io
helm repo update
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --set crds.enabled=true
```

Check it:

```bash
kubectl get pods -n cert-manager
```

Then create two issuers later:

- Let's Encrypt staging issuer for testing.
- Let's Encrypt production issuer for final DNS cutover.

Use staging first to avoid certificate rate limits while testing.

---

## Phase 7 - Install KEDA

KEDA scales Celery workers based on Redis queue length.

Install with Helm:

```bash
helm repo add kedacore https://kedacore.github.io/charts
helm repo update
helm install keda kedacore/keda \
  --namespace keda \
  --create-namespace
```

Check it:

```bash
kubectl get pods -n keda
```

Scaling goal:

- `worker` watches Redis queue/list `scans`.
- `score-worker` watches Redis queue/list `scoring`.
- Keep `minReplicaCount: 0` while protecting the Redis free tier.
- Set `maxReplicaCount: 3` on the 8 GB server at first.

Scale workers to zero while the queues are empty. This keeps idle Celery workers
from polling Redis continuously. The first scan can start a little slower because
KEDA must observe the queued job and Kubernetes must start a worker pod.

---

## Phase 8 - Create app namespace and secrets

Apply the namespace:

```bash
kubectl apply -f infra/k3s/linode/namespace.yaml
```

Apply the non-secret production config:

```bash
kubectl apply -f infra/k3s/linode/configmap.yaml
```

Create secrets from current production values.

First copy the example file locally and fill it with real values:

```bash
cp infra/k3s/linode/secrets.example.env infra/k3s/linode/secrets.prod.env
```

Then create the Kubernetes Secret:

```bash
kubectl create secret generic codesage-secrets \
  --namespace codesageai \
  --from-env-file infra/k3s/linode/secrets.prod.env
```

Required secret values:

```text
CODESAGE_DATABASE_URL
CODESAGE_MIGRATION_DATABASE_URL
CODESAGE_REDIS_URL
CODESAGE_KEDA_REDIS_ADDRESS
CODESAGE_KEDA_REDIS_USERNAME
CODESAGE_KEDA_REDIS_PASSWORD
CODESAGE_SECRET_KEY
CODESAGE_ASGARDEO_BASE_URL
CODESAGE_ASGARDEO_CLIENT_ID
CODESAGE_ASGARDEO_CLIENT_SECRET
CODESAGE_ASGARDEO_REDIRECT_URI
CODESAGE_FRONTEND_BASE_URL
CODESAGE_CORS_ORIGINS
CODESAGE_COOKIE_DOMAIN
CODESAGE_COOKIE_SECURE
CODESAGE_ML_SERVICE_URL
CODESAGE_GITHUB_TOKEN
```

Important values for production:

```text
CODESAGE_FRONTEND_BASE_URL=https://codesageai.dev
CODESAGE_ASGARDEO_REDIRECT_URI=https://api.codesageai.dev/api/auth/callback
CODESAGE_CORS_ORIGINS=["https://codesageai.dev"]
CODESAGE_COOKIE_DOMAIN=.codesageai.dev
CODESAGE_COOKIE_SECURE=true
CODESAGE_ML_SERVICE_URL=http://ml:8001
```

For Redis:

- Use the existing Upstash `rediss://...` URL.
- KEDA uses split Redis settings because the Redis Lists scaler expects
  `host:port` plus auth/TLS fields, not the full `rediss://...` app URL.
  For Upstash, split `rediss://default:PASSWORD@HOST:6379` into:
  - `CODESAGE_KEDA_REDIS_ADDRESS=HOST:6379`
  - `CODESAGE_KEDA_REDIS_USERNAME=default`
  - `CODESAGE_KEDA_REDIS_PASSWORD=PASSWORD`
  - Upstash Redis should use `rediss://...` in `CODESAGE_REDIS_URL`, and
    KEDA has `enableTLS: "true"` in the scaler manifests.

---

## Phase 9 - Deploy ML first

Deploy `ml` before workers.

Reason: workers call the ML service internally.

Apply:

```bash
kubectl apply -f infra/k3s/linode/ml.yaml
```

Check:

```bash
kubectl get pods -n codesageai
kubectl logs -n codesageai deploy/ml
kubectl port-forward -n codesageai svc/ml 8001:8001
```

Then from another terminal:

```bash
curl http://localhost:8001/healthz
```

Expected result: ML health endpoint answers successfully.

---

## Phase 10 - Run database migrations

Run migrations as a Kubernetes Job, not inside every API pod.

Reason: if multiple API pods run migrations at the same time, they can fight over database locks.

Apply:

```bash
kubectl apply -f infra/k3s/linode/migrate-job.yaml
```

Check:

```bash
kubectl get jobs -n codesageai
kubectl logs -n codesageai job/codesage-migrate
```

Continue only when the Job succeeds.

---

## Phase 11 - Deploy API

Apply:

```bash
kubectl apply -f infra/k3s/linode/api.yaml
```

Check:

```bash
kubectl get pods -n codesageai
kubectl logs -n codesageai deploy/api
kubectl port-forward -n codesageai svc/api 8000:8000
```

Then from another terminal:

```bash
curl http://localhost:8000/api/healthz
```

Expected result: API health endpoint answers successfully.

Do not use `/readyz` as the Kubernetes liveness check. In this project, `/api/healthz` is the stable liveness endpoint.

---

## Phase 12 - Deploy workers

Deploy scan worker:

```bash
kubectl apply -f infra/k3s/linode/worker.yaml
```

Deploy score worker:

```bash
kubectl apply -f infra/k3s/linode/score-worker.yaml
```

Expected commands inside the pods:

```text
worker:
celery -A codesage_api.worker worker --loglevel=INFO --concurrency=1 -Q scans

score-worker:
celery -A codesage_api.worker worker --loglevel=INFO --concurrency=1 -Q scoring
```

Check:

```bash
kubectl get pods -n codesageai
kubectl logs -n codesageai deploy/worker
kubectl logs -n codesageai deploy/score-worker
```

Keep Celery concurrency at `1`.

Scaling should happen by adding pods, not by running many scans inside one pod.

---

## Phase 13 - Deploy web

Apply:

```bash
kubectl apply -f infra/k3s/linode/web.yaml
```

Check:

```bash
kubectl get pods -n codesageai
kubectl logs -n codesageai deploy/web
kubectl port-forward -n codesageai svc/web 3000:3000
```

Open locally:

```text
http://localhost:3000
```

Important: the web image already has the API URL baked in at build time. For production it must have been built with:

```text
NEXT_PUBLIC_API_BASE_URL=https://api.codesageai.dev
```

If this value changes, rebuild the web image.

---

## Phase 14 - Apply Ingress

Apply:

```bash
kubectl apply -f infra/k3s/linode/ingress.yaml
```

Ingress routes:

```text
codesageai.dev
  -> web service, port 3000

api.codesageai.dev
  -> api service, port 8000
```

First use the Let's Encrypt staging issuer.

Check:

```bash
kubectl get ingress -n codesageai
kubectl describe ingress -n codesageai
kubectl get certificate -n codesageai
```

---

## Phase 15 - Test before DNS cutover

Do not point real DNS at Linode yet.

On your local machine, edit the hosts file temporarily:

```text
YOUR_LINODE_IPV4 codesageai.dev
YOUR_LINODE_IPV4 api.codesageai.dev
```

Then test in your browser:

```text
https://codesageai.dev
https://api.codesageai.dev/api/healthz
```

Smoke test checklist:

- Web page loads.
- Login starts correctly.
- Asgardeo callback returns to the API.
- Session cookie works for `codesageai.dev` and `api.codesageai.dev`.
- Projects page loads.
- Connect public GitHub repository.
- Start a scan on a Java repository.
- `worker` pod logs show the scan running.
- `ml` pod receives requests.
- Score cache is produced by `score-worker`.
- Dashboard shows results.

If any of these fail, keep Railway live and fix the cluster first.

---

## Phase 16 - Enable KEDA scaling

Apply:

```bash
kubectl apply -f infra/k3s/linode/keda-worker.yaml
kubectl apply -f infra/k3s/linode/keda-score-worker.yaml
```

Initial scaling targets:

```text
worker:
  queue/list: scans
  min replicas: 0
  max replicas: 3

score-worker:
  queue/list: scoring
  min replicas: 0
  max replicas: 2
```

Demo test:

1. Start several scans.
2. Watch pods:

```bash
kubectl get pods -n codesageai -w
```

3. Confirm worker pods increase.
4. Wait for queues to drain.
5. Confirm pods scale down again.

This proves the scalability goal: scan capacity grows when the queue grows.

---

## Phase 17 - Prepare the two independent environments first

Do **not** change the `@` or `api` DNS records yet. The first goal is to make
Railway a real, separately addressable fallback and to ensure that one release
cannot accidentally connect to the other environment's API, database, Redis, or
session cookie.

The final topology is:

| GitHub Environment | Platform      | Public web URL                   | Public API URL                       | Purpose                                       |
| ------------------ | ------------- | -------------------------------- | ------------------------------------ | --------------------------------------------- |
| `staging`          | Railway       | `https://railway.codesageai.dev` | `https://api.railway.codesageai.dev` | Warm fallback and pre-production verification |
| `production`       | k3s on Linode | `https://codesageai.dev`         | `https://api.codesageai.dev`         | Primary live application                      |

`staging` and `production` are GitHub Environment names. They do **not** mean
that both stacks share production data. Each stack must use its own Neon project
or database and its own Upstash Redis instance.

Keep the generated Railway `*.up.railway.app` domains. They are useful for a
quick health check, but do not use them as the normal fallback application URL.
The web and API services need a shared parent cookie domain, which two unrelated
generated Railway domains cannot provide.

### 17.1 - Record the current Railway configuration for rollback

Before changing anything, save these values somewhere private:

- The current DNS records for `codesageai.dev` and `api.codesageai.dev`.
- The current Railway custom-domain CNAME/ALIAS target and TXT verification
  record for each primary domain.
- The currently deployed Railway image digests or commit SHA.
- The Railway API, worker, score-worker, web, and ML service names.
- The Neon connection strings and Redis URL currently used by Railway. Do not
  copy them to the k3s secret.

Do not delete a Railway service, Neon project, Redis instance, image, or
GitHub secret during this migration.

### 17.2 - Make the web image environment-specific

This change is required before a dual deployment can work correctly.

`NEXT_PUBLIC_API_BASE_URL` is compiled into the Next.js JavaScript at image
build time. One `web:latest` image therefore cannot correctly serve both
Railway and k3s. The session-cookie name should also differ so that a browser
can be signed in to both environments without two cookies of the same name
being sent to a Railway fallback host.

Update `apps/web/Dockerfile` so both public values are build arguments and
runtime build environment values. Keep the defaults for local development:

```dockerfile
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
ARG NEXT_PUBLIC_SESSION_COOKIE_NAME=codesage_session
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL} \
    NEXT_PUBLIC_SESSION_COOKIE_NAME=${NEXT_PUBLIC_SESSION_COOKIE_NAME}
```

The existing Dockerfile already has the first argument. Add only the second
argument and include both in the same builder stage before `pnpm run build`.

Build these two frontend variants from the same commit:

| Image purpose   | Build-time API URL                   | Build-time session-cookie name |
| --------------- | ------------------------------------ | ------------------------------ |
| Railway staging | `https://api.railway.codesageai.dev` | `codesage_session_railway`     |
| k3s production  | `https://api.codesageai.dev`         | `codesage_session`             |

Never try to fix either `NEXT_PUBLIC_*` value by setting a Railway or Kubernetes
runtime variable. Rebuild the web image when either value changes.

### 17.3 - Verify hard environment boundaries

Use different values for every item in this table. The database users may have
the same role names inside each Neon database, but their connection strings must
belong to different Neon projects/databases.

| Setting                           | Railway `staging` value                                | k3s `production` value                         |
| --------------------------------- | ------------------------------------------------------ | ---------------------------------------------- |
| `CODESAGE_DATABASE_URL`           | Railway Neon application-role URL                      | k3s Neon application-role URL                  |
| `CODESAGE_MIGRATION_DATABASE_URL` | Railway Neon owner/migration URL                       | k3s Neon owner/migration URL                   |
| `CODESAGE_REDIS_URL`              | Railway Upstash Redis URL                              | k3s Upstash Redis URL                          |
| `CODESAGE_SECRET_KEY`             | Railway-only random secret                             | k3s-only random secret                         |
| `CODESAGE_ML_SERVICE_URL`         | `http://ml.railway.internal:8001`                      | `http://ml:8001`                               |
| `CODESAGE_FRONTEND_BASE_URL`      | `https://railway.codesageai.dev`                       | `https://codesageai.dev`                       |
| `CODESAGE_ASGARDEO_REDIRECT_URI`  | `https://api.railway.codesageai.dev/api/auth/callback` | `https://api.codesageai.dev/api/auth/callback` |
| `CODESAGE_CORS_ORIGINS`           | `["https://railway.codesageai.dev"]`                   | `["https://codesageai.dev"]`                   |
| `CODESAGE_COOKIE_DOMAIN`          | `.railway.codesageai.dev`                              | `.codesageai.dev`                              |
| `CODESAGE_SESSION_COOKIE_NAME`    | `codesage_session_railway`                             | `codesage_session`                             |
| `CODESAGE_COOKIE_SECURE`          | `true`                                                 | `true`                                         |

Apply the Railway values to the Railway API and every Railway worker that reads
the database, Redis, or ML URL. Apply the k3s values only through
`codesage-secrets` and `codesage-config`. Do not put either Neon or Redis URL in
GitHub Actions secrets; those stay in the platform secret stores.

In Asgardeo, add **both** exact callback URLs to the same application before
testing either deployment:

```text
https://api.railway.codesageai.dev/api/auth/callback
https://api.codesageai.dev/api/auth/callback
```

Also make sure that both frontend origins are permitted wherever Asgardeo has
an allowed-origin setting. Do not replace the k3s callback with the Railway
one; both must remain registered.

### 17.4 - Create Railway's permanent fallback domains

In Railway **web -> Settings -> Networking**:

1. Add the custom domain `railway.codesageai.dev`.
2. Keep target port `3000`.
3. Copy the CNAME target and the TXT ownership-verification record Railway
   gives you.

In Railway **api -> Settings -> Networking**:

1. Add the custom domain `api.railway.codesageai.dev`.
2. Keep target port `8000`.
3. Copy that service's CNAME target and TXT verification record.

In **Spaceship -> Domain Manager -> Advanced DNS**, open the
`codesageai.dev` zone and create the two CNAME records and two TXT verification
records exactly as Railway shows them. In Spaceship, the host fields for the
two routing records are `railway` and `api.railway`; Spaceship appends
`.codesageai.dev` automatically. Use the exact TXT host and value Railway
provides, even if the TXT host differs from those two names.

Do not create or import a DNS zone in Akamai/Linode. Its Domains screen is
empty because Spaceship is the authoritative DNS provider for this domain.
Wait for both domains to show verified in Railway and for Railway to issue
HTTPS certificates. The existing primary records (`codesageai.dev` and
`api.codesageai.dev`) remain unchanged in this phase.

Check:

```bash
nslookup railway.codesageai.dev
nslookup api.railway.codesageai.dev
curl -I https://railway.codesageai.dev
curl -fsS https://api.railway.codesageai.dev/api/healthz
```

Expected result:

- Both names resolve to Railway, not the Linode IP.
- Web answers on HTTPS.
- API health check answers successfully on HTTPS.

### 17.5 - Configure and prove the Railway fallback

In Railway, change the **web** source image from the shared `:latest` tag to
the Railway-specific image built with the values in section 17.2. The Railway
API and its workers remain on their current `:latest` images, with the runtime
values in section 17.3.

For the current Railway staging stack, use these source-image conventions:

```text
web          ghcr.io/jpabasara/codesage-ai/web:railway
api          ghcr.io/jpabasara/codesage-ai/api:latest
worker       ghcr.io/jpabasara/codesage-ai/api:latest
score-worker ghcr.io/jpabasara/codesage-ai/api:latest
ml           ghcr.io/jpabasara/codesage-ai/ml:latest
```

Only the web image needs a Railway-specific tag because it contains browser
configuration at build time. Do not delete the `:latest` tags; Railway still
uses them for API, workers, and ML until an explicit image-source strategy is
changed in a later release.

Keep the API pre-deploy command:

```text
alembic upgrade head
```

It is correct because it migrates only the Railway Neon database. Confirm that
the Railway API uses its **migration owner** URL for this command and that API
and workers use their Railway application-role URL at runtime.

Deploy Railway in this order:

1. API; wait for the pre-deploy migration and `/api/healthz` to succeed.
2. ML.
3. Worker and score-worker.
4. Web, using the Railway-specific web image.

At `https://railway.codesageai.dev`, complete this smoke test:

- The login button starts sign-in at `api.railway.codesageai.dev`.
- Asgardeo returns to `api.railway.codesageai.dev/api/auth/callback`.
- The browser returns to `railway.codesageai.dev/projects` without a login loop.
- `codesage_session_railway` has domain `.railway.codesageai.dev`, `Secure`,
  and `HttpOnly` attributes.
- A project can be connected and a Java scan can be completed.
- The Railway worker consumes the Railway Redis `scans` queue.
- The Railway score-worker consumes the Railway Redis `scoring` queue.
- Results appear only in the Railway Neon database.

Do not proceed if this test fails. The generated Railway domains may still be
used for health diagnostics, but they do not substitute for this complete test.

---

## Phase 18 - Create the GitHub deployment environments

Create exactly two GitHub Environments in **GitHub repository -> Settings ->
Environments**:

### `staging` - Railway

- Purpose: deploy and smoke-test the Railway fallback before a release reaches
  k3s.
- Deployment branch policy: `main` only.
- Environment secret: `RAILWAY_TOKEN`.
- The Railway project token is already scoped to its Railway environment. The
  workflow does not read a GitHub variable named `RAILWAY_ENVIRONMENT`, so do
  not rely on that variable to select a Railway target.
- No Neon, Redis, Asgardeo client-secret, or application signing secret belongs
  here. Those remain in Railway Variables.

### `production` - k3s on Linode

- Purpose: deploy the already tested image SHA to the primary k3s cluster.
- Deployment branch policy: `main` only.
- Require a reviewer/approval before this deployment if the GitHub plan allows
  it. This is the production safety gate.
- Environment variable: `K3S_NAMESPACE=codesageai`. This is the namespace the future
  production workflow will target; it must not be the Linode label or IP address.
- Do **not** add `KUBECONFIG_B64` yet. It is not a random value: it will later
  contain a base64-encoded kubeconfig for a dedicated, least-privileged k3s
  deployment service account.
- Do **not** add `K8S_CLUSTER_NAME`. `linode-k3s` was only an example label;
  it is not read by the workflow or Kubernetes. The actual Linode label is
  `codesageai-k3s-prod`, but that label also does not need to be a GitHub
  variable.
- No Neon, Redis, Asgardeo client-secret, or application signing secret belongs
  here. Those remain in `codesage-secrets` on the cluster.

The Railway deploy job uses `environment: staging`, so its `RAILWAY_TOKEN` is
read from the GitHub `staging` environment and its deployment history is not
mislabelled as k3s production.

---

## Phase 19 - Replace one shared `latest` release with a two-target pipeline

Do this only after the Railway fallback and the manual k3s deployment both pass
their smoke tests.

### 19.0 - Establish secure GitHub-to-k3s access before adding a kubeconfig

The normal k3s admin kubeconfig at `/etc/rancher/k3s/k3s.yaml` is **not** the
value for `KUBECONFIG_B64`. It grants unrestricted `system:admin` /
`system:masters` access. Do not copy it into GitHub Secrets.

Also confirm how the GitHub runner will reach the Kubernetes API. The firewall
baseline in this plan permits port `6443` only from the administrator's IP (or
keeps it closed), so a GitHub-hosted runner cannot reach it by default. Do not
open the Kubernetes API to the entire internet just to make CI work.

Before adding the k3s production deploy job, choose and document one secure
access design, such as a hardened self-hosted GitHub Actions runner with local
cluster access, or a private VPN/tunnel from the runner to the server. Then:

1. Apply the dedicated `github-deployer` ServiceAccount and namespace RBAC:

   ```bash
   kubectl apply -f infra/k3s/linode/github-deployer-rbac.yaml
   kubectl auth can-i patch deployments -n codesageai \
     --as=system:serviceaccount:codesageai:github-deployer
   kubectl auth can-i get secrets -n codesageai \
     --as=system:serviceaccount:codesageai:github-deployer
   ```

   The first command must answer `yes`; the second must answer `no`.

2. Keep its permissions limited to the migration Job and the five application
   Deployments. It must never receive permission to read Kubernetes Secrets or
   modify cluster-scoped resources.
3. Create the deployment kubeconfig from that ServiceAccount, with the correct
   reachable API endpoint and cluster CA data.
4. Base64-encode that complete restricted kubeconfig without line wrapping and
   store it as the GitHub `production` secret `KUBECONFIG_B64`.
5. Rotate it if the runner, GitHub secret, or deployment credential is exposed.

Kubernetes recommends short-lived service-account tokens where possible; a
long-lived token secret is acceptable only when the selected CI access design
cannot use short-lived credentials.

### 19.1 - Image rules

Use immutable commit-SHA tags for every k3s deployment. For a commit identified
by `<SHA>`, publish at least:

```text
ghcr.io/jpabasara/codesage-ai/api:sha-<SHA>
ghcr.io/jpabasara/codesage-ai/ml:sha-<SHA>
ghcr.io/jpabasara/codesage-ai/web:k3s-sha-<SHA>
ghcr.io/jpabasara/codesage-ai/web:railway-sha-<SHA>
```

The two web images are separate builds, with the values in section 17.2.
`api` and `ml` may use the same commit image in both environments because their
database, Redis, ML address, auth, and cookie settings are runtime secrets.

Railway staging uses these controlled moving tags, which are redeployed by CI
only after the images have been published:

```text
ghcr.io/jpabasara/codesage-ai/web:railway
ghcr.io/jpabasara/codesage-ai/api:latest
ghcr.io/jpabasara/codesage-ai/ml:latest
```

The Railway workers use `api:latest`. Disable Railway automatic image updates
and let GitHub Actions call `railway redeploy` only after a successful build.
This preserves the required API-migration -> ML -> worker -> score-worker ->
web deployment order.

Never point a k3s Deployment or Job at `:latest` in CI/CD. The pinned SHA is
what makes a rollback and an audit possible.

### 19.2 - Workflow structure

Keep the existing tests and GHCR image build job. Replace the single `deploy —
Railway` job with this release sequence:

```text
tests
  -> publish API, ML, web:k3s-sha-<SHA>, and web:railway-sha-<SHA>
  -> deploy — Railway staging       (GitHub Environment: staging)
  -> browser smoke — Railway staging, when STAGING_SMOKE_ENABLED=true
  -> production approval and k3s deploy, when PRODUCTION_DEPLOY_ENABLED=true
  -> public browser smoke — k3s, after Phase 20 DNS cutover and
     PRODUCTION_PUBLIC_SMOKE_ENABLED=true
```

The workflow's browser smoke jobs are intentionally gated by GitHub
Environment **variables**:

| Environment  | Variable                          | Set it to `true` only when                                                                              |
| ------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `staging`    | `STAGING_SMOKE_ENABLED`           | Both Railway fallback domains have valid HTTPS certificates.                                            |
| `production` | `PRODUCTION_DEPLOY_ENABLED`       | Secure runner-to-k3s API access works and `KUBECONFIG_B64` contains the restricted deployer kubeconfig. |
| `production` | `PRODUCTION_PUBLIC_SMOKE_ENABLED` | Phase 20 has pointed the public DNS records at k3s.                                                     |

Until a variable is explicitly set to `true`, the corresponding job is safely
skipped. This permits the workflow to be merged now without testing an
unverified Railway domain or reaching k3s with no configured credential.

Use a separate deployment concurrency group for each target:

```yaml
concurrency:
  group: deploy-staging
  cancel-in-progress: false
```

```yaml
concurrency:
  group: deploy-production
  cancel-in-progress: false
```

Do not allow two deployments to the same environment to overlap. A migration
and a worker rollout from different commits must never run at the same time.

The Railway staging job uses `environment: staging`, reads only
`${{ secrets.RAILWAY_TOKEN }}`, and keeps this order:

```text
API (runs Railway Neon migration) -> ML -> worker -> score-worker -> web
```

Its deployed-browser smoke test waits for `/api/healthz`, opens the Railway
landing and login pages in Chromium, and proves that the sign-in link points to
`api.railway.codesageai.dev`. It deliberately does not complete Asgardeo login
or start a scan: those are real user/data actions and remain the manual Phase
17.5 smoke checklist.

The production job uses `environment: production`, reconstructs its kubeconfig
only in the GitHub runner, and deploys this order:

```text
create a migration Job using api:sha-<SHA>
  -> wait until the Job succeeds
  -> roll out API and ML using their SHA tags
  -> roll out worker and score-worker using api:sha-<SHA>
  -> roll out web using web:k3s-sha-<SHA>
  -> wait for every rollout and run the public health check
```

The migration Job must use a new name for each release, for example
`codesage-migrate-<short-sha>`, or use `metadata.generateName`. A completed
Kubernetes Job cannot be safely updated in place with a new image. Render the
Job with the same `api:sha-<SHA>` image that will run in the API deployment,
then wait for it:

```bash
kubectl wait --for=condition=complete --timeout=10m \
  job/codesage-migrate-<short-sha> -n codesageai
```

If that Job fails, stop the production job. Do not roll out API, workers, or
web against a schema that may be only partly migrated.

For each k3s Deployment, wait for success rather than assuming `kubectl set
image` completed the rollout:

```bash
kubectl rollout status deployment/api -n codesageai --timeout=10m
kubectl rollout status deployment/ml -n codesageai --timeout=10m
kubectl rollout status deployment/worker -n codesageai --timeout=10m
kubectl rollout status deployment/score-worker -n codesageai --timeout=10m
kubectl rollout status deployment/web -n codesageai --timeout=10m
```

Before Phase 20, the production job validates Kubernetes rollout status only.
After Phase 20, set `PRODUCTION_PUBLIC_SMOKE_ENABLED=true`; the workflow then
runs the same Chromium deployment smoke against `https://codesageai.dev` and
`https://api.codesageai.dev`.

Use GitHub's deployment history as the release audit trail: a commit must first
be visible as a successful `staging` deployment, then as an approved and
successful `production` deployment.

### 19.3 - Operator checklist

Do these steps in order.

1. **Merge the Phase 19 code.** From the repository root, stage only the
   deployment files so unrelated working-tree changes are not included:

   ```powershell
   git add .github/workflows/ci.yml
   git add apps/web/package.json
   git add apps/web/playwright.deployment.config.ts
   git add apps/web/e2e/deployment-smoke.spec.ts
   git add infra/k3s/linode/github-deployer-rbac.yaml
   git add K3_DEPLOYMENT_PLAN.MD
   git diff --cached --check
   git commit -m "ci: add staged Railway and k3s promotion pipeline"
   git push
   ```

2. **Wait for Railway TLS.** Do not enable browser smoke while either
   `railway.codesageai.dev` or `api.railway.codesageai.dev` is unverified. When
   both show valid certificates in Railway, add this GitHub `staging`
   Environment variable:

   ```text
   STAGING_SMOKE_ENABLED=true
   ```

3. **Run the staging release.** In GitHub **Actions -> CI -> Run workflow**,
   select `main` and run it. This manually triggered run redeploys Railway in
   the safe order and then runs the public Chromium smoke test. It does not
   deploy k3s unless the later production gates are enabled.

4. **Complete the manual Railway test.** After the automated public test is
   green, perform the real Asgardeo login and Java scan checks from Phase 17.5.
   The browser test cannot safely automate an identity-provider login or create
   real scan data.

5. **Apply the k3s RBAC manifest.** From a machine where `kubectl` already has
   your administrator connection to the k3s cluster:

   ```powershell
   kubectl apply -f infra/k3s/linode/github-deployer-rbac.yaml
   kubectl auth can-i patch deployments -n codesageai --as=system:serviceaccount:codesageai:github-deployer
   kubectl auth can-i get secrets -n codesageai --as=system:serviceaccount:codesageai:github-deployer
   ```

   Expect `yes` and then `no`.

6. **Stop before the production gate.** Do not set `KUBECONFIG_B64`,
   `PRODUCTION_DEPLOY_ENABLED`, or `PRODUCTION_PUBLIC_SMOKE_ENABLED` until the
   secure GitHub-runner-to-k3s connection has been selected and tested. The
   production jobs are present but safely skipped until then.

---

## Phase 20 - Cut the primary DNS over to k3s

Only do this after all of the following are true:

- The Phase 15 hosts-file test has passed against k3s.
- The Railway fallback smoke test in Phase 17.5 has passed.
- The k3s web deployment uses `web:k3s-sha-<SHA>`, not the Railway web image.
- k3s uses only its own Neon, Redis, secret key, cookie name, and cookie domain.
- The current Railway DNS records have been recorded for rollback.

In **Spaceship -> Domain Manager -> Advanced DNS**, open `codesageai.dev`.

1. Find the existing Railway routing record for the apex (`@`) and replace it
   with:

   ```text
   Hostname: @
   Type: A
   Value: YOUR_LINODE_IPV4
   TTL: 5 minutes if available
   ```

2. Replace the existing Railway routing record for `api` with:

   ```text
   Hostname: api
   Type: A
   Value: YOUR_LINODE_IPV4
   TTL: 5 minutes if available
   ```

3. Do not change the `railway` or `api.railway` CNAME/TXT records. They keep
   the Railway fallback available.
4. After the new records resolve, remove `codesageai.dev` and
   `api.codesageai.dev` from the Railway service settings. Do not remove the
   Railway services or their `railway.*` fallback domains.

An A record and a CNAME cannot coexist at the same DNS label. If the primary
Railway custom domains used CNAME, ALIAS, or CNAME flattening before this step,
replace those routing records; retain the saved values for rollback.

Verify from a network that is not using the temporary hosts file:

```bash
nslookup codesageai.dev
nslookup api.codesageai.dev
curl -fsS https://api.codesageai.dev/api/healthz
```

Expected result: both names resolve to the Linode IPv4 address and the public
API health endpoint succeeds. Then complete the full production smoke test:

- Load `https://codesageai.dev`.
- Log in through `https://api.codesageai.dev`.
- Confirm the production `codesage_session` cookie has domain
  `.codesageai.dev`.
- Connect a public Java repository and complete a scan.
- Confirm API, worker, score-worker, ML, production Neon, and production Redis
  activity belongs to the k3s environment.
- Separately open `https://railway.codesageai.dev` and confirm that it still
  reaches Railway. Do not expect it to contain the same users or scan results.

Keep Railway running. It is now a warm fallback and release-validation
environment, not a load-balanced second production origin.

---

## Phase 21 - Switch the primary TLS certificate to Let's Encrypt production

After public DNS resolves to Linode and the staging certificate has proven that
Ingress routing works:

1. In `infra/k3s/linode/ingress.yaml`, change:

   ```yaml
   cert-manager.io/issuer: letsencrypt-staging
   ```

   to:

   ```yaml
   cert-manager.io/issuer: letsencrypt-production
   ```

2. Apply the changed Ingress.

   ```bash
   kubectl apply -f infra/k3s/linode/ingress.yaml
   kubectl get certificate -n codesageai
   kubectl describe certificate -n codesageai
   ```

3. Confirm the Certificate's issuer reference is `letsencrypt-production` and
   wait until it reports `Ready=True`.
4. Test both URLs in a clean browser session. The browser must show a trusted
   certificate with no staging warning.

If the Certificate continues to reference the staging issuer after reapplying
the Ingress, inspect it before deleting anything. Delete and reissue only the
`Certificate` resource if necessary; do not delete the production Issuer or
its ACME account key. Reapply the Ingress and wait for the new certificate
before continuing.

---

## Phase 22 - Add NetworkPolicy last

Apply the network policy only after the primary application, Railway fallback,
DNS, and production TLS all work.

Reason: network rules can break a working service and look like random
connection failures.

Apply:

```bash
kubectl apply -f infra/k3s/linode/networkpolicy.yaml
```

Policy goal:

- Public Ingress can reach only k3s `web` and `api`.
- k3s `worker` and `score-worker` can reach k3s `ml`, production Neon, and
  production Upstash.
- k3s `api` can reach production Neon and production Upstash.
- k3s `web` calls the public API through the user's browser, not through an
  internal API address.
- k3s `ml` is never public.

Re-run the production smoke test after applying the policy. Also confirm that
the Railway fallback still works; it is outside this Kubernetes policy and
should be unaffected.

---

## Rollback plan

### Before Phase 20 DNS cutover

- Do nothing to `codesageai.dev` or `api.codesageai.dev` DNS.
- Railway remains the primary live site.
- Fix k3s, its independent Neon/Redis settings, or the GitHub production
  workflow without affecting users.

### After Phase 20 DNS cutover - traffic rollback

1. Restore the saved Railway routing records for `codesageai.dev` and
   `api.codesageai.dev` exactly as Railway originally required. These will be
   CNAME/ALIAS/CNAME-flattened records as appropriate for the DNS provider, not
   a guessed Railway IP address.
2. Ensure the original Railway primary custom domains are re-added and verified
   in Railway if they were removed in Phase 20.
3. Leave `railway.codesageai.dev` and `api.railway.codesageai.dev` unchanged.
4. Wait for the recorded DNS TTL and verify the two primary names serve Railway
   again.
5. Debug k3s while users are served by Railway.

### Release rollback without DNS rollback

- For a bad Railway staging release, redeploy the previous known-good Railway
  image alias/digest after confirming it uses the Railway database and Redis.
- For a bad k3s application release, use `kubectl rollout undo` or set each
  Deployment back to the prior recorded immutable SHA image.
- Do not assume an Alembic migration is reversible. Before any schema-changing
  release, verify Neon backups and the migration's downgrade/forward recovery
  plan. A code rollback may require a forward-fix migration instead.

Because the databases are intentionally independent, switching traffic between
Railway and k3s can expose different data and sessions. It is a service rollback,
not a data failover.

---

## Success criteria

The two-environment deployment is successful only when all of these are true:

- `https://codesageai.dev` loads from k3s on Linode.
- `https://api.codesageai.dev/api/healthz` answers from k3s on Linode.
- `https://railway.codesageai.dev` and
  `https://api.railway.codesageai.dev/api/healthz` still answer from Railway.
- Each environment has different Neon URLs, Redis URLs, signing keys, session
  cookie names, and session cookie domains.
- Login and logout work independently in both environments; neither has a
  callback error or a login loop.
- A public GitHub Java repository can be scanned in each environment.
- Each environment's worker consumes only its own `scans` queue and each
  score-worker consumes only its own `scoring` queue.
- k3s `ml` is reachable only inside the k3s cluster.
- KEDA increases k3s worker replicas during queued scans.
- GitHub Actions records the Railway deployment in `staging` and the approved
  k3s deployment in `production`.
- The k3s workflow uses immutable SHA image tags, waits for the migration Job,
  and waits for every rollout.
- Railway remains available as a warm fallback after the DNS cutover.

---

## References checked

- Akamai Cloud Manager terminology: Linodes and Cloud Firewalls.
- Akamai Cloud Firewall docs: default inbound policy should drop traffic unless rules allow it.
- Spaceship Advanced DNS: `codesageai.dev` uses Spaceship's authoritative
  nameservers (`launch1.spaceship.net` and `launch2.spaceship.net`), so its DNS
  records are created and changed in Spaceship, not Akamai/Linode.
- Railway docs: custom domains require the service-specific routing record and
  TXT ownership-verification record; Railway-provided domains are separate
  public service domains.
- k3s docs: k3s installs as a service and includes Traefik by default unless disabled.
- KEDA docs: Redis scaler watches Redis list length and scales Kubernetes workloads.
