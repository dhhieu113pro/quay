param(
    [string]$NgrokAuthtoken = $env:NGROK_AUTHTOKEN,
    [switch]$SkipInstall,
    [int]$MaxQueryLatencyMs = 5000,
    [string]$ResponsivenessImage = "alpine:3.20"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$results = [System.Collections.Generic.List[object]]::new()
$startedAt = Get-Date
$workspace = Join-Path $env:TEMP "quay-local-coding-test"
$responsivenessContainer = "quay-responsiveness-test"

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

function Assert-WslcQueriesResponsive([System.Management.Automation.Job]$Job, [int]$MinimumSamples = 3) {
    $samples = [System.Collections.Generic.List[double]]::new()
    while ($Job.State -in @("NotStarted", "Running") -or $samples.Count -lt $MinimumSamples) {
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $output = wslc container list --all 2>&1 | Out-String
        $exitCode = $LASTEXITCODE
        $sw.Stop()
        if ($exitCode -ne 0) { throw "wslc container list failed during concurrent operation: $output" }
        $samples.Add($sw.Elapsed.TotalMilliseconds)
        if ($sw.Elapsed.TotalMilliseconds -gt $MaxQueryLatencyMs) {
            throw "WSLC query latency $([math]::Round($sw.Elapsed.TotalMilliseconds))ms exceeded MaxQueryLatencyMs=$MaxQueryLatencyMs while mutation was active."
        }
        if ($Job.State -notin @("NotStarted", "Running") -and $samples.Count -ge $MinimumSamples) { break }
        Start-Sleep -Milliseconds 150
    }
    $max = ($samples | Measure-Object -Maximum).Maximum
    Write-Host "Concurrent WSLC query samples=$($samples.Count), max=$([math]::Round($max))ms (limit ${MaxQueryLatencyMs}ms)"
}

function Complete-BackgroundWslcJob([System.Management.Automation.Job]$Job, [string]$Description) {
    Wait-Job $Job -Timeout 700 | Out-Null
    if ($Job.State -in @("NotStarted", "Running")) {
        Stop-Job $Job -ErrorAction SilentlyContinue
        throw "$Description did not finish before the validation timeout."
    }
    $output = Receive-Job $Job -ErrorAction SilentlyContinue | Out-String
    if ($Job.State -ne "Completed") { throw "$Description failed with state $($Job.State): $output" }
    if ($output.Trim()) { Write-Host $output.Trim() }
    Remove-Job $Job -Force -ErrorAction SilentlyContinue
}

try {
    Run-Step "Prerequisites" {
        Require-Command "node"; Require-Command "pnpm"; Require-Command "cargo"; Require-Command "wslc"
        node --version; pnpm --version; cargo --version; wslc version
    }

    Run-Step "Frontend dependencies" {
        if ($SkipInstall) {
            if (-not (Test-Path "node_modules")) { throw "-SkipInstall supplied but node_modules does not exist." }
        } elseif (-not (Test-Path "node_modules")) {
            if (-not (Test-Path "pnpm-lock.yaml") -and (Test-Path "package-lock.json")) {
                pnpm import
                if ($LASTEXITCODE -ne 0) { throw "pnpm import failed" }
            }
            pnpm install --frozen-lockfile
            if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }
        }
    }

    Run-Step "TypeScript typecheck" {
        pnpm typecheck
        if ($LASTEXITCODE -ne 0) { throw "typecheck failed" }
    }

    Run-Step "Rust/Tauri backend tests" {
        cargo test --manifest-path src-tauri/Cargo.toml
        if ($LASTEXITCODE -ne 0) { throw "cargo test failed" }
    }

    Run-Step "WSLC responsiveness under mutation" {
        Remove-WslcContainer $responsivenessContainer
        wslc pull $ResponsivenessImage | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "could not prepare responsiveness image $ResponsivenessImage" }
        $job = Start-Job -ScriptBlock {
            param($Name, $Image)
            & wslc run --name $Name $Image sh -c "sleep 8" 2>&1
            if ($LASTEXITCODE -ne 0) { throw "wslc run responsiveness mutation failed" }
        } -ArgumentList $responsivenessContainer, $ResponsivenessImage
        try {
            Start-Sleep -Milliseconds 300
            Assert-WslcQueriesResponsive $job 5
            Complete-BackgroundWslcJob $job "WSLC responsiveness mutation"
        } finally {
            if ($job -and (Get-Job -Id $job.Id -ErrorAction SilentlyContinue)) {
                Stop-Job $job -ErrorAction SilentlyContinue
                Remove-Job $job -Force -ErrorAction SilentlyContinue
            }
            Remove-WslcContainer $responsivenessContainer
        }
    }

    Run-Step "WSLC responsiveness during image pull" {
        $job = Start-Job -ScriptBlock {
            param($Image)
            & wslc pull $Image 2>&1
            if ($LASTEXITCODE -ne 0) { throw "wslc pull failed for $Image" }
        } -ArgumentList $ResponsivenessImage
        try {
            Assert-WslcQueriesResponsive $job 3
            Complete-BackgroundWslcJob $job "WSLC image pull"
        } finally {
            if ($job -and (Get-Job -Id $job.Id -ErrorAction SilentlyContinue)) {
                Stop-Job $job -ErrorAction SilentlyContinue
                Remove-Job $job -Force -ErrorAction SilentlyContinue
            }
        }
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

    Run-Step "Default WSLC LocalCoding Cube core E2E" {
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

        $running = wslc container list | Out-String
        if ($running -notmatch "local-coding-mcp") { throw "LocalCoding core container is not running" }
    }

    if (-not [string]::IsNullOrWhiteSpace($NgrokAuthtoken)) {
        Run-Step "Default WSLC LocalCoding ngrok E2E" {
            Remove-WslcContainer "local-coding-mcp-ngrok"
            wslc run -d --name local-coding-mcp-ngrok --network mcp-net -p 14040:4040 -e "NGROK_AUTHTOKEN=$NgrokAuthtoken" ngrok/ngrok:latest http local-coding-mcp:5000 --log=stdout
            if ($LASTEXITCODE -ne 0) { throw "ngrok failed to start" }
            $api = Wait-Http "http://127.0.0.1:14040/api/tunnels"
            $body = $api.Content | ConvertFrom-Json
            if (@($body.tunnels).Count -lt 1) { throw "ngrok has no active tunnel" }
        }
    } else {
        Write-Host ""
        Write-Host "SKIP: LocalCoding ngrok E2E (NGROK_AUTHTOKEN not configured)" -ForegroundColor Yellow
    }
}
finally {
    Remove-WslcContainer $responsivenessContainer
    Remove-WslcContainer "local-coding-mcp-ngrok"
    Remove-WslcContainer "local-coding-mcp"
    Remove-WslcContainer "quay-test-nginx"
    Write-Host ""
    Write-Host "===================== TEST SUMMARY =====================" -ForegroundColor Cyan
    if ($results.Count -gt 0) { $results | Format-Table -AutoSize }
    $failed = @($results | Where-Object { $_.Result -eq "FAIL" }).Count
    if ($failed -eq 0 -and $results.Count -gt 0) { Write-Host "ALL WSLC TESTS PASSED" -ForegroundColor Green }
    elseif ($failed -gt 0) { Write-Host "$failed TEST(S) FAILED" -ForegroundColor Red }
}
