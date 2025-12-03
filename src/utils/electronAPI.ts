// Type definitions for the electron API
declare global {
  interface Window {
    electronAPI: {
      // FTP operations
      ftpConnect: (config: any) => Promise<{ success: boolean; error?: string }>
      ftpDisconnect: () => Promise<{ success: boolean; error?: string }>
      ftpListFiles: (path: string) => Promise<{ success: boolean; files?: any[]; error?: string }>
      ftpListAll: (path: string) => Promise<{ success: boolean; tree?: any[]; error?: string }>
      ftpDownloadFile: (remotePath: string, localPath: string) => Promise<{ success: boolean; content?: string; error?: string }>
      ftpUploadFile: (localPath: string, remotePath: string) => Promise<{ success: boolean; error?: string }>
      ftpSyncToLocal: (remoteRoot: string, localRoot: string, ignorePatterns: string[]) => Promise<{ success: boolean; error?: string }>

      // File cache operations
      fileCacheGet: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>
      fileCacheSet: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>
      fileCacheClear: (filePath: string) => Promise<{ success: boolean; error?: string }>

      // Database operations
      dbGetUsers: () => Promise<{ success: boolean; users?: any[]; error?: string }>
      dbUpdateUserStatus: (userId: string, status: string) => Promise<{ success: boolean; error?: string }>
      dbGetActiveFiles: () => Promise<{ success: boolean; files?: any[]; error?: string }>
      dbSetActiveFile: (userId: string, filePath: string) => Promise<{ success: boolean; error?: string }>
      dbRemoveActiveFile: (userId: string, filePath: string) => Promise<{ success: boolean; error?: string }>
      dbGetOrCreateDefaultUser: () => Promise<{ success: boolean; user?: any; error?: string }>
      dbGetFTPConnections: (userId: number) => Promise<{ success: boolean; connections?: any[]; error?: string }>
      dbAddFTPConnection: (payload: { userId: number; name: string; host: string; port: number; username: string; password: string; defaultPath: string }) => Promise<{ success: boolean; connection?: any; error?: string }>
      dbRemoveFTPConnection: (payload: { connectionId: number; userId: number }) => Promise<{ success: boolean; removed?: any; error?: string }>
      dbGetFTPPassword: (connectionId: number) => Promise<{ success: boolean; password?: string; error?: string }>
      settingsGetFTPConnections: () => Promise<{ success: boolean; connections?: any[]; error?: string }>
      settingsAddFTPConnection: (conn: { name: string; host: string; port: number; username: string; password: string; defaultPath: string; appendedUrl?: string }) => Promise<{ success: boolean; connection?: any; error?: string }>
      settingsRemoveFTPConnection: (id: number | string) => Promise<{ success: boolean; removed?: any; error?: string }>
      settingsGetFTPPassword: (id: number | string) => Promise<{ success: boolean; password?: string; error?: string }>
      settingsGetSyncIgnore: () => Promise<{ success: boolean; patterns?: string[]; error?: string }>
      settingsSetSyncIgnore: (patterns: string[]) => Promise<{ success: boolean; patterns?: string[]; error?: string }>
      settingsGetSyncFolder: () => Promise<{ success: boolean; path?: string; error?: string }>
      settingsSetSyncFolder: (path: string) => Promise<{ success: boolean; error?: string }>
      settingsChooseSyncFolder?: () => Promise<{ success: boolean; path?: string; error?: string }>
      openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>

      localSaveFile: (remotePath: string, content: string) => Promise<{ success: boolean; path?: string; error?: string }>

      projectSearch: (payload: { query: string; useRegex: boolean; caseSensitive: boolean }) => Promise<{
        success: boolean
        root?: string
        files?: {
          path: string
          relativePath?: string
          name: string
          matches: {
            line: number
            column: number
            matchText: string
            lineText: string
          }[]
        }[]
        error?: string
      }>

      // Menu event listeners
      onMenuEvent: (callback: (event: any, action: string) => void) => () => void
      onSyncProgress?: (callback: (event: any, payload: { count: number }) => void) => () => void
    }
  }
}

