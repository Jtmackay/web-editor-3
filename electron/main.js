const { app, BrowserWindow, ipcMain, Menu } = require('electron')
const path = require('path')
const { FTPService } = require('./services/ftpService')
const { DatabaseService } = require('./services/databaseService')
const { FileCacheService } = require('./services/fileCacheService')

let mainWindow
let ftpService
let databaseService
let fileCacheService

const isDev = process.env.NODE_ENV === 'development'

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      // Disable webSecurity so the renderer can reach into cross-origin
      // preview iframes for the custom inspector. This is acceptable here
      // because the app is a local desktop tool, not a browser.
      webSecurity: false,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false
  })

  // Provide a Chrome-like "Inspect Element" option on right-click anywhere,
  // including inside the preview iframe. This opens DevTools docked to the
  // right and focuses the element that was clicked, similar to Chrome.
  mainWindow.webContents.on('context-menu', (event, params) => {
    if (!mainWindow) return

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Inspect Element',
        click: () => {
          try {
            mainWindow.webContents.openDevTools({ mode: 'right' })
            mainWindow.webContents.inspectElement(params.x, params.y)
            if (mainWindow.webContents.isDevToolsOpened() && mainWindow.webContents.devToolsWebContents) {
              mainWindow.webContents.devToolsWebContents.focus()
            }
          } catch (e) {
            // If anything goes wrong, fall back to regular DevTools toggle.
            mainWindow.webContents.openDevTools({ mode: 'right' })
          }
        }
      }
    ])

    contextMenu.popup({ window: mainWindow })
  })

  // Load the app
  if (isDev) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5180'
    mainWindow.loadURL(devUrl)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
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
        {
          label: 'New File',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            mainWindow.webContents.send('menu-new-file')
          }
        },
        {
          label: 'Open File',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            mainWindow.webContents.send('menu-open-file')
          }
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            mainWindow.webContents.send('menu-save-file')
          }
        },
        {
          label: 'Save All',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => {
            mainWindow.webContents.send('menu-save-all')
          }
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit()
          }
        }
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
        { role: 'selectall' }
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
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'FTP',
      submenu: [
        {
          label: 'Connect to FTP',
          click: () => {
            mainWindow.webContents.send('menu-ftp-connect')
          }
        },
        {
          label: 'Disconnect',
          click: () => {
            mainWindow.webContents.send('menu-ftp-disconnect')
          }
        },
        { type: 'separator' },
        {
          label: 'Upload File',
          accelerator: 'CmdOrCtrl+U',
          click: () => {
            mainWindow.webContents.send('menu-ftp-upload')
          }
        },
        {
          label: 'Download File',
          accelerator: 'CmdOrCtrl+D',
          click: () => {
            mainWindow.webContents.send('menu-ftp-download')
          }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// IPC handlers
function setupIPC() {
  // FTP Service IPC handlers
  ipcMain.handle('ftp-connect', async (event, config) => {
    try {
      await ftpService.connect(config)
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('ftp-disconnect', async () => {
    try {
      await ftpService.disconnect()
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('ftp-list-files', async (event, path = '/') => {
    try {
      const files = await ftpService.listFiles(path)
      return { success: true, files }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('ftp-list-all', async (event, path = '/') => {
    try {
      const tree = await ftpService.listAll(path)
      return { success: true, tree }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('ftp-download-file', async (event, remotePath, localPath) => {
    try {
      const content = await ftpService.downloadFile(remotePath, localPath)
      return { success: true, content }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('ftp-upload-file', async (event, localPath, remotePath) => {
    try {
      await ftpService.uploadFile(localPath, remotePath)
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // File Cache Service IPC handlers
  ipcMain.handle('file-cache-get', async (event, filePath) => {
    try {
      const content = await fileCacheService.getCachedFile(filePath)
      return { success: true, content }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('file-cache-set', async (event, filePath, content) => {
    try {
      await fileCacheService.setCachedFile(filePath, content)
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('file-cache-clear', async (event, filePath) => {
    try {
      await fileCacheService.clearCachedFile(filePath)
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // Database Service IPC handlers
  ipcMain.handle('db-get-users', async () => {
    try {
      const users = await databaseService.getUsers()
      return { success: true, users }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('db-update-user-status', async (event, userId, status) => {
    try {
      await databaseService.updateUserStatus(userId, status)
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('db-get-active-files', async () => {
    try {
      const files = await databaseService.getActiveFiles()
      return { success: true, files }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('db-set-active-file', async (event, userId, filePath) => {
    try {
      await databaseService.setActiveFile(userId, filePath)
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('db-remove-active-file', async (event, userId, filePath) => {
    try {
      await databaseService.removeActiveFile(userId, filePath)
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('db-get-or-create-default-user', async () => {
    try {
      const user = await databaseService.getOrCreateDefaultUser()
      return { success: true, user }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // DevTools helpers
  ipcMain.handle('inspect-element-at', async (event, payload) => {
    if (!mainWindow) {
      return { success: false, error: 'Main window not available' }
    }
    try {
      const x = Math.round(payload?.x ?? 0)
      const y = Math.round(payload?.y ?? 0)
      mainWindow.webContents.openDevTools({ mode: 'right' })
      mainWindow.webContents.inspectElement(x, y)
      if (mainWindow.webContents.isDevToolsOpened() && mainWindow.webContents.devToolsWebContents) {
        mainWindow.webContents.devToolsWebContents.focus()
      }
      return { success: true }
    } catch (error) {
      mainWindow.webContents.openDevTools({ mode: 'right' })
      return { success: false, error: error.message }
    }
  })
}

// App event handlers
app.whenReady().then(async () => {
  // Initialize services
  ftpService = new FTPService()
  databaseService = new DatabaseService()
  fileCacheService = new FileCacheService()

  try {
    await databaseService.initialize()
  } catch (e) {}
  try {
    await fileCacheService.initialize()
  } catch (e) {}

  createWindow()
  createMenu()
  setupIPC()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Clean up services on app quit
app.on('before-quit', async () => {
  if (ftpService) {
    await ftpService.disconnect()
  }
  if (databaseService) {
    await databaseService.close()
  }
})
