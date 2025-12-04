const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  ftpConnect: (config) => ipcRenderer.invoke('ftp-connect', config),
  ftpDisconnect: () => ipcRenderer.invoke('ftp-disconnect'),
  ftpListFiles: (path) => ipcRenderer.invoke('ftp-list-files', path),
  ftpListAll: (path) => ipcRenderer.invoke('ftp-list-all', path),
  ftpDownloadFile: (remotePath, localPath) => ipcRenderer.invoke('ftp-download-file', remotePath, localPath),
  ftpUploadFile: (localPath, remotePath) => ipcRenderer.invoke('ftp-upload-file', localPath, remotePath),
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
  dbGetFTPConnections: (userId) => ipcRenderer.invoke('db-get-ftp-connections', userId),
  dbAddFTPConnection: (payload) => ipcRenderer.invoke('db-add-ftp-connection', payload),
  dbRemoveFTPConnection: (payload) => ipcRenderer.invoke('db-remove-ftp-connection', payload),
  dbGetFTPPassword: (connectionId) => ipcRenderer.invoke('db-get-ftp-password', connectionId),
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

  projectSearch: (payload) => ipcRenderer.invoke('project-search', payload),

  localSaveFile: (remotePath, content) => ipcRenderer.invoke('local-save-file', remotePath, content),

  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),

  settingsGetDbConfig: () => ipcRenderer.invoke('settings-get-db-config'),
  settingsSetDbConfig: (config) => ipcRenderer.invoke('settings-set-db-config', config),

  onMenuEvent: (callback) => {
    const events = [
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
      'menu-ftp-download',
      'menu-go-to-page'
    ]
    events.forEach(event => { ipcRenderer.on(event, (e, ...args) => callback(e, event, ...args)) })
    return () => { events.forEach(event => { ipcRenderer.removeListener(event, (e, ...args) => callback(e, event, ...args)) }) }
  },

  onSyncProgress: (callback) => {
    const handler = (event, payload) => callback(event, payload)
    ipcRenderer.on('ftp-sync-progress', handler)
    return () => {
      ipcRenderer.removeListener('ftp-sync-progress', handler)
    }
  }
})
