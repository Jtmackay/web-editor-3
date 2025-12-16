const { contextBridge, ipcRenderer } = require('electron')

// Central registry so we only ever attach ONE ipcRenderer listener per menu event.
const MENU_EVENTS = [
  'menu-new-file',
  'menu-open-file',
  'menu-save-file',
  'menu-save-and-sync',
  'menu-save-as',
  'menu-save-all',
  'menu-find',
  'menu-replace',
  'menu-ftp-connect',
  'menu-ftp-disconnect',
  'menu-ftp-upload',
  'menu-ftp-download'
]

// For each menu event, keep a Set of subscriber callbacks from the renderer.
const menuSubscribers = new Map()
// Track whether we've attached the single ipcRenderer handler for a given event.
const menuIpcHandlers = new Map()

function ensureMenuIpcHandler(event) {
  if (!menuIpcHandlers.has(event)) {
    const handler = (e, ...args) => {
      const subs = menuSubscribers.get(event)
      if (!subs || subs.size === 0) return
      // Call each subscriber with the same signature as before: (event, action, ...args)
      subs.forEach((cb) => {
        try {
          cb(e, event, ...args)
        } catch {
          // Swallow subscriber errors so one bad listener doesn't break the others.
        }
      })
    }
    menuIpcHandlers.set(event, handler)
    ipcRenderer.on(event, handler)
  }
}

