<#
.SYNOPSIS
    JUWEI WMS Offsite Backup Script

.DESCRIPTION
    Copies D:\juwei-data\backups to the destination folder defined by $OffsiteFolder
    (for example E:\JUWEI-Offsite) using robocopy with /MIR disabled so files in
    the source folder are never deleted. Logs every run to scripts/backup-offsite.log.

.NOTES
    HOW TO SCHEDULE IN WINDOWS TASK SCHEDULER:
    ------------------------------------------
    Option A - Task Scheduler GUI (taskschd.msc):
      1. Open Task Scheduler -> Click "Create Task..."
      2. General tab:
         - Name: JUWEI WMS Offsite Backup
         - Select "Run whether user is logged on or not"
         - Check "Run with highest privileges"
      3. Triggers tab -> New...:
         - Begin the task: "On a schedule"
         - Choose Daily (or desired backup interval, e.g. every day at 02:00 AM)
         - Ensure "Enabled" is checked -> Click OK
      4. Actions tab -> New...:
         - Action: "Start a program"
         - Program/script: powershell.exe
         - Add arguments: -NoProfile -ExecutionPolicy Bypass -File "C:\apps\juwei-wms\scripts\backup-offsite.ps1"
         - Click OK -> Save the task

    Option B - PowerShell Command (Run as Administrator, adjust schedule/path as needed):
      schtasks /Create /TN "JUWEI WMS Offsite Backup" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"C:\apps\juwei-wms\scripts\backup-offsite.ps1\"" /SC DAILY /ST 02:00 /RL HIGHEST /F

    EXACT COMMAND TO RUN MANUALLY:
    ------------------------------
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\backup-offsite.ps1"

    (Optional override destination folder from command line:)
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\backup-offsite.ps1" -OffsiteFolder "E:\JUWEI-Offsite"
#>

param(
    [string]$OffsiteFolder = "E:\JUWEI-Offsite"
)

$ErrorActionPreference = "Stop"

$SourceFolder = "D:\juwei-data\backups"
$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$LogFile = Join-Path $ScriptDir "backup-offsite.log"

function Write-BackupLog {
    param(
        [string]$Message
    )

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"
    $line = "[$timestamp] $Message"
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
    Write-Output $line
}

Write-BackupLog -Message "START Offsite backup | Source: $SourceFolder | Destination: $OffsiteFolder"

if (-not (Test-Path -Path $SourceFolder -PathType Container)) {
    Write-BackupLog -Message "ERROR Source folder does not exist: $SourceFolder"
    exit 1
}

if ([string]::IsNullOrWhiteSpace($OffsiteFolder)) {
    Write-BackupLog -Message "ERROR OffsiteFolder variable is empty."
    exit 1
}

try {
    if (-not (Test-Path -Path $OffsiteFolder -PathType Container)) {
        New-Item -ItemType Directory -Path $OffsiteFolder -Force | Out-Null
    }
} catch {
    Write-BackupLog -Message "ERROR Could not access or create destination folder '$OffsiteFolder': $($_.Exception.Message)"
    exit 1
}

# Copy-only flags (/E copies subdirectories including empty ones; /MIR and /PURGE are intentionally NOT used so source files are never deleted)
$robocopyArgs = @(
    $SourceFolder,
    $OffsiteFolder,
    "/E",
    "/Z",
    "/R:3",
    "/W:5",
    "/NP",
    "/LOG+:$LogFile",
    "/TEE"
)

& robocopy @robocopyArgs | Out-Null
$rc = $LASTEXITCODE

# Robocopy exit codes 0-7 indicate success (bits 0-2: copied/extra/mismatch); >= 8 indicates failure
if ($rc -lt 8) {
    Write-BackupLog -Message "SUCCESS Offsite backup completed cleanly (robocopy exit code: $rc)."
    exit 0
} else {
    Write-BackupLog -Message "ERROR Offsite backup failed (robocopy exit code: $rc)."
    exit $rc
}
