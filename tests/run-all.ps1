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
        Write-Host "dotnet : $(dotnet --version)"
        Write-Host "cargo  : $(cargo --version)"
        wsl --version

        if (Get-Command wslc -ErrorAction SilentlyContinue) {
            wslc version
        } else {
            Write-Host "wslc CLI not on PATH; Microsoft.WSL.Containers SDK smoke test remains authoritative."
        }

        if ([string]::IsNullOrWhiteSpace($NgrokAuthtoken)) {
            throw "NGROK_AUTHTOKEN is required. Set it first: `$env:NGROK_AUTHTOKEN = 'your-token'"
        }
    }

    Run-Step "Frontend dependencies" {
        if ($SkipInstall) {
            if (-not (Test-Path "node_modules")) {
                throw "-SkipInstall was supplied but node_modules does not exist."
            }
            Write-Host "Skipping npm install because -SkipInstall was supplied."
        } elseif (Test-Path "node_modules") {
            Write-Host "node_modules exists; using current installed dependencies."
        } else {
            npm ci
            if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }
        }
    }

    Run-Step "TypeScript typecheck" {
        npm run typecheck
        if ($LASTEXITCODE -ne 0) { throw "npm run typecheck failed with exit code $LASTEXITCODE" }
    }

    Run-Step "C# Quay.Host compile" {
        dotnet build host/Quay.Host.csproj -c Release
        if ($LASTEXITCODE -ne 0) { throw "Quay.Host build failed with exit code $LASTEXITCODE" }
    }

    Run-Step "Rust/Tauri compile check" {
        cargo check --manifest-path src-tauri/Cargo.toml
        if ($LASTEXITCODE -ne 0) { throw "cargo check failed with exit code $LASTEXITCODE" }
    }

    Run-Step "Direct Microsoft.WSL.Containers SDK smoke" {
        dotnet run --project tests/Wslc.Smoke/Wslc.Smoke.csproj -c Release
        if ($LASTEXITCODE -ne 0) { throw "WSLC SDK smoke failed with exit code $LASTEXITCODE" }
    }

    Run-Step "Publish real Quay.Host sidecar" {
        & ./scripts/prepare-sidecar.ps1 -Rid win-x64
        if ($LASTEXITCODE -ne 0) { throw "prepare-sidecar.ps1 failed with exit code $LASTEXITCODE" }
    }

    Run-Step "Quay.Host + nginx + local-coding Group E2E" {
        & ./tests/host-smoke.ps1 `
            -HostExe host/publish/win-x64/quay-host.exe `
            -NgrokAuthtoken $NgrokAuthtoken
        if ($LASTEXITCODE -ne 0) { throw "host-smoke.ps1 failed with exit code $LASTEXITCODE" }
    }
}
finally {
    Write-Host ""
    Write-Host "===================== TEST SUMMARY =====================" -ForegroundColor Cyan
    if ($results.Count -gt 0) {
        $results | Format-Table -AutoSize
    }
    $elapsed = (Get-Date) - $startedAt
    $failed = @($results | Where-Object { $_.Result -eq "FAIL" }).Count
    if ($failed -eq 0 -and $results.Count -gt 0) {
        Write-Host "ALL TESTS PASSED in $([math]::Round($elapsed.TotalMinutes, 1)) minute(s)." -ForegroundColor Green
    } elseif ($failed -gt 0) {
        Write-Host "$failed TEST(S) FAILED after $([math]::Round($elapsed.TotalMinutes, 1)) minute(s)." -ForegroundColor Red
    }
}
