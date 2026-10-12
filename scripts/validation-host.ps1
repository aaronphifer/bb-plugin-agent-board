param([ValidateSet('start', 'stop', 'install', 'status')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskWorkspace = Split-Path -Parent (Split-Path -Parent $taskRoot)
$taskTools = Join-Path $taskWorkspace 'work\bb-build-tools\node_modules\bb-app\dist'
$taskApp = Join-Path $taskTools 'bb-app.js'
$taskCli = Join-Path $taskTools 'bb.js'
$taskData = Join-Path $taskWorkspace 'work\bb-validation-windows-data'
$taskUrl = 'http://127.0.0.1:49986'
if (-not (Test-Path -LiteralPath $taskApp -PathType Leaf)) { throw 'Task-local BB 0.46.0 is missing; see docs/vnext-testing.md.' }
function Assert-ValidationHost {
    $taskRuntime = Get-Content -Raw -LiteralPath (Join-Path $taskData 'bb-app-runtime.json') | ConvertFrom-Json
    if ($taskRuntime.serverUrl -ne $taskUrl -or [IO.Path]::GetFullPath($taskRuntime.entryPath) -ne [IO.Path]::GetFullPath($taskApp)) { throw 'Validation host identity does not match.' }
    $taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($taskRuntime.pid)"
    if (-not $taskProcess -or -not $taskProcess.CommandLine.Contains($taskApp) -or -not $taskProcess.CommandLine.Contains($taskData)) { throw 'Validation launcher process does not match.' }
}
$taskPreviousData = $env:BB_DATA_DIR
$taskPreviousUrl = $env:BB_SERVER_URL
$taskPreviousTelemetry = $env:BB_TELEMETRY
Push-Location -LiteralPath $taskRoot
try {
    $env:BB_DATA_DIR = $taskData
    $env:BB_SERVER_URL = $taskUrl
    $env:BB_TELEMETRY = 'false'
    switch ($Action) {
        start { node $taskApp --data-dir $taskData --server-bind-host 127.0.0.1 --server-port 49986 --host-daemon-port 49987 --no-in-app-updates start }
        stop { Assert-ValidationHost; node $taskApp --data-dir $taskData stop }
        install {
            Assert-ValidationHost
            $taskHealth = Invoke-RestMethod -Uri "$taskUrl/api/health" -TimeoutSec 5
            node $taskCli plugin install $taskRoot --yes
        }
        status { Assert-ValidationHost; node $taskCli plugin list }
    }
    if ($LASTEXITCODE -ne 0) { throw "BB command failed ($LASTEXITCODE)." }
} finally {
    $env:BB_DATA_DIR = $taskPreviousData
    $env:BB_SERVER_URL = $taskPreviousUrl
    $env:BB_TELEMETRY = $taskPreviousTelemetry
    Pop-Location
}