// Export a wrapper for easier usage
export const electronAPI = {
  ftpConnect: (config: any) => (window.electronAPI && typeof window.electronAPI.ftpConnect === 'function') ? window.electronAPI.ftpConnect(config) : Promise.resolve({ success: false, error: 'Electron API not available' }),
  ftpDisconnect: () => (window.electronAPI && typeof window.electronAPI.ftpDisconnect === 'function') ? window.electronAPI.ftpDisconnect() : Promise.resolve({ success: false, error: 'Electron API not available' }),
  ftpListFiles: (path: string) => (window.electronAPI && typeof window.electronAPI.ftpListFiles === 'function') ? window.electronAPI.ftpListFiles(path) : Promise.resolve({ success: false, error: 'Electron API not available' }),
  ftpListAll: (path: string) => (window.electronAPI && typeof window.electronAPI.ftpListAll === 'function') ? window.electronAPI.ftpListAll(path) : Promise.resolve({ success: false, error: 'Electron API not available' }),
  ftpDownloadFile: (remotePath: string, localPath: string) => (window.electronAPI && typeof window.electronAPI.ftpDownloadFile === 'function') ? window.electronAPI.ftpDownloadFile(remotePath, localPath) : Promise.resolve({ success: false, error: 'Electron API not available' }),
  ftpUploadFile: (localPath: string, remotePath: string) => (window.electronAPI && typeof window.electronAPI.ftpUploadFile === 'function') ? window.electronAPI.ftpUploadFile(localPath, remotePath) : Promise.resolve({ success: false, error: 'Electron API not available' }),
  ftpSyncToLocal: (remoteRoot: string, localRoot: string, ignorePatterns: string[]) =>
    (window.electronAPI && typeof window.electronAPI.ftpSyncToLocal === 'function')
      ? window.electronAPI.ftpSyncToLocal(remoteRoot, localRoot, ignorePatterns)
      : Promise.resolve({ success: false, error: 'Electron API not available' }),
  
  fileCacheGet: (filePath: string) => window.electronAPI?.fileCacheGet(filePath) || Promise.resolve({ success: false, error: 'Electron API not available' }),
  fileCacheSet: (filePath: string, content: string) => window.electronAPI?.fileCacheSet(filePath, content) || Promise.resolve({ success: false, error: 'Electron API not available' }),
  fileCacheClear: (filePath: string) => window.electronAPI?.fileCacheClear(filePath) || Promise.resolve({ success: false, error: 'Electron API not available' }),
  
  dbGetUsers: () => window.electronAPI?.dbGetUsers() || Promise.resolve({ success: false, error: 'Electron API not available' }),
  dbUpdateUserStatus: (userId: string, status: string) => window.electronAPI?.dbUpdateUserStatus(userId, status) || Promise.resolve({ success: false, error: 'Electron API not available' }),
  dbGetActiveFiles: () => window.electronAPI?.dbGetActiveFiles() || Promise.resolve({ success: false, error: 'Electron API not available' }),
  dbSetActiveFile: (userId: string, filePath: string) => window.electronAPI?.dbSetActiveFile(userId, filePath) || Promise.resolve({ success: false, error: 'Electron API not available' }),
  dbRemoveActiveFile: (userId: string, filePath: string) => window.electronAPI?.dbRemoveActiveFile(userId, filePath) || Promise.resolve({ success: false, error: 'Electron API not available' }),
  dbGetOrCreateDefaultUser: () => window.electronAPI?.dbGetOrCreateDefaultUser() || Promise.resolve({ success: false, error: 'Electron API not available' }),
  dbGetFTPConnections: (userId: number) => window.electronAPI?.dbGetFTPConnections(userId) || Promise.resolve({ success: false, error: 'Electron API not available' }),
  dbAddFTPConnection: (payload: { userId: number; name: string; host: string; port: number; username: string; password: string; defaultPath: string }) => window.electronAPI?.dbAddFTPConnection(payload) || Promise.resolve({ success: false, error: 'Electron API not available' }),
  dbRemoveFTPConnection: (payload: { connectionId: number; userId: number }) => window.electronAPI?.dbRemoveFTPConnection(payload) || Promise.resolve({ success: false, error: 'Electron API not available' }),
  dbGetFTPPassword: (connectionId: number) => window.electronAPI?.dbGetFTPPassword(connectionId) || Promise.resolve({ success: false, error: 'Electron API not available' }),
  settingsGetFTPConnections: () => window.electronAPI?.settingsGetFTPConnections() || Promise.resolve({ success: false, error: 'Electron API not available' }),
  settingsAddFTPConnection: (conn: { name: string; host: string; port: number; username: string; password: string; defaultPath: string; appendedUrl?: string }) => window.electronAPI?.settingsAddFTPConnection(conn) || Promise.resolve({ success: false, error: 'Electron API not available' }),
  settingsRemoveFTPConnection: (id: number | string) => window.electronAPI?.settingsRemoveFTPConnection(id) || Promise.resolve({ success: false, error: 'Electron API not available' }),
  settingsGetFTPPassword: (id: number | string) => window.electronAPI?.settingsGetFTPPassword(id) || Promise.resolve({ success: false, error: 'Electron API not available' }),
  settingsGetSyncIgnore: (): Promise<{ success: boolean; patterns?: string[]; error?: string }> =>
    (window.electronAPI && typeof window.electronAPI.settingsGetSyncIgnore === 'function')
      ? window.electronAPI.settingsGetSyncIgnore()
      : Promise.resolve<{ success: boolean; patterns?: string[]; error?: string }>({ success: true, patterns: [] }),
  settingsSetSyncIgnore: (patterns: string[]): Promise<{ success: boolean; patterns?: string[]; error?: string }> =>
    (window.electronAPI && typeof window.electronAPI.settingsSetSyncIgnore === 'function')
      ? window.electronAPI.settingsSetSyncIgnore(patterns)
      : Promise.resolve<{ success: boolean; patterns?: string[]; error?: string }>({
          success: false,
          error: 'Electron API not available'
        }),
  settingsGetSyncFolder: (): Promise<{ success: boolean; path?: string; error?: string }> =>
    (window.electronAPI && typeof window.electronAPI.settingsGetSyncFolder === 'function')
      ? window.electronAPI.settingsGetSyncFolder()
      : Promise.resolve<{ success: boolean; path?: string; error?: string }>({ success: true }),
  settingsSetSyncFolder: (path: string): Promise<{ success: boolean; error?: string }> =>
    (window.electronAPI && typeof window.electronAPI.settingsSetSyncFolder === 'function')
      ? window.electronAPI.settingsSetSyncFolder(path)
      : Promise.resolve<{ success: boolean; error?: string }>({
          success: false,
          error: 'Electron API not available'
        }),
  settingsChooseSyncFolder: (): Promise<{ success: boolean; path?: string; error?: string }> =>
    (window.electronAPI && typeof window.electronAPI.settingsChooseSyncFolder === 'function')
      ? window.electronAPI.settingsChooseSyncFolder()
      : Promise.resolve<{ success: boolean; path?: string; error?: string }>({
          success: false,
          error: 'Folder picker not available'
        }),
  openExternalUrl: (url: string) => window.electronAPI?.openExternalUrl(url) || Promise.resolve({ success: false, error: 'Electron API not available' }),
  localSaveFile: (remotePath: string, content: string) =>
    window.electronAPI?.localSaveFile(remotePath, content) ||
    Promise.resolve({ success: false, error: 'Electron API not available' }),
  projectSearch: (payload: { query: string; useRegex: boolean; caseSensitive: boolean }) =>
    window.electronAPI?.projectSearch(payload) || Promise.resolve({ success: false, error: 'Electron API not available' }),
  
  onMenuEvent: (callback: (event: any, action: string) => void) => {
    if (window.electronAPI?.onMenuEvent) {
      return window.electronAPI.onMenuEvent(callback)
    }
    return () => {}
  },

  onSyncProgress: (callback: (event: any, payload: { count: number }) => void) => {
    if (window.electronAPI?.onSyncProgress) {
      return window.electronAPI.onSyncProgress(callback)
    }
    return () => {}
  }
}
