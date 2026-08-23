param(
  [Parameter(Mandatory = $true)][string]$PackageName,
  [Parameter(Mandatory = $true)][string]$Publisher,
  [Parameter(Mandatory = $true)][string]$PublisherDisplayName,
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][ValidateSet('x64', 'arm64')][string]$Architecture,
  [Parameter(Mandatory = $true)][string]$ExePath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'

function XmlEscape([string]$Value) {
  return [System.Security.SecurityElement]::Escape($Value)
}

if (-not (Test-Path $ExePath)) {
  throw "Quay executable not found: $ExePath"
}

if ($Version -notmatch '^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$') {
  throw "Version '$Version' must look like 0.1.7"
}
$msixVersion = "$($Matches[1]).$($Matches[2]).$($Matches[3]).0"

$repoRoot = Split-Path -Parent $PSScriptRoot
$layout = Join-Path $repoRoot "store\msix-layout-$Architecture"
Remove-Item $layout -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $layout | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $layout 'Assets') | Out-Null

Copy-Item $ExePath (Join-Path $layout 'Quay.exe')

$assets = @{
  'src-tauri\icons\Square150x150Logo.png' = 'Assets\Square150x150Logo.png'
  'src-tauri\icons\Square44x44Logo.png' = 'Assets\Square44x44Logo.png'
  'src-tauri\icons\StoreLogo.png' = 'Assets\StoreLogo.png'
}
foreach ($entry in $assets.GetEnumerator()) {
  $source = Join-Path $repoRoot $entry.Key
  if (-not (Test-Path $source)) { throw "MSIX asset missing: $source" }
  Copy-Item $source (Join-Path $layout $entry.Value)
}

$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap uap10 rescap">
  <Identity
    Name="$(XmlEscape $PackageName)"
    Publisher="$(XmlEscape $Publisher)"
    Version="$msixVersion"
    ProcessorArchitecture="$Architecture" />
  <Properties>
    <DisplayName>Quay for WSLC</DisplayName>
    <PublisherDisplayName>$(XmlEscape $PublisherDisplayName)</PublisherDisplayName>
    <Description>Quay is a lightweight Windows desktop application for managing WSLC containers.</Description>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <Resources>
    <Resource Language="en-us" />
  </Resources>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Applications>
    <Application
      Id="Quay"
      Executable="Quay.exe"
      uap10:RuntimeBehavior="packagedClassicApp"
      uap10:TrustLevel="mediumIL">
      <uap:VisualElements
        DisplayName="Quay for WSLC"
        Description="Manage WSLC containers from Windows."
        BackgroundColor="transparent"
        Square150x150Logo="Assets\Square150x150Logo.png"
        Square44x44Logo="Assets\Square44x44Logo.png" />
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
"@

$manifestPath = Join-Path $layout 'AppxManifest.xml'
[System.IO.File]::WriteAllText($manifestPath, $manifest, [System.Text.UTF8Encoding]::new($false))

$preferredToolArch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$kitsRoot = ${env:ProgramFiles(x86)}
$makeAppx = Get-ChildItem "$kitsRoot\Windows Kits\10\bin\*\$preferredToolArch\makeappx.exe" -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending |
  Select-Object -First 1
if (-not $makeAppx) {
  $makeAppx = Get-ChildItem "$kitsRoot\Windows Kits\10\bin" -Filter makeappx.exe -Recurse -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    Select-Object -First 1
}
if (-not $makeAppx) { throw 'makeappx.exe was not found in the Windows SDK' }

$outputFullPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputPath))
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outputFullPath) | Out-Null
Remove-Item $outputFullPath -Force -ErrorAction SilentlyContinue

Write-Host "Packing unsigned Store MSIX: $outputFullPath"
Write-Host "Identity: $PackageName | $Publisher | $msixVersion | $Architecture"
& $makeAppx.FullName pack /d $layout /p $outputFullPath /o
if ($LASTEXITCODE -ne 0) { throw "MakeAppx failed with exit code $LASTEXITCODE" }

if (-not (Test-Path $outputFullPath)) { throw 'MSIX package was not created' }
Write-Host "Created $outputFullPath"
