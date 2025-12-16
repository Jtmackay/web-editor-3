## Goals
- Prevent remote pages from silently reverting days later.
- Capture every change with a per‑file version history and human‑readable changelog.
- Detect and alert (or auto‑restore) when the server overwrites files.
- Make rollbacks and audits easy from the editor UI.

## Likely Causes
- Nightly server job (cPanel, vendor CMS, rsync) restoring an upstream copy.
- Another tool or person uploading older files.
- Static site generator re‑publishing from a source of truth that isn’t this editor.

## Core Design
- **Authoritative record**: Treat the editor as the system of record for edited files; every successful publish creates a version.
- **Drift detection**: Periodic checks compare the latest published version with the current remote content and mark external diffs.
- **Policy**: Configurable response per file — alert‑only, or auto‑restore to last good version.

## Database Changes
- **New table: `file_versions`**
  - `id`, `ftp_connection_id`, `file_path`, `user_id`, `content` (TEXT), `content_hash` (MD5/SHA256), `action` ('publish'|'revert'|'external_change'), `parent_version_id` (nullable), `created_at`.
- **Extend existing `file_history`** as lightweight event log
  - Keep as-is; populate on every publish, drift, and revert with `changes_summary`.
- Optional: **`site_snapshots`** for whole‑site sync runs with `root_path`, `snapshot_dir`, `created_at`.

## Publish Flow Integration
- **Renderer hook**: After each successful upload, compute content hash and write version + history.
  - Integration points:
    - `electron/services/ftpService.cjs:185` (upload path handling)
    - `electron/main.cjs:177` (IPC `ftp-upload-file` handler)
    - `src/components/EditorArea.tsx:1270` (renderer calls `ftpUploadFile` after `localSaveFile`)
  - Add a new IPC `publish-file` that: uploads → records `file_versions` → appends `file_history` with a summary.
- **Changelog summary**: Prompt for a short message on Save & Sync; store in `file_history.changes_summary`.

## Drift Detection
- **Watcher scope**: Monitor only files with recent versions (e.g., last 30 days) or files marked "protected".
- **Check method**:
  - Download remote file via FTP, compute hash, compare with latest `file_versions.content_hash`.
  - If different and not created by this editor recently, mark as `external_change` in `file_versions` + `file_history`.
- **Response policy per file**:
  - Alert‑only: show badge and notification; offer one‑click restore.
  - Auto‑restore: immediately re‑upload the last published content and log a `revert`.
- **Placement**: Background timer in Electron main process; configurable interval (e.g., hourly) and quiet hours.

## Versioning & Restore
- **Per‑file history UI**: List versions with author, timestamp, action, summary.
- **Diffs**:
  - Text/HTML/CSS: Monaco diff view comparing `content` against remote or between versions.
  - Binary (images): show metadata and thumbnail; no textual diff.
- **Restore**: One‑click "Restore to this version" → uploads stored `content` to FTP and records a new `revert` version.

## Editor UI Additions
- **History panel**: New right‑side panel or tab showing version timeline and diffs.
- **Save & Sync dialog**: Optional summary field; toggle "Protect this file" (enables drift watchdog and auto‑restore).
- **Status badges**: In `FTPExplorer` list, show indicators: "Protected", "Drift detected", "Clean".
- **Global changes log**: New panel aggregating `file_history` across files with filters.

## Use Existing Capabilities
- **Snapshots**: Reuse `ftpSyncToLocal` to create timestamped site snapshots after major publish events (electron/services/ftpService.cjs:250). Link snapshots in history.
- **Active files**: Reuse `active_files` table for locks and presence; set `is_locked` on protected files as a visual hint.

## Operational Guardrails
- Add a **server note**: Identify and, if possible, disable or reroute any nightly job that overwrites `/www`.
- If upstream source must remain authoritative, **reverse the flow**: push edits back to upstream repo/CMS and let the normal pipeline publish them.

## Implementation Steps
1. Create `file_versions` table and minimal DAO methods in `DatabaseService`.
2. Add IPC `publish-file` that wraps upload + version/history writes.
3. Update renderer save flow to call `publish-file` (keep `localSaveFile` for sync folder).
4. Build History panel UI with version list + Monaco diff.
5. Implement drift watcher in Electron main; add settings for interval and policy.
6. Add per‑file "Protect" toggle and badges in `FTPExplorer`.
7. Hook `ftpSyncToLocal` after major publishes to record `site_snapshots` (optional).

## Verification
- Unit test version writes and hash computation.
- Simulate external overwrite and confirm alert/auto‑restore.
- Validate large/binary file handling and performance on big directories.

## Rollout and Migration
- Migrate without downtime: new tables are additive.
- Start with alert‑only drift mode; monitor for a week before enabling auto‑restore on critical pages.
- Document policies in the repo and in the app Settings.

## Key Code Reference Anchors
- Upload: `electron/services/ftpService.cjs:185` and `electron/main.cjs:177`.
- Save flow: `src/components/EditorArea.tsx:1269`–`1276`.
- History tables: `electron/services/databaseService.cjs:54`–`63` (existing); add `file_versions` DAO beside these.
