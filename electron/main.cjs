const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require('electron')
const path = require('path')
const fs = require('fs').promises
const { FTPService } = require('./services/ftpService.cjs')
const { DatabaseService } = require('./services/databaseService.cjs')
const { FileCacheService } = require('./services/fileCacheService.cjs')
const { SettingsService } = require('./services/settingsService.cjs')

// Hardware acceleration is enabled (default) for better rendering performance.
// If you encounter GPU-related crashes on some Windows machines, you can
// uncomment the following line to disable it as a fallback:
// app.disableHardwareAcceleration()

// Disable web security to allow cross-origin iframe access for inspect feature
app.commandLine.appendSwitch('disable-web-security')
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors')
app.commandLine.appendSwitch('disable-site-isolation-trials')

// Try to force-enable GPU acceleration even on machines that Chromium would
// normally block (old drivers, remote sessions, etc.). If this causes crashes
// on some systems, you can comment these out or guard them by an env flag.
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')
// Prefer ANGLE / Direct3D like Chrome does on Windows.
app.commandLine.appendSwitch('use-angle', 'd3d11')
app.commandLine.appendSwitch('use-gl', 'angle')
app.commandLine.appendSwitch('enable-webgl')

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
      preload: path.join(__dirname, 'preload.cjs'),
      // Allow the renderer to inspect cross-origin preview content inside iframes.
      // This is safe here because this is a desktop app with trusted content.
      webSecurity: false
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
        { label: 'Save and Sync to Server', accelerator: 'CmdOrCtrl+Alt+S', click: () => mainWindow.webContents.send('menu-save-and-sync') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow.webContents.send('menu-save-as') },
        { label: 'Save All', accelerator: 'CmdOrCtrl+Shift+Alt+S', click: () => mainWindow.webContents.send('menu-save-all') },
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
        { role: 'togglefullscreen' }
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
  let ftpQueue = Promise.resolve()
  const runQueued = (fn) => {
    const next = ftpQueue.then(fn, fn)
    ftpQueue = next.then(() => undefined, () => undefined)
    return next
  }

  ipcMain.handle('ftp-connect', async (event, config) => {
    return runQueued(async () => {
      try { await ftpService.connect(config); return { success: true } } catch (error) { return { success: false, error: error.message } }
    })
  })
  ipcMain.handle('ftp-disconnect', async () => {
    return runQueued(async () => {
      try { await ftpService.disconnect(); return { success: true } } catch (error) { return { success: false, error: error.message } }
    })
  })
  ipcMain.handle('ftp-list-files', async (event, p = '/') => {
    return runQueued(async () => {
      try { const files = await ftpService.listFiles(p); return { success: true, files } } catch (error) { return { success: false, error: error.message } }
    })
  })
  ipcMain.handle('ftp-list-all', async (event, p = '/') => {
    return runQueued(async () => {
      try {
        const files = await ftpService.listFiles(p)
        return { success: true, tree: files }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })
  })
  ipcMain.handle('ftp-download-file', async (event, remotePath, localPath) => {
    return runQueued(async () => {
      try { const content = await ftpService.downloadFile(remotePath, localPath); return { success: true, content } } catch (error) { return { success: false, error: error.message } }
    })
  })
  ipcMain.handle('ftp-upload-file', async (event, localPath, remotePath) => {
    return runQueued(async () => {
      try { await ftpService.uploadFile(localPath, remotePath); return { success: true } } catch (error) { return { success: false, error: error.message } }
    })
  })
  ipcMain.handle('ftp-sync-to-local', async (event, remoteRoot, localRoot, ignorePatterns) => {
    let lastCount = 0
    return runQueued(async () => {
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
  })

  ipcMain.handle('local-save-file', async (event, remotePath, content) => {
    try {
      const syncRoot = settingsService.getSyncFolder()
      if (!syncRoot) {
        return { success: false, error: 'Sync folder is not configured. Set it in the Settings tab.' }
      }

      const normalizeRemote = (p) => {
        if (!p) return '/'
        let out = String(p).replace(/\\/g, '/')
        if (!out.startsWith('/')) out = '/' + out
        return out
      }

      const normalized = normalizeRemote(remotePath)
      const relative = normalized.replace(/^\/+/, '')
      const segments = relative.split('/').filter(Boolean)
      const localPath = path.join(syncRoot, ...segments)

      const dir = path.dirname(localPath)
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(localPath, content ?? '', 'utf-8')

      return { success: true, path: localPath }
    } catch (error) {
      return { success: false, error: error.message }
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
  ipcMain.handle('db-set-active-file', async (event, userId, filePath, fileHash) => {
    try { await databaseService.setActiveFile(userId, filePath, null, fileHash ?? null); return { success: true } } catch (error) { return { success: false, error: error.message } }
  })
  ipcMain.handle('db-remove-active-file', async (event, userId, filePath) => {
    try { await databaseService.removeActiveFile(userId, filePath); return { success: true } } catch (error) { return { success: false, error: error.message } }
  })
  ipcMain.handle('db-get-or-create-default-user', async () => {
    try { const user = await databaseService.getOrCreateDefaultUser(); return { success: true, user } } catch (error) { return { success: false, error: error.message } }
  })
  ipcMain.handle('db-get-or-create-user-by-name', async (_event, username) => {
    try {
      const user = await databaseService.getOrCreateUserByName(username)
      return { success: true, user }
    } catch (error) {
      return { success: false, error: error.message }
    }
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
      const hideInExplorer = settingsService.getSyncHideIgnoredInExplorer
        ? settingsService.getSyncHideIgnoredInExplorer()
        : false
      const hiddenPaths = settingsService.getSyncHiddenPaths
        ? settingsService.getSyncHiddenPaths()
        : []
      return { success: true, patterns, hideInExplorer, hiddenPaths }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
  ipcMain.handle('settings-set-sync-ignore', async (event, patterns, hideInExplorer, hiddenPaths) => {
    try {
      const savedPatterns = settingsService.setSyncIgnorePatterns(patterns)
      let savedHide = settingsService.getSyncHideIgnoredInExplorer
        ? settingsService.getSyncHideIgnoredInExplorer()
        : false
      if (typeof hideInExplorer === 'boolean' && settingsService.setSyncHideIgnoredInExplorer) {
        savedHide = settingsService.setSyncHideIgnoredInExplorer(hideInExplorer)
      }
      let savedHiddenPaths = settingsService.getSyncHiddenPaths
        ? settingsService.getSyncHiddenPaths()
        : []
      if (Array.isArray(hiddenPaths) && settingsService.setSyncHiddenPaths) {
        savedHiddenPaths = settingsService.setSyncHiddenPaths(hiddenPaths)
      }
      return { success: true, patterns: savedPatterns, hideInExplorer: savedHide, hiddenPaths: savedHiddenPaths }
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
  ipcMain.handle('settings-get-preview-base-url', async () => {
    try {
      const baseUrl = settingsService.getPreviewBaseUrl()
      return { success: true, baseUrl }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
  ipcMain.handle('settings-set-preview-base-url', async (_event, baseUrl) => {
    try {
      const saved = settingsService.setPreviewBaseUrl(baseUrl)
      return { success: true, baseUrl: saved }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
  ipcMain.handle('settings-get-preview-start-after', async () => {
    try {
      const startAfter = settingsService.getPreviewStartAfter()
      return { success: true, startAfter }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
  ipcMain.handle('settings-set-preview-start-after', async (_event, startAfter) => {
    try {
      const saved = settingsService.setPreviewStartAfter(startAfter)
      return { success: true, startAfter: saved }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
  ipcMain.handle('settings-get-editor-name', async () => {
    try {
      const name = settingsService.getEditorName()
      return { success: true, name }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
  ipcMain.handle('settings-set-editor-name', async (_event, name) => {
    try {
      const saved = settingsService.setEditorName(name)
      return { success: true, name: saved }
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

  ipcMain.handle('settings-get-db-config', async () => {
    try {
      const cfg = databaseService.getConfig()
      return { success: true, config: cfg }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('settings-set-db-config', async (_event, cfg) => {
    try {
      const merged = databaseService.setConfig(cfg || {})
      return { success: true, config: merged }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('project-search', async (_event, payload) => {
    const { query, useRegex, caseSensitive } = payload || {}
    if (!query || !String(query).trim()) {
      return { success: true, files: [] }
    }

    try {
      const syncRoot = settingsService.getSyncFolder()
      if (!syncRoot) {
        return { success: false, error: 'Sync folder is not configured. Set it in Settings and run a sync first.' }
      }

      const entries = await fs.readdir(syncRoot, { withFileTypes: true })
      const dirEntries = entries.filter(e => e.isDirectory())
      if (!dirEntries.length) {
        return { success: false, error: 'No synced snapshots found in the sync folder. Run a sync first.' }
      }

      const timePattern = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}$/
      const candidates = dirEntries.map(d => d.name)
      const stamped = candidates.filter(name => timePattern.test(name))
      const chosen = (stamped.length ? stamped : candidates).sort().slice(-1)[0]
      const root = path.join(syncRoot, chosen)

      const source = useRegex ? String(query) : String(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const flags = caseSensitive ? 'g' : 'gi'
      let regex
      try {
        regex = new RegExp(source, flags)
      } catch (err) {
        return { success: false, error: 'Invalid regular expression' }
      }

      const maxFileSizeBytes = 1024 * 1024
      const skipDirs = new Set(['.git', 'node_modules', 'dist', 'build', '.cache'])
      const skipExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.mp4', '.mp3', '.woff', '.woff2', '.ttf', '.eot', '.zip', '.tar', '.gz'])

      const results = []

      const walk = async (dir) => {
        let items
        try {
          items = await fs.readdir(dir, { withFileTypes: true })
        } catch {
          return
        }
        for (const item of items) {
          const fullPath = path.join(dir, item.name)
          if (item.isDirectory()) {
            if (skipDirs.has(item.name)) continue
            await walk(fullPath)
          } else {
            const ext = path.extname(item.name).toLowerCase()
            if (skipExtensions.has(ext)) continue
            let stat
            try {
              stat = await fs.stat(fullPath)
            } catch {
              continue
            }
            if (!stat.isFile() || stat.size > maxFileSizeBytes) continue

            let content
            try {
              content = await fs.readFile(fullPath, 'utf-8')
            } catch {
              continue
            }
            if (!content) continue

            const lines = content.split(/\r?\n/)
            const fileMatches = []
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i]
              if (!line) continue
              const lineRegex = new RegExp(regex.source, regex.flags)
              let m
              while ((m = lineRegex.exec(line)) !== null) {
                const matchText = m[0]
                const column = m.index + 1
                fileMatches.push({
                  line: i + 1,
                  column,
                  matchText,
                  lineText: line
                })
                if (matchText.length === 0) {
                  lineRegex.lastIndex += 1
                }
              }
            }

            if (fileMatches.length) {
              const relativePath = path.relative(root, fullPath)
              results.push({
                path: fullPath,
                relativePath,
                name: item.name,
                matches: fileMatches
              })
            }
          }
        }
      }

      await walk(root)

      return { success: true, files: results, root }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('open-external-url', async (_event, url) => {
    try { await shell.openExternal(String(url)); return { success: true } } catch (error) { return { success: false, error: error.message } }
  })
}

app.whenReady().then(async () => {
  // Log GPU feature status so we can confirm hardware acceleration is active.
  try {
    const gpuStatus = app.getGPUFeatureStatus()
    console.log('[electron] GPU feature status:', gpuStatus)
  } catch (err) {
    console.log('[electron] Unable to read GPU feature status:', err && err.message ? err.message : err)
  }

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
