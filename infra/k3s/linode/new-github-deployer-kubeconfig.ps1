<#
.SYNOPSIS
Creates a restricted GitHub Actions kubeconfig for the github-deployer account.

.DESCRIPTION
Uses the local administrator kubeconfig only to create/read the dedicated
service-account token and cluster CA. The output has one namespace-scoped
identity and points only at the k3s server's Tailscale API address.

The generated file and its base64 text are secrets. The script copies the
base64 text to the Windows clipboard and never prints it.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^https://[^/]+:6443$')]
    [string]$ApiServer,

    [string]$AdminKubeconfig = "$env:USERPROFILE\.kube\codesageai-k3s.yaml",
    [string]$OutputPath = "$env:USERPROFILE\.kube\codesageai-github-deployer.yaml",
    [string]$Namespace = 'codesageai',
    [string]$ServiceAccount = 'github-deployer',
    [string]$TokenSecretName = 'github-deployer-token'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Kubectl {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

    $output = & kubectl --kubeconfig $AdminKubeconfig @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "kubectl failed: kubectl --kubeconfig `"$AdminKubeconfig`" $($Arguments -join ' ')"
    }

    return ($output | Out-String).Trim()
}

if (-not (Test-Path -LiteralPath $AdminKubeconfig -PathType Leaf)) {
    throw "Administrator kubeconfig not found: $AdminKubeconfig"
}

$tokenManifest = Join-Path $PSScriptRoot 'github-deployer-token.yaml'
if (-not (Test-Path -LiteralPath $tokenManifest -PathType Leaf)) {
    throw "Token manifest not found: $tokenManifest"
}

# Applying the same manifest is idempotent. Kubernetes populates the token
# asynchronously, so wait briefly instead of reading or printing a partial Secret.
Invoke-Kubectl apply -f $tokenManifest | Out-Null
$tokenBase64 = ''
for ($attempt = 1; $attempt -le 15; $attempt++) {
    $tokenBase64 = Invoke-Kubectl get secret $TokenSecretName -n $Namespace -o 'jsonpath={.data.token}'
    if ($tokenBase64) {
        break
    }
    Start-Sleep -Seconds 2
}
if (-not $tokenBase64) {
    throw "Kubernetes did not populate Secret/$TokenSecretName with a service-account token."
}

$caData = Invoke-Kubectl config view --raw --minify -o 'jsonpath={.clusters[0].cluster.certificate-authority-data}'
if (-not $caData) {
    throw 'The administrator kubeconfig did not contain embedded certificate-authority-data.'
}

$serviceAccountSubject = "system:serviceaccount:$Namespace`:$ServiceAccount"
$canPatchDeployments = Invoke-Kubectl auth can-i patch deployments -n $Namespace --as=$serviceAccountSubject
$canReadSecrets = Invoke-Kubectl auth can-i get secrets -n $Namespace --as=$serviceAccountSubject
if ($canPatchDeployments -ne 'yes' -or $canReadSecrets -ne 'no') {
    throw "RBAC validation failed. Expected patch deployments=yes and get secrets=no; got $canPatchDeployments and $canReadSecrets."
}

$token = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($tokenBase64))
$kubeconfig = @"
apiVersion: v1
kind: Config
clusters:
  - name: codesageai-k3s
    cluster:
      certificate-authority-data: $caData
      server: $ApiServer
contexts:
  - name: github-deployer@codesageai-k3s
    context:
      cluster: codesageai-k3s
      namespace: $Namespace
      user: github-deployer
current-context: github-deployer@codesageai-k3s
users:
  - name: github-deployer
    user:
      token: $token
"@

$outputDirectory = Split-Path -Parent $OutputPath
if (-not $outputDirectory) {
    throw "OutputPath must include a directory: $OutputPath"
}
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
[System.IO.File]::WriteAllText(
    $OutputPath,
    $kubeconfig,
    [System.Text.UTF8Encoding]::new($false)
)

# Keep the local generated credential readable only by the current Windows user.
& icacls $OutputPath /inheritance:r /grant:r "$env:USERNAME`:(R,W)" | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Could not restrict file permissions on $OutputPath"
}

$kubeconfigBase64 = [System.Convert]::ToBase64String([System.IO.File]::ReadAllBytes($OutputPath))
Set-Clipboard -Value $kubeconfigBase64

# Clear sensitive variables before reporting success. Do not add Write-Host for
# any credential material above this line.
Remove-Variable token, tokenBase64, kubeconfig, kubeconfigBase64 -ErrorAction SilentlyContinue

Write-Host "Created restricted kubeconfig: $OutputPath"
Write-Host 'Its one-line base64 value is now in your clipboard.'
Write-Host 'Paste it into GitHub Environment production -> secret KUBECONFIG_B64; do not commit or print it.'
