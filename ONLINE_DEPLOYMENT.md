# JUWEI WMS Real-Time Multi-PC Cloud Deployment Guide

## Architecture Overview

```
                      INTERNET (HTTPS / WSS)
                                │
        ┌───────────────────────┴───────────────────────┐
        │                                               │
   PC #1 Desktop EXE                               PC #2 Desktop EXE
   (or Mobile Scanner)                            (or Tablet / PC #3)
        │                                               │
        └──────────────► CLOUD SERVER ◄─────────────────┘
                         (Node / Express / WSS)
```

## Quick Start Configuration

1. **Server Address**: The system defaults to the warehouse local server host (`192.168.20.214:3000`), operating in standalone mode and never requiring a Gmail account login.
2. **Installed Desktop App**: When installed on any PC, the desktop app automatically connects via WebSockets (`ws://`) and HTTP REST sync to the local warehouse server.
3. **Cross-PC Sync Verification**:
   - Stock update on PC #1 (e.g. 1,500 → 1,400) immediately broadcasts to PC #2, PC #3, and mobile devices in real time without refreshing.
