# Code Sage AI on Linode k3s

This folder contains the Kubernetes files for the Linode k3s deployment.

Current target:

- One Akamai/Linode Compute Instance.
- Shared CPU, Linode 8 GB, 4 vCPU.
- One k3s node at first.
- Neon Postgres stays outside the cluster, through its pooled endpoint.
- Redis runs inside the cluster (`redis.yaml`) since 2026-09-27.
- GHCR images are public.

Workloads:

| Workload | Image | Pods | Scaled by |
| --- | --- | --- | --- |
| `web` | `ghcr.io/jpabasara/codesage-ai/web` | 1–2 | HPA, CPU 70% |
| `api` | `ghcr.io/jpabasara/codesage-ai/api` | 1–3, two uvicorn workers each | HPA, CPU 70% |
| `ml` | `ghcr.io/jpabasara/codesage-ai/ml` | 1 | — |
| `worker` | `api` image, queue `scans` | 1–3 | KEDA |
| `score-worker` | `api` image, queue `scoring` | 1–2 | KEDA |
| `redis` | `redis:7.4-alpine` | 1 | — |

`web`, `api`, `worker` and `score-worker` have no `replicas` field: the HPA or
KEDA owns the count. Resource requests and limits are set in each manifest.

Normal deploys are done by CI (`.github/workflows/ci.yml`): after the tests and
the staging smoke test pass, it sets the new `sha-` image tags on the cluster and
runs a smoke test against the public site. The steps below are for a first
install or a manual change.

Do not commit real secrets. Use `secrets.example.env` as the checklist only.

First apply order, once the manifest files are filled:

```powershell
kubectl apply -f infra/k3s/linode/namespace.yaml
kubectl apply -f infra/k3s/linode/configmap.yaml
kubectl create secret generic redis-auth `
  --namespace codesageai `
  --from-literal=password=<64 random hex characters>
kubectl create secret generic codesage-secrets `
  --namespace codesageai `
  --from-env-file infra/k3s/linode/secrets.prod.env
kubectl apply -f infra/k3s/linode/redis.yaml
kubectl apply -f infra/k3s/linode/ml.yaml
kubectl apply -f infra/k3s/linode/migrate-job.yaml
kubectl apply -f infra/k3s/linode/api.yaml
kubectl apply -f infra/k3s/linode/worker.yaml
kubectl apply -f infra/k3s/linode/score-worker.yaml
kubectl apply -f infra/k3s/linode/web.yaml
kubectl apply -f infra/k3s/linode/ingress.yaml
kubectl apply -f infra/k3s/linode/keda-worker.yaml
kubectl apply -f infra/k3s/linode/keda-score-worker.yaml
```

Apply `networkpolicy.yaml` last, after the app works.

## Response compression

The ingress compresses responses with Brotli or gzip (`ingress-nginx-values.yaml`).
Apply it once, and again after any reinstall of the controller:

```bash
helm upgrade ingress-nginx ingress-nginx/ingress-nginx -n ingress-nginx   --reuse-values -f infra/k3s/linode/ingress-nginx-values.yaml
```

Check it with a signed-in cookie. The answer must carry `content-encoding: br`:

```bash
curl -s -o /dev/null -D - -H "Accept-Encoding: br, gzip"   -b "codesage_session=<cookie>" "https://api.codesageai.dev/api/projects" | grep -i content-encoding
```

## Changing a manifest on the running cluster

CI deploys by setting `sha-` image tags, but these files name `:latest`. A plain
`kubectl apply` would therefore change the running image. Put the running image
back in while applying:

```powershell
Set-Location infra/k3s/linode
$api = kubectl -n codesageai get deploy api -o jsonpath='{.spec.template.spec.containers[0].image}'
$ml  = kubectl -n codesageai get deploy ml  -o jsonpath='{.spec.template.spec.containers[0].image}'
$web = kubectl -n codesageai get deploy web -o jsonpath='{.spec.template.spec.containers[0].image}'
foreach ($f in 'api.yaml','web.yaml','ml.yaml','worker.yaml','score-worker.yaml') {
  (Get-Content $f -Raw).Replace('ghcr.io/jpabasara/codesage-ai/api:latest',$api).Replace('ghcr.io/jpabasara/codesage-ai/ml:latest',$ml).Replace('ghcr.io/jpabasara/codesage-ai/web:latest',$web) | kubectl apply -f -
}
```

`--from-env-file` replaces the whole `codesage-secrets` Secret and refuses a
file with the same key twice. When changing a value, comment the old line out;
do not leave both.

The api image runs `tini` as its ENTRYPOINT. The worker, score-worker and
migrate manifests set `args:` only, because a Kubernetes `command:` would
replace it.
