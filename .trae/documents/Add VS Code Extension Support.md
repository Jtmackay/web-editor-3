## Impact of Targeting “Trae AI”
- Trae AI appears in Open VSX (open-vsx.org/extension/trae/ai) and is designed for Code OSS-based IDEs, which strongly suggests it will run under OpenVSCode Server.
- That narrows the scope: we don’t need general Marketplace integration; we can focus on Open VSX and the node-based extension host that `openvscode-server` provides.
- Your existing Electron app and Monaco editor remain; the extension-enabled experience runs in an embedded OpenVSCode view pointing at the same workspace folder.

## Recommended Approach
- Use the embedded-server route: start `openvscode-server` locally and load its workbench in a `BrowserView`/iframe. This provides a full VS Code extension host and UI with minimal disruption.
- Keep Monaco (`src/components/MonacoEditor.tsx:2`) as the lightweight editor; add a “Open with Extensions” view that hosts the OpenVSCode workbench.

## Key Steps
1. Choose workspace path
- Reuse the Sync Folder already managed by Settings (electron/main.cjs:666) so both editors operate on the same files.

2. Launch `openvscode-server`
- On app start, spawn the server via `child_process` with `--host 127.0.0.1`, a fixed `--port` (or dynamic), and `--folder <syncFolder>`.
- Lock its listen scope to localhost; ensure lifecycle hooks stop the process on app quit (electron/main.cjs:1178).

3. Embed the workbench UI
- Add a view that loads `http://localhost:<port>/?folder=<syncFolder>` in a `BrowserView`.
- Provide a UI affordance to switch between “Editor” (Monaco) and “Extensions” (OpenVSCode).

4. Preinstall Trae AI
- Install Trae AI from Open VSX either via the workbench UI or programmatically: run server with `--install-extension trae.ai` on first launch.
- Verify extension activation and permissions; ensure outbound network access for AI calls.

5. File change flow
- Because the server edits the same workspace folder, changes appear in your app immediately (and your drift features continue to work). No extra sync layer is needed.

6. Security & policies
- Restrict server to `127.0.0.1` and prevent external exposure.
- Pin the extension source to Open VSX; optionally whitelist allowed extensions.

7. Packaging
- Bundle the server binary (or download on first run) and include launcher scripts in the Electron build (package.json: electron-builder).
- Provide a setting to set default editor mode and an “Install/Repair Trae AI” action.

## Timeline
- MVP (server launch, embedded view, Trae AI installed): 3–7 days.
- Production polish (error handling, settings, packaging, guardrails): 1–2 weeks.

## Notes & Compatibility
- Some Microsoft-only extensions don’t run on Code OSS; Trae AI being on Open VSX is a good sign for compatibility.
- Your app already sets `disable-web-security` for inspection (electron/main.cjs:14–18); the server remains sandboxed via localhost binding. 