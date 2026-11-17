# Project memory

## Product intent & audience

- Warehouse-management application for managing warehouse operations across multiple terminals/PCs.
- Desktop version built for Windows; web version runs through its own central Express server.
- Audience: warehouse staff using terminal workstations; admin manages users/roles.

## Brand personality & voice

- Professional, utilitarian, operations-focused (inferred from warehouse-management domain).

## Visual design & UX direction

- Login page is the entry point; authentication uses Employee ID + PIN (not username/password).
- Health-check UI reports database status and seeded admin info.

## Decisions, constraints & rationale

- Stack: Vite + React frontend; Express + SQLite backend bundled in-app.
- Architecture: built-in central server with real-time sync between terminals; multi-PC sync only works when running through the app's own server, not Bolt preview.
- Data storage: defaults to project folder (ephemeral on rebuild/redeploy); supports configurable external data directory (e.g., `C:\JuweiData` on Windows). Windows desktop build handles this automatically.
- Default seeded Super Admin: Employee ID `JPMP-002`, PIN `0423`.
- Type checking and production build pass cleanly; app verified running with healthy DB.

## Open questions & assumptions

- User reported "fix and run" but no specific error was identified; root cause of any prior breakage unknown.
- Whether user intends to keep real warehouse data (determines need for external storage configuration).
- Full feature scope beyond login, health check, and sync not yet explored.