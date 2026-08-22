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
$workspace = Join-Path $env:TEMP "quay-local-coding-test"

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
        Write-Host "PASS: $Name" -ForegroundColor Green
    } catch {
        $sw.Stop()
        $results.Add([pscustomobject]@{ Test = $Name; Result = "FAIL"; Seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1) })
        Write-Host "FAIL: $Name" -ForegroundColor Red
        Write-Host $_.Exception.ToString() -ForegroundColor Red
        throw
    }
}

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw "Required command '$Name' was not found on PATH." }
}

function Remove-WslcContainer([string]$Name) {
    $all = (wslc container list --all 2>&1 | Out-String)
    if ($all -notmatch [regex]::Escape($Name)) { return }
    wslc container stop $Name 2>$null | Out-Null
    wslc container rm $Name 2>$null | Out-Null
}

function Wait-Http([string]$Url, [string]$Contains = "", [int]$TimeoutSeconds = 90) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $last = ""
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
            if ($r.StatusCode -eq 200 -and ([string]::IsNullOrEmpty($Contains) -or $r.Content -match [regex]::Escape($Contains))) { return $r }
            $last = "HTTP $($r.StatusCode)"
        } catch { $last = $_.Exception.Message }
        Start-Sleep -Milliseconds 500
    }
    throw "Timed out waiting for $Url. Last error: $last"
}

try {
    Run-Step "Prerequisites" {
        Require-Command "node"; Require-Command "npm"; Require-Command "cargo"; Require-Command "wslc"
        node --version; npm --version; cargo --version; wslc version
        if ([string]::IsNullOrWhiteSpace($NgrokAuthtoken)) { throw "NGROK_AUTHTOKEN is required." }
    }

    Run-Step "Frontend dependencies" {
        if ($SkipInstall) {
            if (-not (Test-Path "node_modules")) { throw "-SkipInstall supplied but node_modules does not exist." }
        } elseif (-not (Test-Path "node_modules")) {
            npm ci
            if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
        }
    }

    Run-Step "TypeScript typecheck" {
        npm run typecheck
        if ($LASTEXITCODE -ne 0) { throw "typecheck failed" }
    }

    Run-Step "Rust/Tauri CLI backend compile" {
        cargo check --manifest-path src-tauri/Cargo.toml
        if ($LASTEXITCODE -ne 0) { throw "cargo check failed" }
    }

    Run-Step "Default WSLC session nginx HTTP" {
        Remove-WslcContainer "quay-test-nginx"
        wslc run -d --name quay-test-nginx -p 18080:80 nginx:latest
        if ($LASTEXITCODE -ne 0) { throw "wslc nginx run failed" }
        $r = Wait-Http "http://127.0.0.1:18080/" "Welcome to nginx"
        Write-Host "nginx HTTP $($r.StatusCode)"
        $all = wslc container list --all | Out-String
        if ($all -notmatch "quay-test-nginx") { throw "nginx container is missing from default WSLC session" }
        Remove-WslcContainer "quay-test-nginx"
    }

    Run-Step "Default WSLC local-coding Group E2E" {
        New-Item -ItemType Directory -Force -Path $workspace | Out-Null
        Remove-WslcContainer "local-coding-mcp-ngrok"
        Remove-WslcContainer "local-coding-mcp"

        $networks = wslc network list | Out-String
        if ($networks -notmatch "mcp-net") {
            wslc network create mcp-net
            if ($LASTEXITCODE -ne 0) { throw "could not create mcp-net" }
        }

        wslc run -d --name local-coding-mcp --network mcp-net -p 15000:5000 -e AllowedRoots__0=/workspace -v "${workspace}:/workspace" ghcr.io/dhhieu113pro/local-coding-mcp:latest
        if ($LASTEXITCODE -ne 0) { throw "local-coding-mcp failed to start" }
        Wait-Http "http://127.0.0.1:15000/health" | Out-Null

        wslc run -d --name local-coding-mcp-ngrok --network mcp-net -p 14040:4040 -e "NGROK_AUTHTOKEN=$NgrokAuthtoken" ngrok/ngrok:latest http local-coding-mcp:5000 --log=stdout
        if ($LASTEXITCODE -ne 0) { throw "ngrok failed to start" }
        $api = Wait-Http "http://127.0.0.1:14040/api/tunnels"
        $body = $api.Content | ConvertFrom-Json
        if (@($body.tunnels).Count -lt 1) { throw "ngrok has no active tunnel" }

        $running = wslc container list | Out-String
        if ($running -notmatch "local-coding-mcp" -or $running -notmatch "local-coding-mcp-ngrok") { throw "local-coding Group is not fully running" }
    }
}
finally {
    Remove-WslcContainer "local-coding-mcp-ngrok"
    Remove-WslcContainer "local-coding-mcp"
    Remove-WslcContainer "quay-test-nginx"
    Write-Host ""
    Write-Host "===================== TEST SUMMARY =====================" -ForegroundColor Cyan
    if ($results.Count -gt 0) { $results | Format-Table -AutoSize }
    $failed = @($results | Where-Object { $_.Result -eq "FAIL" }).Count
    if ($failed -eq 0 -and $results.Count -gt 0) { Write-Host "ALL CLI TESTS PASSED" -ForegroundColor Green }
    elseif ($failed -gt 0) { Write-Host "$failed TEST(S) FAILED" -ForegroundColor Red }
}
