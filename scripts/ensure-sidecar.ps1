# Publish quay-host.exe into src-tauri/binaries when missing or stale.
# Usage: powershell -File scripts/ensure-sidecar.ps1 [-Force]
param([switch]$Force)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$arch = [System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture
$rid = if ($arch -eq "Arm64") { "win-arm64" } else { "win-x64" }
$triple = if ($rid -eq "win-arm64") { "aarch64-pc-windows-msvc" } else { "x86_64-pc-windows-msvc" }
$dest = Join-Path $root "src-tauri/binaries/quay-host-$triple.exe"

$hostFiles = @(
    (Join-Path $root "host/Program.cs"),
    (Join-Path $root "host/Quay.Host.csproj")
)

$needsBuild = $Force -or -not (Test-Path $dest)
if (-not $needsBuild) {
    $destTime = (Get-Item $dest).LastWriteTimeUtc
    foreach ($source in $hostFiles) {
        if ((Test-Path $source) -and (Get-Item $source).LastWriteTimeUtc -gt $destTime) {
            $needsBuild = $true
            break
        }
    }
}

if (-not $needsBuild) {
    Write-Host "Sidecar is up to date at $dest"
    exit 0
}

Write-Host "Sidecar missing or stale; rebuilding..."
& (Join-Path $PSScriptRoot "prepare-sidecar.ps1") -Rid $rid
