<#
.SYNOPSIS
    JUWEI WMS Health Monitor Script (Checks http://localhost:3000/api/health)

.DESCRIPTION
    Calls http://localhost:3000/api/health. If the check fails or returns a non-200
    status code, appends a timestamped entry to scripts/health.log, keeps only the
    last 2,000 log lines, and displays a Windows notification.

.NOTES
    HOW TO SCHEDULE IN WINDOWS TASK SCHEDULER (EVERY 5 MINUTES):
    ------------------------------------------------------------
    Option A - Task Scheduler GUI (taskschd.msc):
      1. Open Task Scheduler -> Click "Create Task..."
      2. General tab:
         - Name: JUWEI WMS Health Monitor
         - Select "Run only when user is logged on" (required for desktop notifications)
      3. Triggers tab -> New...:
         - Begin the task: "On a schedule" -> Daily (or One time)
         - Check "Repeat task every: 5 minutes" for a duration of "Indefinitely"
         - Ensure "Enabled" is checked -> Click OK
      4. Actions tab -> New...:
         - Action: "Start a program"
         - Program/script: powershell.exe
         - Add arguments: -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\apps\juwei-wms\scripts\monitor-health.ps1"
         - Click OK -> Save the task

    Option B - PowerShell Command (Run as Administrator, adjust script path if needed):
      schtasks /Create /TN "JUWEI WMS Health Monitor" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"C:\apps\juwei-wms\scripts\monitor-health.ps1\"" /SC MINUTE /MO 5 /F

    EXACT COMMAND TO RUN MANUALLY:
    ------------------------------
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\monitor-health.ps1"

    (Optional continuous mode in a terminal every 5 minutes without Task Scheduler:)
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\monitor-health.ps1" -Continuous
#>

param(
    [string]$HealthUrl = "http://localhost:3000/api/health",
    [int]$TimeoutSeconds = 10,
    [int]$MaxLogLines = 2000,
    [switch]$Continuous
)

$ErrorActionPreference = "Stop"

$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$LogFile = Join-Path $ScriptDir "health.log"

function Write-HealthLog {
    param(
        [string]$Message
    )

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"
    $line = "[$timestamp] $Message"

    if (-not (Test-Path $LogFile)) {
        New-Item -ItemType File -Path $LogFile -Force | Out-Null
    }

    Add-Content -Path $LogFile -Value $line -Encoding UTF8

    # Keep only the last 2,000 log lines
    $lines = @(Get-Content -Path $LogFile -Encoding UTF8)
    if ($lines.Count -gt $MaxLogLines) {
        $lines | Select-Object -Last $MaxLogLines | Set-Content -Path $LogFile -Encoding UTF8
    }
}

function Show-WindowsNotification {
    param(
        [string]$Title,
        [string]$Body
    )

    # 1. Native Windows 10/11 Toast Notification via WinRT
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

        $escapedTitle = [System.Security.SecurityElement]::Escape($Title)
        $escapedBody = [System.Security.SecurityElement]::Escape($Body)

        $toastXmlString = @"
<toast>
  <visual>
    <binding template="ToastGeneric">
      <text>$escapedTitle</text>
      <text>$escapedBody</text>
    </binding>
  </visual>
</toast>
"@

        $xmlDoc = New-Object Windows.Data.Xml.Dom.XmlDocument
        $xmlDoc.LoadXml($toastXmlString)
        $toast = New-Object Windows.UI.Notifications.ToastNotification $xmlDoc
        $appId = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe"
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
        return
    } catch {
        # Fall back to System.Windows.Forms balloon notification below
    }

    # 2. Fallback: System Tray Balloon Tip
    try {
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $notify = New-Object System.Windows.Forms.NotifyIcon
        $notify.Icon = [System.Drawing.SystemIcons]::Error
        $notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Error
        $notify.BalloonTipTitle = $Title
        $notify.BalloonTipText = $Body
        $notify.Visible = $true
        $notify.ShowBalloonTip(10000)
        Start-Sleep -Seconds 2
        $notify.Dispose()
    } catch {
        Write-Warning "$Title - $Body"
    }
}

function Invoke-HealthCheck {
    try {
        $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec $TimeoutSeconds
        if ($response.StatusCode -ne 200) {
            throw "Unexpected HTTP status code: $($response.StatusCode)"
        }
        return $true
    } catch {
        $errMsg = $_.Exception.Message
        Write-HealthLog -Message "ERROR Health check failed for $HealthUrl - $errMsg"
        Show-WindowsNotification -Title "JUWEI WMS Server Alert" -Body "Health check failed ($HealthUrl): $errMsg"
        return $false
    }
}

if ($Continuous) {
    while ($true) {
        Invoke-HealthCheck | Out-Null
        Start-Sleep -Seconds 300
    }
} else {
    $ok = Invoke-HealthCheck
    if (-not $ok) {
        exit 1
    }
}
