param(
    [string]$HostExe = "host/publish/win-x64/quay-host.exe"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $HostExe)) {
    throw "Quay.Host executable not found: $HostExe"
}

$sessionName = "Quay-Host-CI-$PID-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
$dataPath = Join-Path $env:RUNNER_TEMP $sessionName
if (-not $env:RUNNER_TEMP) {
    $dataPath = Join-Path $env:TEMP $sessionName
}
New-Item -ItemType Directory -Force -Path $dataPath | Out-Null

$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = (Resolve-Path $HostExe).Path
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true
$psi.ArgumentList.Add($sessionName)
$psi.ArgumentList.Add($dataPath)
$psi.ArgumentList.Add("2")
$psi.ArgumentList.Add("2048")

$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $psi
if (-not $process.Start()) {
    throw "Failed to start Quay.Host"
}

function Invoke-Host([hashtable]$Payload) {
    $json = $Payload | ConvertTo-Json -Compress -Depth 10
    $process.StandardInput.WriteLine($json)
    $process.StandardInput.Flush()

    $line = $process.StandardOutput.ReadLine()
    if ([string]::IsNullOrWhiteSpace($line)) {
        $stderr = $process.StandardError.ReadToEnd()
        throw "Quay.Host returned no response. stderr: $stderr"
    }

    Write-Host "quay-host <= $line"
    return $line | ConvertFrom-Json
}

try {
    $health = Invoke-Host @{ cmd = "health" }
    if (-not $health.ok) {
        throw "Quay.Host health failed: $($health.error)"
    }

    $run = Invoke-Host @{
        cmd = "run"
        image = "docker.io/library/alpine:latest"
        name = "quay-host-smoke"
        command = "/bin/sh -c 'echo QUAY_HOST_SMOKE_OK; sleep 30'"
        ports = ""
        env = ""
        mounts = ""
        gpu = $false
        remove = $false
        workdir = "/"
    }

    if (-not $run.ok) {
        throw "Quay.Host run failed: $($run.error)"
    }
    if ($run.container.status -notmatch "running") {
        throw "Quay.Host created container but status is '$($run.container.status)'"
    }

    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(20)
    $foundMarker = $false
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 250
        $ps = Invoke-Host @{ cmd = "ps" }
        if (-not $ps.ok) {
            throw "Quay.Host ps failed: $($ps.error)"
        }

        $container = @($ps.containers) | Where-Object { $_.name -eq "quay-host-smoke" } | Select-Object -First 1
        if ($null -eq $container) {
            throw "quay-host-smoke disappeared from Quay.Host state"
        }

        $text = (@($container.logs) | ForEach-Object { $_.text }) -join "`n"
        if ($text -match "QUAY_HOST_SMOKE_OK") {
            $foundMarker = $true
            break
        }
    }

    if (-not $foundMarker) {
        throw "Quay.Host container never emitted QUAY_HOST_SMOKE_OK"
    }

    $rm = Invoke-Host @{ cmd = "rm"; id = "quay-host-smoke" }
    if (-not $rm.ok) {
        throw "Quay.Host rm failed: $($rm.error)"
    }

    Write-Host "Quay.Host WSLC protocol smoke test passed."
}
finally {
    try { $process.StandardInput.Close() } catch {}
    if (-not $process.WaitForExit(15000)) {
        try { $process.Kill($true) } catch {}
    }
    $process.Dispose()

    try {
        if (Test-Path $dataPath) { Remove-Item $dataPath -Recurse -Force }
    } catch {
        Write-Warning "Could not remove smoke session data immediately: $($_.Exception.Message)"
    }
}
