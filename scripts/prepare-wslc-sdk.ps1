param(
    [ValidateSet("win-x64", "win-arm64")]
    [string]$Rid = $(if ($env:PROCESSOR_ARCHITECTURE -match "ARM64") { "win-arm64" } else { "win-x64" })
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$version = "2.9.3"
$cacheRoot = Join-Path $root ".quay-cache\wslc-sdk\$version"
$packageFile = Join-Path $cacheRoot "microsoft.wsl.containers.$version.nupkg"
$extractRoot = Join-Path $cacheRoot "package"

if (-not (Test-Path $extractRoot)) {
    New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null
    if (-not (Test-Path $packageFile)) {
        $url = "https://api.nuget.org/v3-flatcontainer/microsoft.wsl.containers/$version/microsoft.wsl.containers.$version.nupkg"
        Write-Host "Downloading Microsoft.WSL.Containers $version"
        Invoke-WebRequest -Uri $url -OutFile $packageFile -UseBasicParsing
    }

    if (Test-Path $extractRoot) { Remove-Item $extractRoot -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($packageFile, $extractRoot)
}

$all = @(Get-ChildItem $extractRoot -Recurse -Filter "wslcsdk.dll" -File)
if ($all.Count -eq 0) { throw "wslcsdk.dll was not found in Microsoft.WSL.Containers $version" }

$archPattern = if ($Rid -eq "win-arm64") { "arm64" } else { "x64" }
$dll = $all | Where-Object { $_.FullName -match $archPattern } | Select-Object -First 1
if (-not $dll) {
    Write-Host "Available WSLC DLLs:"
    $all | ForEach-Object { Write-Host "- $($_.FullName)" }
    throw "Could not find $Rid wslcsdk.dll in Microsoft.WSL.Containers $version"
}

$destDir = Join-Path $root "src-tauri/binaries"
New-Item -ItemType Directory -Force -Path $destDir | Out-Null
$dest = Join-Path $destDir "wslcsdk.dll"
Copy-Item $dll.FullName $dest -Force
Write-Host "WSLC native SDK ($Rid) -> $dest"