contextBridge.exposeInMainWorld('electronAPI', {
  ftpConnect: (config) => ipcRenderer.invoke('ftp-connect', config),
  ftpDisconnect: () => ipcRenderer.invoke('ftp-disconnect'),
  ftpListFiles: (path) => ipcRenderer.invoke('ftp-list-files', path),
  ftpListFilesReadonly: (path) => ipcRenderer.invoke('ftp-list-files-readonly', path),
  ftpListAll: (path) => ipcRenderer.invoke('ftp-list-all', path),
  ftpDownloadFile: (remotePath, localPath) => ipcRenderer.invoke('ftp-download-file', remotePath, localPath),
  ftpUploadFile: (localPath, remotePath) => ipcRenderer.invoke('ftp-upload-file', localPath, remotePath),
  publishFile: (payload) => ipcRenderer.invoke('publish-file', payload),
  ftpCreateDirectory: (remotePath) => ipcRenderer.invoke('ftp-create-directory', remotePath),
  ftpSyncToLocal: (remoteRoot, localRoot, ignorePatterns) => ipcRenderer.invoke('ftp-sync-to-local', remoteRoot, localRoot, ignorePatterns),

  fileCacheGet: (filePath) => ipcRenderer.invoke('file-cache-get', filePath),
  fileCacheSet: (filePath, content) => ipcRenderer.invoke('file-cache-set', filePath, content),
  fileCacheClear: (filePath) => ipcRenderer.invoke('file-cache-clear', filePath),

  dbGetUsers: () => ipcRenderer.invoke('db-get-users'),
  dbUpdateUserStatus: (userId, status) => ipcRenderer.invoke('db-update-user-status', userId, status),
  dbGetActiveFiles: () => ipcRenderer.invoke('db-get-active-files'),
  dbSetActiveFile: (userId, filePath, fileHash) =>
    ipcRenderer.invoke('db-set-active-file', userId, filePath, fileHash ?? null),
  dbRemoveActiveFile: (userId, filePath) => ipcRenderer.invoke('db-remove-active-file', userId, filePath),
  dbGetOrCreateDefaultUser: () => ipcRenderer.invoke('db-get-or-create-default-user'),
  dbGetFileHistory: (filePath, limit) => ipcRenderer.invoke('db-get-file-history', { filePath, limit }),
  dbGetFileVersions: (filePath, limit) => ipcRenderer.invoke('db-get-file-versions', { filePath, limit }),
  dbRestoreFileVersion: (versionId) => ipcRenderer.invoke('db-restore-file-version', { versionId }),
  dbGetFTPConnections: (userId) => ipcRenderer.invoke('db-get-ftp-connections', userId),
  dbAddFTPConnection: (payload) => ipcRenderer.invoke('db-add-ftp-connection', payload),
  dbRemoveFTPConnection: (payload) => ipcRenderer.invoke('db-remove-ftp-connection', payload),
  dbGetFTPPassword: (connectionId) => ipcRenderer.invoke('db-get-ftp-password', connectionId),
  dbGetEditedFiles: (limit) => ipcRenderer.invoke('db-get-edited-files', limit),
  settingsGetFTPConnections: () => ipcRenderer.invoke('settings-get-ftp-connections'),
  settingsAddFTPConnection: (conn) => ipcRenderer.invoke('settings-add-ftp-connection', conn),
  settingsRemoveFTPConnection: (id) => ipcRenderer.invoke('settings-remove-ftp-connection', id),
  settingsGetFTPPassword: (id) => ipcRenderer.invoke('settings-get-ftp-password', id),
  settingsGetSyncIgnore: () => ipcRenderer.invoke('settings-get-sync-ignore'),
  settingsSetSyncIgnore: (patterns, hideInExplorer, hiddenPaths) => ipcRenderer.invoke('settings-set-sync-ignore', patterns, hideInExplorer, hiddenPaths),
  settingsGetSyncFolder: () => ipcRenderer.invoke('settings-get-sync-folder'),
  settingsSetSyncFolder: (path) => ipcRenderer.invoke('settings-set-sync-folder', path),
  settingsChooseSyncFolder: () => ipcRenderer.invoke('settings-choose-sync-folder'),
  settingsGetPreviewBaseUrl: () => ipcRenderer.invoke('settings-get-preview-base-url'),
  settingsSetPreviewBaseUrl: (baseUrl) => ipcRenderer.invoke('settings-set-preview-base-url', baseUrl),
  settingsGetPreviewStartAfter: () => ipcRenderer.invoke('settings-get-preview-start-after'),
  settingsSetPreviewStartAfter: (startAfter) => ipcRenderer.invoke('settings-set-preview-start-after', startAfter),
  settingsGetImagePickerStartPath: () => ipcRenderer.invoke('settings-get-image-picker-start-path'),
  settingsSetImagePickerStartPath: (path) => ipcRenderer.invoke('settings-set-image-picker-start-path', path),
  settingsGetDriftWatch: () => ipcRenderer.invoke('settings-get-drift-watch'),
  settingsSetDriftWatch: (cfg) => ipcRenderer.invoke('settings-set-drift-watch', cfg),

  settingsGetEditorName: () => ipcRenderer.invoke('settings-get-editor-name'),
  settingsSetEditorName: (name) => ipcRenderer.invoke('settings-set-editor-name', name),

  settingsGetEnablePreviewInspector: () => ipcRenderer.invoke('settings-get-enable-preview-inspector'),
  settingsSetEnablePreviewInspector: (enabled) => ipcRenderer.invoke('settings-set-enable-preview-inspector', enabled),

  projectSearch: (payload) => ipcRenderer.invoke('project-search', payload),

  localSaveFile: (remotePath, content) => ipcRenderer.invoke('local-save-file', remotePath, content),

  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),

  settingsGetDbConfig: () => ipcRenderer.invoke('settings-get-db-config'),
  settingsSetDbConfig: (config) => ipcRenderer.invoke('settings-set-db-config', config),

  onMenuEvent: (callback) => {
    // Lazily ensure ipcRenderer has ONE handler for each event, then just
    // register this callback in our own subscriber registry.
    MENU_EVENTS.forEach((event) => {
      if (!menuSubscribers.has(event)) {
        menuSubscribers.set(event, new Set())
      }
      ensureMenuIpcHandler(event)
      const subs = menuSubscribers.get(event)
      subs.add(callback)
    })

    // Return an unsubscribe function that removes this callback from all events.
    return () => {
      MENU_EVENTS.forEach((event) => {
        const subs = menuSubscribers.get(event)
        if (!subs) return
        subs.delete(callback)
      })
    }
  },

  onSyncProgress: (callback) => {
    const handler = (event, payload) => callback(event, payload)
    ipcRenderer.on('ftp-sync-progress', handler)
    return () => {
      ipcRenderer.removeListener('ftp-sync-progress', handler)
    }
  },
  onDriftDetected: (callback) => {
    const handler = (event, payload) => callback(event, payload)
    ipcRenderer.on('drift-detected', handler)
    return () => {
      ipcRenderer.removeListener('drift-detected', handler)
    }
  }
})
