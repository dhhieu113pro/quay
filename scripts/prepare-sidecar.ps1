# Publish the C# sidecar next to the Tauri binary.
# Usage:
#   pwsh -File scripts/prepare-sidecar.ps1
#   pwsh -File scripts/prepare-sidecar.ps1 -Rid win-arm64
param(
    [ValidateSet("win-x64", "win-arm64")]
    [string]$Rid = "win-x64"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "host/publish/$Rid"
$bin = Join-Path $root "src-tauri/binaries"
$triple = if ($Rid -eq "win-arm64") { "aarch64-pc-windows-msvc" } else { "x86_64-pc-windows-msvc" }

Write-Host "Publishing Quay.Host ($Rid, self-contained)"
& dotnet publish (Join-Path $root "host/Quay.Host.csproj") `
  -c Release `
  -r $Rid `
  --self-contained true `
  -p:PublishSingleFile=true `
  -p:IncludeNativeLibrariesForSelfExtract=true `
  -p:DebugType=none `
  -o $out

if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed with exit code $LASTEXITCODE"
}

New-Item -ItemType Directory -Force -Path $bin | Out-Null
$exe = Join-Path $out "quay-host.exe"
if (-not (Test-Path $exe)) {
    throw "dotnet publish did not produce quay-host.exe"
}
$dest = Join-Path $bin "quay-host-$triple.exe"
Copy-Item $exe $dest -Force
Write-Host "Sidecar -> $dest"
