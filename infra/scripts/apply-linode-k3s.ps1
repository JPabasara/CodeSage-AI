param(
    [string]$Namespace = "codesageai"
)

$ErrorActionPreference = "Stop"

kubectl apply -f infra/k3s/linode/namespace.yaml
kubectl apply -f infra/k3s/linode/configmap.yaml

Write-Host "Namespace and ConfigMap applied to $Namespace."
Write-Host "Create the codesage-secrets Secret from secrets.prod.env before applying workloads."
