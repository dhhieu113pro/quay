# Publish the C# sidecar next to the Tauri binary.
# Usage: pwsh -File scripts/prepare-sidecar.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "host/publish"
$bin = Join-Path $root "src-tauri/binaries"

Write-Host "Publishing Quay.Host (win-x64, self-contained)"
dotnet publish (Join-Path $root "host/Quay.Host.csproj") `
  -c Release `
  -r win-x64 `
  --self-contained true `
  -p:PublishSingleFile=true `
  -p:IncludeNativeLibrariesForSelfExtract=true `
  -p:DebugType=none `
  -o $out

New-Item -ItemType Directory -Force -Path $bin | Out-Null
$exe = Join-Path $out "quay-host.exe"
if (-not (Test-Path $exe)) {
  throw "dotnet publish did not produce quay-host.exe"
}
Copy-Item $exe (Join-Path $bin "quay-host-x86_64-pc-windows-msvc.exe") -Force
Write-Host "Sidecar -> src-tauri/binaries/quay-host-x86_64-pc-windows-msvc.exe"
