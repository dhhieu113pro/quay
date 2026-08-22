# Publish quay-host.exe into src-tauri/binaries if Tauri doesn't have it yet.
# Usage: powershell -File scripts/ensure-sidecar.ps1 [-Force]
param([switch]$Force)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$arch = [System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture
$rid = if ($arch -eq "Arm64") { "win-arm64" } else { "win-x64" }
$triple = if ($rid -eq "win-arm64") { "aarch64-pc-windows-msvc" } else { "x86_64-pc-windows-msvc" }
$dest = Join-Path $root "src-tauri/binaries/quay-host-$triple.exe"

if (-not $Force -and (Test-Path $dest)) {
    Write-Host "Sidecar already at $dest"
    exit 0
}

& (Join-Path $PSScriptRoot "prepare-sidecar.ps1") -Rid $rid
