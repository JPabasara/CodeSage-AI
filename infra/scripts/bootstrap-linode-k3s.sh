#!/usr/bin/env bash
set -euo pipefail

# Server-side bootstrap for the Linode k3s node.
# Run this over SSH on the fresh Linode after basic OS updates.

curl -sfL https://get.k3s.io | sh -s - --disable traefik

curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

kubectl get nodes
helm version
