const { contextBridge, ipcRenderer } = require('electron')

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // FTP operations
  ftpConnect: (config) => ipcRenderer.invoke('ftp-connect', config),
  ftpDisconnect: () => ipcRenderer.invoke('ftp-disconnect'),
  ftpListFiles: (path) => ipcRenderer.invoke('ftp-list-files', path),
  ftpListAll: (path) => ipcRenderer.invoke('ftp-list-all', path),
  ftpDownloadFile: (remotePath, localPath) => ipcRenderer.invoke('ftp-download-file', remotePath, localPath),
  ftpUploadFile: (localPath, remotePath) => ipcRenderer.invoke('ftp-upload-file', localPath, remotePath),

  // File cache operations
  fileCacheGet: (filePath) => ipcRenderer.invoke('file-cache-get', filePath),
  fileCacheSet: (filePath, content) => ipcRenderer.invoke('file-cache-set', filePath, content),
  fileCacheClear: (filePath) => ipcRenderer.invoke('file-cache-clear', filePath),

  // Database operations
  dbGetUsers: () => ipcRenderer.invoke('db-get-users'),
  dbUpdateUserStatus: (userId, status) => ipcRenderer.invoke('db-update-user-status', userId, status),
  dbGetActiveFiles: () => ipcRenderer.invoke('db-get-active-files'),
  dbSetActiveFile: (userId, filePath, fileHash) =>
    ipcRenderer.invoke('db-set-active-file', userId, filePath, fileHash ?? null),
  dbRemoveActiveFile: (userId, filePath) => ipcRenderer.invoke('db-remove-active-file', userId, filePath),
  dbGetOrCreateDefaultUser: () => ipcRenderer.invoke('db-get-or-create-default-user'),

  // Database settings
  settingsGetDbConfig: () => ipcRenderer.invoke('settings-get-db-config'),
  settingsSetDbConfig: (config) => ipcRenderer.invoke('settings-set-db-config', config),

  // DevTools helpers
  inspectElementAt: (x, y) => ipcRenderer.invoke('inspect-element-at', { x, y }),

  // Menu event listeners
  onMenuEvent: (callback) => {
    const events = [
      'menu-new-file',
      'menu-open-file',
      'menu-save-file',
      'menu-save-all',
      'menu-ftp-connect',
      'menu-ftp-disconnect',
      'menu-ftp-upload',
      'menu-ftp-download'
    ]
    
    events.forEach(event => {
      ipcRenderer.on(event, callback)
    })

    return () => {
      events.forEach(event => {
        ipcRenderer.removeListener(event, callback)
      })
    }
  }
})
