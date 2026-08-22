param(
    [string]$HostExe = "host/publish/win-x64/quay-host.exe",
    [string]$NgrokAuthtoken = $env:NGROK_AUTHTOKEN
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $HostExe)) {
    throw "Quay.Host executable not found: $HostExe"
}
if ([string]::IsNullOrWhiteSpace($NgrokAuthtoken)) {
    throw "NGROK_AUTHTOKEN is required for the full local-coding Group smoke test. Add it as a GitHub Actions repository secret."
}

$sessionName = "Quay-Host-CI-$PID-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
$runnerTemp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$dataPath = Join-Path $runnerTemp $sessionName
$workspacePath = Join-Path $runnerTemp "$sessionName-workspace"
New-Item -ItemType Directory -Force -Path $dataPath | Out-Null
New-Item -ItemType Directory -Force -Path $workspacePath | Out-Null

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
$psi.ArgumentList.Add("3072")

$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $psi
if (-not $process.Start()) {
    throw "Failed to start Quay.Host"
}

function Invoke-Host([hashtable]$Payload) {
    $json = $Payload | ConvertTo-Json -Compress -Depth 10
    Write-Host "quay-host => $json"
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

function Assert-Run([hashtable]$Payload, [string]$Name) {
    $run = Invoke-Host $Payload
    if (-not $run.ok) {
        throw "$Name start failed: $($run.error)"
    }
    if ($run.container.status -notmatch "running") {
        throw "$Name was created but status is '$($run.container.status)'"
    }
    return $run
}

function Wait-Http([string]$Url, [scriptblock]$Validate, [int]$TimeoutSeconds = 60) {
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
    $lastError = $null
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
            if (& $Validate $response) {
                return $response
            }
            $lastError = "Unexpected response: HTTP $($response.StatusCode) $($response.Content)"
        } catch {
            $lastError = $_.Exception.Message
        }
        Start-Sleep -Milliseconds 500
    }
    throw "Timed out waiting for $Url. Last error: $lastError"
}

function Remove-Container([string]$Name) {
    try {
        $rm = Invoke-Host @{ cmd = "rm"; id = $Name }
        if (-not $rm.ok) { Write-Warning "Cleanup $Name failed: $($rm.error)" }
    } catch {
        Write-Warning "Cleanup $Name failed: $($_.Exception.Message)"
    }
}

try {
    $health = Invoke-Host @{ cmd = "health" }
    if (-not $health.ok) {
        throw "Quay.Host health failed: $($health.error)"
    }

    # 1) Real nginx smoke test: not just state, prove host->container networking works.
    Assert-Run @{
        cmd = "run"
        image = "docker.io/library/nginx:latest"
        name = "quay-nginx-smoke"
        command = "/usr/sbin/nginx -g 'daemon off;'"
        ports = "18080:80"
        env = ""
        mounts = ""
        gpu = $false
        remove = $false
        workdir = "/"
    } "nginx" | Out-Null

    $nginx = Wait-Http "http://127.0.0.1:18080/" { param($r) $r.StatusCode -eq 200 -and $r.Content -match "Welcome to nginx" }
    Write-Host "nginx smoke passed: HTTP $($nginx.StatusCode), default page returned."
    Remove-Container "quay-nginx-smoke"

    # 2) Start the real local-coding MCP image with the same SDK init command Quay uses.
    Assert-Run @{
        cmd = "run"
        image = "ghcr.io/dhhieu113pro/local-coding-mcp:latest"
        name = "local-coding-mcp"
        command = "/usr/bin/dotnet /app/LocalCodingMcp.dll"
        ports = "15000:5000"
        env = "ASPNETCORE_URLS=http://0.0.0.0:5000`nASPNETCORE_ENVIRONMENT=Production`nAllowedRoots__0=/workspace`nCommandTimeoutSeconds=60"
        mounts = "$workspacePath`:/workspace:rw"
        gpu = $false
        remove = $false
        workdir = "/app"
    } "local-coding-mcp" | Out-Null

    $mcp = Wait-Http "http://127.0.0.1:15000/health" { param($r) $r.StatusCode -eq 200 } 90
    Write-Host "local-coding-mcp smoke passed: /health returned HTTP $($mcp.StatusCode)."

    # 3) Complete the real Group with ngrok. Quay.Host resolves local-coding-mcp
    # in this command to the managed container's bridge IP, matching production behavior.
    Assert-Run @{
        cmd = "run"
        image = "ngrok/ngrok:latest"
        name = "local-coding-mcp-ngrok"
        command = "ngrok http local-coding-mcp:5000 --log=stdout"
        ports = "14040:4040"
        env = "NGROK_AUTHTOKEN=$NgrokAuthtoken"
        mounts = ""
        gpu = $false
        remove = $false
        workdir = "/"
    } "local-coding-mcp-ngrok" | Out-Null

    $ngrokApi = Wait-Http "http://127.0.0.1:14040/api/tunnels" {
        param($r)
        if ($r.StatusCode -ne 200) { return $false }
        try {
            $body = $r.Content | ConvertFrom-Json
            return @($body.tunnels).Count -gt 0
        } catch {
            return $false
        }
    } 90

    $tunnels = ($ngrokApi.Content | ConvertFrom-Json).tunnels
    Write-Host "ngrok smoke passed: $(@($tunnels).Count) tunnel(s) active."

    $ps = Invoke-Host @{ cmd = "ps" }
    if (-not $ps.ok) { throw "Quay.Host ps failed: $($ps.error)" }
    $runningNames = @($ps.containers | Where-Object { $_.status -match "running" } | ForEach-Object { $_.name })
    foreach ($expected in @("local-coding-mcp", "local-coding-mcp-ngrok")) {
        if ($runningNames -notcontains $expected) {
            throw "Full local-coding Group check failed: $expected is not running. Running: $($runningNames -join ', ')"
        }
    }

    Write-Host "Full local-coding Group smoke test passed: MCP healthy and ngrok tunnel active."
}
finally {
    Remove-Container "local-coding-mcp-ngrok"
    Remove-Container "local-coding-mcp"
    Remove-Container "quay-nginx-smoke"

    try { $process.StandardInput.Close() } catch {}
    if (-not $process.WaitForExit(15000)) {
        try { $process.Kill($true) } catch {}
    }
    $process.Dispose()

    foreach ($path in @($dataPath, $workspacePath)) {
        try {
            if (Test-Path $path) { Remove-Item $path -Recurse -Force }
        } catch {
            Write-Warning "Could not remove smoke data immediately: $path - $($_.Exception.Message)"
        }
    }
}
