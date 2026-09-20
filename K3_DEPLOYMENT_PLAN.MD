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
  scripts/
    bootstrap-linode-k3s.sh
    apply-linode-k3s.ps1
```

What each file is for:

| File | Purpose |
|---|---|
| `namespace.yaml` | Creates the Kubernetes namespace `codesageai` |
| `secrets.example.env` | Lists required secret names without real values |
| `configmap.yaml` | Non-secret app settings |
| `migrate-job.yaml` | Runs `alembic upgrade head` once before API rollout |
| `api.yaml` | FastAPI Deployment and internal Service |
| `web.yaml` | Next.js Deployment and internal Service |
| `ml.yaml` | ML FastAPI Deployment and internal Service |
| `worker.yaml` | Celery scan worker, queue `scans` |
| `score-worker.yaml` | Celery score worker, queue `scoring` |
| `ingress.yaml` | Routes real hostnames to web and api |
| `keda-worker.yaml` | Scales scan workers from Redis queue length |
| `keda-score-worker.yaml` | Optional scaling for score workers |
| `networkpolicy.yaml` | Locks internal traffic after the app works |
| `bootstrap-linode-k3s.sh` | Server setup script run over SSH |
| `apply-linode-k3s.ps1` | Local Windows helper for `kubectl apply` |

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
- Keep `minReplicaCount: 1`.
- Set `maxReplicaCount: 3` on the 8 GB server at first.

Do not scale scan workers to zero. The first scan would start too slowly.

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
- KEDA may also need Redis host, port, username, password, and TLS settings depending on the final scaler manifest.

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
  min replicas: 1
  max replicas: 3

score-worker:
  queue/list: scoring
  min replicas: 1
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

## Phase 17 - Cut DNS over

Only do this after the hosts-file test passes.

In Akamai Cloud Manager:

1. Go to **Networking -> Domains**.
2. Select `codesageai.dev`.
3. Update or create A records:

```text
Hostname: @
IP Address: YOUR_LINODE_IPV4
TTL: 5 minutes if available

Hostname: api
IP Address: YOUR_LINODE_IPV4
TTL: 5 minutes if available
```

If DNS is managed outside Akamai, make the same A record changes at the current DNS provider.

After DNS changes:

```bash
nslookup codesageai.dev
nslookup api.codesageai.dev
```

Then test:

```text
https://codesageai.dev
https://api.codesageai.dev/api/healthz
```

Keep Railway running for 24 hours after DNS cutover.

---

## Phase 18 - Switch TLS to production issuer

After DNS is pointing to Linode and the staging certificate works:

1. Change the Ingress issuer from Let's Encrypt staging to Let's Encrypt production.
2. Reapply Ingress.
3. Check the certificate.

```bash
kubectl apply -f infra/k3s/linode/ingress.yaml
kubectl get certificate -n codesageai
kubectl describe certificate -n codesageai
```

Expected result:

- Browser shows a trusted HTTPS certificate.
- No staging certificate warning.

---

## Phase 19 - Add NetworkPolicy last

Apply network policy only after the app works.

Reason: network rules can break working services and look like random connection bugs.

Apply:

```bash
kubectl apply -f infra/k3s/linode/networkpolicy.yaml
```

Policy goal:

- Public ingress can reach only `web` and `api`.
- `worker` can reach `ml`, Neon, and Upstash.
- `api` can reach Neon and Upstash.
- `web` talks to `api` through public browser calls, not directly inside the cluster.
- `ml` is not public.

Re-run the smoke test after applying NetworkPolicy.

---

## Phase 20 - Update CI deploy later

Do this after manual deployment is stable.

Current CI builds public images. Keep that.

Replace Railway redeploy with Kubernetes rollout:

```text
kubectl set image deployment/web web=ghcr.io/jpabasara/codesage-ai/web:sha-...
kubectl set image deployment/api api=ghcr.io/jpabasara/codesage-ai/api:sha-...
kubectl set image deployment/ml ml=ghcr.io/jpabasara/codesage-ai/ml:sha-...
kubectl rollout status deployment/web
kubectl rollout status deployment/api
kubectl rollout status deployment/ml
```

Store kubeconfig as a GitHub secret only after the cluster is stable.

---

## Rollback plan

If Linode deployment fails before DNS cutover:

- Do nothing to DNS.
- Railway remains live.
- Fix the cluster calmly.

If Linode deployment fails after DNS cutover:

1. Change DNS A records back to Railway's required records.
2. Keep Railway services online.
3. Wait for DNS TTL.
4. Debug Linode without users depending on it.

Do not delete Railway until Linode has served production successfully for at least 24 hours.

---

## Success criteria

The deployment is successful only when all of these are true:

- `https://codesageai.dev` loads from Linode.
- `https://api.codesageai.dev/api/healthz` answers from Linode.
- Login works.
- Session cookie works across web and API.
- A public GitHub Java repository can be scanned.
- `worker` handles scan jobs from Redis queue `scans`.
- `score-worker` handles scoring jobs from Redis queue `scoring`.
- `ml` is reachable only inside the cluster.
- KEDA increases worker replicas during queued scans.
- Neon and Upstash remain outside the cluster.
- Railway is still available as fallback for the first 24 hours.

---

## References checked

- Akamai Cloud Manager terminology: Linodes, Cloud Firewalls, Domains, A records.
- Akamai Cloud Firewall docs: default inbound policy should drop traffic unless rules allow it.
- Akamai DNS docs: A records point hostnames to the Linode IPv4 address.
- k3s docs: k3s installs as a service and includes Traefik by default unless disabled.
- KEDA docs: Redis scaler watches Redis list length and scales Kubernetes workloads.
