<#
.SYNOPSIS
    JUWEI WMS Staging Server Launcher

.DESCRIPTION
    Starts a staging instance of JUWEI WMS on port 3001 using an isolated
    staging data directory (D:\juwei-data-staging) by setting PORT and
    JUWEI_DATA_DIR environment variables and executing node dist/server.cjs.

.NOTES
    EXACT COMMAND TO RUN MANUALLY:
    ------------------------------
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\start-staging.ps1"

    PREREQUISITE:
    -------------
      Run "npm run build" first so dist\server.cjs and the frontend bundle exist.
#>

$ErrorActionPreference = "Stop"

$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$ProjectRoot = Split-Path -Parent $ScriptDir
$ServerEntry = Join-Path $ProjectRoot "dist\server.cjs"

$env:PORT = "3001"
$env:JUWEI_DATA_DIR = "D:\juwei-data-staging"
if (-not $env:NODE_ENV) {
    $env:NODE_ENV = "production"
}

if (-not (Test-Path -Path $env:JUWEI_DATA_DIR -PathType Container)) {
    New-Item -ItemType Directory -Path $env:JUWEI_DATA_DIR -Force | Out-Null
}

if (-not (Test-Path -Path $ServerEntry -PathType Leaf)) {
    Write-Error "Build output not found at '$ServerEntry'. Run 'npm run build' first."
    exit 1
}

Write-Output "Starting JUWEI WMS Staging Server..."
Write-Output "  PORT           = $($env:PORT)"
Write-Output "  JUWEI_DATA_DIR = $($env:JUWEI_DATA_DIR)"
Write-Output "  NODE_ENV       = $($env:NODE_ENV)"

Push-Location $ProjectRoot
try {
    & node "dist/server.cjs"
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
