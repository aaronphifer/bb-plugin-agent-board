$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskWorkspace = Split-Path -Parent (Split-Path -Parent $taskRoot)
$taskCli = Join-Path $taskWorkspace 'work\bb-build-tools\node_modules\bb-app\dist\bb.js'
$taskData = Join-Path $taskWorkspace 'work\bb-dev-data'
if (-not (Test-Path -LiteralPath $taskCli -PathType Leaf)) {
    throw 'Task-local BB build tool is missing. See docs/vnext-testing.md.'
}
$taskOldData = $env:BB_DATA_DIR
$taskOldUrl = $env:BB_SERVER_URL
$taskOldTelemetry = $env:BB_TELEMETRY
Push-Location -LiteralPath $taskRoot
try {
    $env:BB_DATA_DIR = $taskData
    $env:BB_SERVER_URL = 'http://127.0.0.1:49886'
    $env:BB_TELEMETRY = 'false'
    node $taskCli plugin build
    if ($LASTEXITCODE -ne 0) { throw "BB build failed ($LASTEXITCODE)." }
} finally {
    $env:BB_DATA_DIR = $taskOldData
    $env:BB_SERVER_URL = $taskOldUrl
    $env:BB_TELEMETRY = $taskOldTelemetry
    Pop-Location
}
