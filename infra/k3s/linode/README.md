# Code Sage AI on Linode k3s

This folder contains the Kubernetes files for the Linode k3s deployment.

Current target:

- One Akamai/Linode Compute Instance.
- Shared CPU, Linode 8 GB, 4 vCPU.
- One k3s node at first.
- Neon Postgres stays outside the cluster.
- Upstash Redis stays outside the cluster.
- GHCR images are public.

Workloads:

- `web` uses `ghcr.io/jpabasara/codesage-ai/web`.
- `api` uses `ghcr.io/jpabasara/codesage-ai/api`.
- `ml` uses `ghcr.io/jpabasara/codesage-ai/ml`.
- `worker` uses the `api` image and listens to queue `scans`.
- `score-worker` uses the `api` image and listens to queue `scoring`.

Do not commit real secrets. Use `secrets.example.env` as the checklist only.

First apply order, once the manifest files are filled:

```powershell
kubectl apply -f infra/k3s/linode/namespace.yaml
kubectl apply -f infra/k3s/linode/configmap.yaml
kubectl create secret generic codesage-secrets `
  --namespace codesageai `
  --from-env-file infra/k3s/linode/secrets.prod.env
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
