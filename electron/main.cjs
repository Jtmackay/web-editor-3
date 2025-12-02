const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require('electron')
const path = require('path')
const { FTPService } = require('./services/ftpService.cjs')
const { DatabaseService } = require('./services/databaseService.cjs')
const { FileCacheService } = require('./services/fileCacheService.cjs')
const { SettingsService } = require('./services/settingsService.cjs')

let mainWindow
let ftpService
let databaseService
let fileCacheService
let settingsService

const isDev = process.env.NODE_ENV === 'development'

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.cjs')
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false
  })

  if (isDev) {
    mainWindow.webContents.session.clearCache()
  }

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5180'
  mainWindow.loadURL(devUrl)
  mainWindow.webContents.once('did-fail-load', () => {
    const alt = devUrl === 'http://localhost:5180' ? 'http://localhost:5173' : 'http://localhost:5180'
    mainWindow.loadURL(alt)
    mainWindow.webContents.once('did-fail-load', () => {
      mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
    })
  })
  if (isDev) {
    mainWindow.webContents.openDevTools()
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New File', accelerator: 'CmdOrCtrl+N', click: () => mainWindow.webContents.send('menu-new-file') },
        { label: 'Open File', accelerator: 'CmdOrCtrl+O', click: () => mainWindow.webContents.send('menu-open-file') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => mainWindow.webContents.send('menu-save-file') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow.webContents.send('menu-save-as') },
        { label: 'Save All', accelerator: 'CmdOrCtrl+Alt+S', click: () => mainWindow.webContents.send('menu-save-all') },
        { type: 'separator' },
        { label: 'Exit', accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q', click: () => app.quit() }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectall' },
        { type: 'separator' },
        { label: 'Find', accelerator: 'CmdOrCtrl+F', click: () => mainWindow.webContents.send('menu-find') },
        { label: 'Replace', accelerator: 'CmdOrCtrl+H', click: () => mainWindow.webContents.send('menu-replace') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'Go To Page', click: () => mainWindow.webContents.send('menu-go-to-page') }
      ]
    },
    {
      label: 'FTP',
      submenu: [
        { label: 'Connect to FTP', click: () => mainWindow.webContents.send('menu-ftp-connect') },
        { label: 'Disconnect', click: () => mainWindow.webContents.send('menu-ftp-disconnect') },
        { type: 'separator' },
        { label: 'Upload File', accelerator: 'CmdOrCtrl+U', click: () => mainWindow.webContents.send('menu-ftp-upload') },
        { label: 'Download File', accelerator: 'CmdOrCtrl+D', click: () => mainWindow.webContents.send('menu-ftp-download') }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function setupIPC() {
  ipcMain.handle('ftp-connect', async (event, config) => {
    try { await ftpService.connect(config); return { success: true } } catch (error) { return { success: false, error: error.message } }
  })
  ipcMain.handle('ftp-disconnect', async () => {
    try { await ftpService.disconnect(); return { success: true } } catch (error) { return { success: false, error: error.message } }
  })
  ipcMain.handle('ftp-list-files', async (event, p = '/') => {
    try { const files = await ftpService.listFiles(p); return { success: true, files } } catch (error) { return { success: false, error: error.message } }
  })
  ipcMain.handle('ftp-list-all', async (event, p = '/') => {
    try {
      const files = await ftpService.listFiles(p)
      return { success: true, tree: files }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
  ipcMain.handle('ftp-download-file', async (event, remotePath, localPath) => {
    try { const content = await ftpService.downloadFile(remotePath, localPath); return { success: true, content } } catch (error) { return { success: false, error: error.message } }
  })
  ipcMain.handle('ftp-upload-file', async (event, localPath, remotePath) => {
    try { await ftpService.uploadFile(localPath, remotePath); return { success: true } } catch (error) { return { success: false, error: error.message } }
  })
  ipcMain.handle('ftp-sync-to-local', async (event, remoteRoot, localRoot, ignorePatterns) => {
    let lastCount = 0
    try {
      const result = await ftpService.syncToLocal(remoteRoot, localRoot, ignorePatterns, (count) => {
        lastCount = count
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ftp-sync-progress', { count })
        }
      })
      return { success: true, count: lastCount, root: result && result.root }
    } catch (error) {
      return { success: false, error: error.message, count: lastCount }
    }
  })

  ipcMain.handle('file-cache-get', async (event, filePath) => {
    try { const content = await fileCacheService.getCachedFile(filePath); return { success: true, content } } catch (error) { return { success: false, error: error.message } }
  })
  ipcMain.handle('file-cache-set', async (event, filePath, content) => {
    try { await fileCacheService.setCachedFile(filePath, content); return { success: true } } catch (error) { return { success: false, error: error.message } }
  })
  ipcMain.handle('file-cache-clear', async (event, filePath) => {
    try { await fileCacheService.clearCachedFile(filePath); return { success: true } } catch (error) { return { success: false, error: error.message } }
  })

  ipcMain.handle('db-get-users', async () => {
    try { const users = await databaseService.getUsers(); return { success: true, users } } catch (error) { return { success: false, error: error.message } }
  })
  ipcMain.handle('db-update-user-status', async (event, userId, status) => {
    try { await databaseService.updateUserStatus(userId, status); return { success: true } } catch (error) { return { success: false, error: error.message } }
  })
  ipcMain.handle('db-get-active-files', async () => {
    try { const files = await databaseService.getActiveFiles(); return { success: true, files } } catch (error) { return { success: false, error: error.message } }
  })
  ipcMain.handle('db-set-active-file', async (event, userId, filePath) => {
    try { await databaseService.setActiveFile(userId, filePath); return { success: true } } catch (error) { return { success: false, error: error.message } }
  })
  ipcMain.handle('db-remove-active-file', async (event, userId, filePath) => {
    try { await databaseService.removeActiveFile(userId, filePath); return { success: true } } catch (error) { return { success: false, error: error.message } }
  })
  ipcMain.handle('db-get-or-create-default-user', async () => {
    try { const user = await databaseService.getOrCreateDefaultUser(); return { success: true, user } } catch (error) { return { success: false, error: error.message } }
  })
  ipcMain.handle('db-get-ftp-connections', async (event, userId) => {
    try { const cons = await databaseService.getFTPConnections(userId); return { success: true, connections: cons } } catch (error) { return { success: false, error: error.message } }
  })
  ipcMain.handle('db-add-ftp-connection', async (event, { userId, name, host, port, username, password, defaultPath }) => {
    try { const c = await databaseService.addFTPConnection(userId, name, host, port, username, password, defaultPath); return { success: true, connection: c } } catch (error) { return { success: false, error: error.message } }
  })
  ipcMain.handle('db-remove-ftp-connection', async (event, { connectionId, userId }) => {
    try { const r = await databaseService.removeFTPConnection(connectionId, userId); return { success: true, removed: r } } catch (error) { return { success: false, error: error.message } }
  })
  ipcMain.handle('db-get-ftp-password', async (event, connectionId) => {
    try { const p = await databaseService.getFTPConnectionPassword(connectionId); return { success: true, password: p } } catch (error) { return { success: false, error: error.message } }
  })
  ipcMain.handle('settings-get-ftp-connections', async () => {
    try { const cons = settingsService.getFTPConnections(); return { success: true, connections: cons } } catch (error) { return { success: false, error: error.message } }
  })
  ipcMain.handle('settings-add-ftp-connection', async (event, conn) => {
    try { const c = settingsService.addFTPConnection(conn); return { success: true, connection: c } } catch (error) { return { success: false, error: error.message } }
  })
  ipcMain.handle('settings-remove-ftp-connection', async (event, id) => {
    try { const r = settingsService.removeFTPConnection(id); return { success: true, removed: r } } catch (error) { return { success: false, error: error.message } }
  })
  ipcMain.handle('settings-get-ftp-password', async (event, id) => {
    try { const p = settingsService.getFTPPassword(id); return { success: true, password: p } } catch (error) { return { success: false, error: error.message } }
  })
  ipcMain.handle('settings-get-sync-ignore', async () => {
    try {
      const patterns = settingsService.getSyncIgnorePatterns()
      return { success: true, patterns }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
  ipcMain.handle('settings-set-sync-ignore', async (event, patterns) => {
    try {
      const saved = settingsService.setSyncIgnorePatterns(patterns)
      return { success: true, patterns: saved }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
  ipcMain.handle('settings-get-sync-folder', async () => {
    try {
      const path = settingsService.getSyncFolder()
      return { success: true, path }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
  ipcMain.handle('settings-set-sync-folder', async (event, folderPath) => {
    try {
      const fs = require('fs').promises
      if (folderPath) {
        try {
          await fs.mkdir(folderPath, { recursive: true })
        } catch {
          // ignore mkdir errors; we still save the path
        }
      }
      const savedPath = settingsService.setSyncFolder(folderPath)
      return { success: true, path: savedPath }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
  ipcMain.handle('settings-choose-sync-folder', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'createDirectory']
      })
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { success: false, error: 'No folder selected' }
      }
      const folderPath = result.filePaths[0]
      settingsService.setSyncFolder(folderPath)
      return { success: true, path: folderPath }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('open-external-url', async (_event, url) => {
    try { await shell.openExternal(String(url)); return { success: true } } catch (error) { return { success: false, error: error.message } }
  })
}

app.whenReady().then(async () => {
  ftpService = new FTPService()
  databaseService = new DatabaseService()
  fileCacheService = new FileCacheService()
  settingsService = new SettingsService()
  try { await databaseService.initialize() } catch (e) {}
  try { await fileCacheService.initialize() } catch (e) {}
  createWindow(); createMenu(); setupIPC()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) { createWindow() } })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') { app.quit() } })
app.on('before-quit', async () => { if (ftpService) { await ftpService.disconnect() } if (databaseService) { await databaseService.close() } })
