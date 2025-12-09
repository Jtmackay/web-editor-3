## Overview

This project is a desktop web editor (Electron + React) with optional shared
collaborative features backed by PostgreSQL.

Editors can see who else is working on the same file and get a soft warning
before overwriting someone else's changes when saving to the server.

## Database configuration (local vs shared)

The Electron main process uses PostgreSQL via the `pg` driver. It chooses its
connection settings in this order:

1. **Environment variable (recommended for Neon/hosted Postgres)**
   - If `DATABASE_URL` or `NEON_DATABASE_URL` is set in the environment, the
     app will connect using that connection string.
   - SSL is enabled automatically for this mode.
   - Example connection string (from Neon.tech or other provider):
     `postgres://user:password@host:port/database`

2. **Local per-machine config (fallback)**
   - If no env var is set, the app falls back to a per-machine config stored by
     `electron-store` with defaults:
     - `host: localhost`
     - `port: 5432`
     - `database: vscode_editor`
     - `user: postgres`
     - `password: postgres`
   - You can override these values through the Electron settings store or by
     passing an explicit config object into `DatabaseService.initialize` from
     custom code.

### Using a shared Neon Postgres instance

To share presence/locking between 3–5 editors using Neon:

1. In Neon, create a project and database (with Neon Auth **disabled**, if you
   only need database-level auth).
2. Copy the **connection string** for Node/Postgres from the Neon dashboard.
3. On each editor's machine, set an environment variable before launching the app:
   - On Windows PowerShell (example):
     ```powershell
     $env:DATABASE_URL = "postgres://user:password@host:port/database"
     npm run electron:dev
     ```
4. Start the app as usual (`npm run electron:dev` in development, or your
   packaged app in production). All running editors that share the same
   `DATABASE_URL` will see each other's presence and soft-locking information.

### Using a local Postgres instance

If you prefer a purely local setup per machine:

1. Install PostgreSQL locally.
2. Ensure a database and user exist that match the defaults (or update the
   stored config via your own tooling).
3. Do **not** set `DATABASE_URL` / `NEON_DATABASE_URL`; the app will use the
   local settings instead.





