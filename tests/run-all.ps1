param(
    [string]$NgrokAuthtoken = $env:NGROK_AUTHTOKEN,
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$results = [System.Collections.Generic.List[object]]::new()
$startedAt = Get-Date

function Run-Step([string]$Name, [scriptblock]$Action) {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "TEST: $Name" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        & $Action
        $sw.Stop()
        $results.Add([pscustomobject]@{ Test = $Name; Result = "PASS"; Seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1) })
        Write-Host "PASS: $Name ($([math]::Round($sw.Elapsed.TotalSeconds, 1))s)" -ForegroundColor Green
    }
    catch {
        $sw.Stop()
        $results.Add([pscustomobject]@{ Test = $Name; Result = "FAIL"; Seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1) })
        Write-Host "FAIL: $Name" -ForegroundColor Red
        Write-Host $_.Exception.ToString() -ForegroundColor Red
        throw
    }
}

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found on PATH."
    }
}

try {
    Run-Step "Prerequisites" {
        Require-Command "node"
        Require-Command "npm"
        Require-Command "dotnet"
        Require-Command "cargo"
        Require-Command "wsl"

        Write-Host "node   : $(node --version)"
        Write-Host "npm    : $(npm --version)"
        Write-Host "dotnet : $(dotnet --version)  (only used to restore the native WSLC NuGet package if not cached)"
        Write-Host "cargo  : $(cargo --version)"
        wsl --version

        if (Get-Command wslc -ErrorAction SilentlyContinue) { wslc version }
        if ([string]::IsNullOrWhiteSpace($NgrokAuthtoken)) {
            throw "NGROK_AUTHTOKEN is required. Set it first: `$env:NGROK_AUTHTOKEN = 'your-token'"
        }
        $env:NGROK_AUTHTOKEN = $NgrokAuthtoken
    }

    Run-Step "Frontend dependencies" {
        if ($SkipInstall) {
            if (-not (Test-Path "node_modules")) { throw "-SkipInstall was supplied but node_modules does not exist." }
        } elseif (-not (Test-Path "node_modules")) {
            npm ci
            if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }
        }
    }

    Run-Step "TypeScript typecheck" {
        npm run typecheck
        if ($LASTEXITCODE -ne 0) { throw "npm run typecheck failed with exit code $LASTEXITCODE" }
    }

    Run-Step "Stage Microsoft native WSLC SDK" {
        & ./scripts/prepare-wslc-sdk.ps1 -Rid win-x64
        if ($LASTEXITCODE -ne 0) { throw "prepare-wslc-sdk.ps1 failed with exit code $LASTEXITCODE" }
        $env:QUAY_WSLC_SDK_DLL = (Resolve-Path "src-tauri/binaries/wslcsdk.dll").Path
    }

    Run-Step "Rust/Tauri native backend compile check" {
        cargo check --manifest-path src-tauri/Cargo.toml
        if ($LASTEXITCODE -ne 0) { throw "cargo check failed with exit code $LASTEXITCODE" }
    }

    Run-Step "Rust native WSLC + nginx HTTP smoke" {
        cargo run --manifest-path src-tauri/Cargo.toml --bin wslc-native-smoke
        if ($LASTEXITCODE -ne 0) { throw "native nginx smoke failed with exit code $LASTEXITCODE" }
    }

    Run-Step "Rust native local-coding Group E2E" {
        cargo run --manifest-path src-tauri/Cargo.toml --bin wslc-native-group-smoke
        if ($LASTEXITCODE -ne 0) { throw "native local-coding Group smoke failed with exit code $LASTEXITCODE" }
    }
}
finally {
    Write-Host ""
    Write-Host "===================== TEST SUMMARY =====================" -ForegroundColor Cyan
    if ($results.Count -gt 0) { $results | Format-Table -AutoSize }
    $elapsed = (Get-Date) - $startedAt
    $failed = @($results | Where-Object { $_.Result -eq "FAIL" }).Count
    if ($failed -eq 0 -and $results.Count -gt 0) {
        Write-Host "ALL NATIVE RUST TESTS PASSED in $([math]::Round($elapsed.TotalMinutes, 1)) minute(s)." -ForegroundColor Green
    } elseif ($failed -gt 0) {
        Write-Host "$failed TEST(S) FAILED after $([math]::Round($elapsed.TotalMinutes, 1)) minute(s)." -ForegroundColor Red
    }
}
