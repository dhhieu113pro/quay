param(
    [ValidateSet("win-x64", "win-arm64")]
    [string]$Rid = $(if ($env:PROCESSOR_ARCHITECTURE -match "ARM64") { "win-arm64" } else { "win-x64" })
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$version = "2.9.3"
$packageRoot = Join-Path $env:USERPROFILE ".nuget\packages\microsoft.wsl.containers\$version"

if (-not (Test-Path $packageRoot)) {
    Write-Host "Restoring Microsoft.WSL.Containers $version"
    & dotnet restore (Join-Path $root "host/Quay.Host.csproj")
    if ($LASTEXITCODE -ne 0) { throw "dotnet restore failed with exit code $LASTEXITCODE" }
}

$all = @(Get-ChildItem $packageRoot -Recurse -Filter "wslcsdk.dll" -File)
if ($all.Count -eq 0) { throw "wslcsdk.dll was not found in $packageRoot" }

$archPattern = if ($Rid -eq "win-arm64") { "arm64" } else { "x64" }
$dll = $all | Where-Object { $_.FullName -match $archPattern } | Select-Object -First 1
if (-not $dll) {
    Write-Host "Available native SDK files:"
    $all | ForEach-Object { Write-Host "- $($_.FullName)" }
    throw "Could not find $Rid wslcsdk.dll in Microsoft.WSL.Containers $version"
}

$destDir = Join-Path $root "src-tauri/binaries"
New-Item -ItemType Directory -Force -Path $destDir | Out-Null
$dest = Join-Path $destDir "wslcsdk.dll"
Copy-Item $dll.FullName $dest -Force
Write-Host "WSLC native SDK ($Rid) -> $dest"
