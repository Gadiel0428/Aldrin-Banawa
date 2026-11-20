# JUWEI WMS Windows Server Deployment & Operations Guide

## 1. Architecture Overview

```
                    WAREHOUSE LAN / VPN (HTTP / WS)
                                │
        ┌───────────────────────┴───────────────────────┐
        │                                               │
   PC #1 Desktop EXE                               PC #2 Desktop EXE
   (or Mobile Scanner)                            (or Tablet / PC #3)
        │                                               │
        └──────────► WINDOWS CENTRAL SERVER ◄───────────┘
                   (Node.js + Express + WebSocket + SQLite)
                        http://192.168.20.214:3000
```

All workstations and mobile scanners connect over HTTP and WebSockets (`/ws`) to the Windows Server running `dist/server.cjs` with SQLite persistence stored outside the application source folder.

---

## 2. Initial Installation on Windows Server

### Prerequisites
- **Windows Server 2019 / 2022** (or Windows 10/11 Pro host)
- **Node.js 22 LTS** (x64)
- **Git for Windows**
- **NSSM (Non-Sucking Service Manager)** — extract `nssm.exe` (win64) to `C:\nssm\nssm.exe`

### Installation Steps
1. Create a persistent external data directory (never inside the app folder):
   ```powershell
   New-Item -ItemType Directory -Force -Path "C:\JuweiData\backups"
   ```
2. Clone the repository and build the server and frontend bundle:
   ```powershell
   mkdir C:\apps -Force
   cd C:\apps
   git clone <REPO_URL> juwei-wms
   cd C:\apps\juwei-wms
   npm install
   npm run build
   ```
3. Configure the central server address in `public\server-config.json` (and rebuild if changed):
   ```json
   {
     "name": "JUWEI WMS Central Warehouse Server",
     "centralServerUrl": "http://192.168.20.214:3000",
     "centralServerHost": "192.168.20.214:3000",
     "defaultAccount": "ACC-JUWEI",
     "defaultWarehouse": "WH-MAIN"
   }
   ```
4. Open TCP port `3000` in Windows Defender Firewall for the warehouse LAN:
   ```powershell
   New-NetFirewallRule -DisplayName "JUWEI WMS Server (Port 3000)" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
   ```
5. Do a one-time foreground smoke check to initialize the database and note the first-install random Super Admin (`JPMP-002`) PIN printed in the startup output (or shown on first screen):
   ```powershell
   $env:JUWEI_DATA_DIR = "C:\JuweiData"
   $env:PORT = "3000"
   $env:NODE_ENV = "production"
   node dist\server.cjs
   ```
   Press `Ctrl+C` once verified.

---

## 3. Running as a Windows Service (NSSM)

Register the server as an auto-starting Windows Service using NSSM:

```powershell
C:\nssm\nssm.exe install JUWEI-WMS "C:\Program Files\nodejs\node.exe" "C:\apps\juwei-wms\dist\server.cjs"
C:\nssm\nssm.exe set JUWEI-WMS AppDirectory "C:\apps\juwei-wms"
C:\nssm\nssm.exe set JUWEI-WMS DisplayName "JUWEI WMS Central Server"
C:\nssm\nssm.exe set JUWEI-WMS Description "JUWEI Warehouse Management System HTTP, WebSocket, and SQLite Server"
C:\nssm\nssm.exe set JUWEI-WMS Start SERVICE_AUTO_START

# Persistent storage & logging configuration
C:\nssm\nssm.exe set JUWEI-WMS AppEnvironmentExtra "NODE_ENV=production" "PORT=3000" "JUWEI_DATA_DIR=C:\JuweiData" "LOG_LEVEL=info"
C:\nssm\nssm.exe set JUWEI-WMS AppStdout "C:\JuweiData\logs\server-stdout.log"
C:\nssm\nssm.exe set JUWEI-WMS AppStderr "C:\JuweiData\logs\server-stderr.log"
C:\nssm\nssm.exe set JUWEI-WMS AppRotateFiles 1
C:\nssm\nssm.exe set JUWEI-WMS AppRotateOnline 1
C:\nssm\nssm.exe set JUWEI-WMS AppRotateBytes 10485760

# Restart automatically on unexpected exit
C:\nssm\nssm.exe set JUWEI-WMS AppExit Default Restart
C:\nssm\nssm.exe set JUWEI-WMS AppRestartDelay 5000
```

Create the log directory and start the service:
```powershell
New-Item -ItemType Directory -Force -Path "C:\JuweiData\logs"
C:\nssm\nssm.exe start JUWEI-WMS
C:\nssm\nssm.exe status JUWEI-WMS
```

---

## 4. Updating the Server

Whenever a new release is ready:

```powershell
cd C:\apps\juwei-wms
git pull
npm install
npm run build
C:\nssm\nssm.exe restart JUWEI-WMS
```

Because `JUWEI_DATA_DIR` points to `C:\JuweiData`, updating the code in `C:\apps\juwei-wms` never overwrites the live database or backups.

---

## 5. Backups & Recovery

- **Live Database**: `C:\JuweiData\central-database.sqlite`
- **Automatic Hourly & Pre-Startup Backups**: Created using SQLite `VACUUM INTO` inside `C:\JuweiData\backups\`.
- **In-App Backup / Restore**: Super Admins can trigger manual backups or restore snapshots from the **Server Backups** modal.
- **Off-Machine Backup (Recommended)**: Schedule a daily Windows Task Scheduler job or Robocopy script to copy `C:\JuweiData\backups\` to a separate NAS/network share:
  ```powershell
  robocopy "C:\JuweiData\backups" "\\BACKUP-NAS\juwei-wms-backups" *.sqlite /MAXAGE:30 /R:3 /W:5
  ```
- **Manual File Restore**:
  ```powershell
  C:\nssm\nssm.exe stop JUWEI-WMS
  Copy-Item "C:\JuweiData\backups\<backup-file>.sqlite" "C:\JuweiData\central-database.sqlite" -Force
  C:\nssm\nssm.exe start JUWEI-WMS
  ```

---

## 6. Uptime & Health Check

The server exposes a lightweight health endpoint at:

- **URL**: `http://192.168.20.214:3000/api/health` (or `http://127.0.0.1:3000/api/health` locally)

Verify from PowerShell:
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/health" -TimeoutSec 5
```

Expected response (`HTTP 200 OK`):
- JSON status payload containing server health, instance ID, database readiness, and active uptime.

For automated monitoring, configure Windows Task Scheduler (every 5 minutes) or your LAN monitoring tool to poll `http://192.168.20.214:3000/api/health` and alert if the HTTP status is not `200` or if `C:\nssm\nssm.exe status JUWEI-WMS` does not report `SERVICE_RUNNING`.
