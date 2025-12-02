const ftp = require('basic-ftp')
const fs = require('fs').promises
const path = require('path')

class FTPService {
  constructor() {
    this.client = new ftp.Client()
    this.connected = false
    this.currentConnection = null
    
    // Set up timeout and error handling
    this.client.ftp.timeout = 30000 // 30 seconds
    
    // Use default transfer preparation from library
  }

  async ensureConnected() {
    try {
      if (!this.connected || this.client.closed) {
        const cfg = this.currentConnection
        if (!cfg) throw new Error('No stored FTP connection config')
        await this.client.access({
          host: cfg.host,
          port: cfg.port || 21,
          user: cfg.username,
          password: cfg.password,
          secure: cfg.secure || false,
          secureOptions: cfg.secureOptions || {},
          passive: cfg.passive !== false
        })
        this.connected = true
        if (cfg.defaultPath && cfg.defaultPath !== '/') {
          try { await this.client.cd(cfg.defaultPath) } catch {}
        }
      }
    } catch (err) {
      this.connected = false
      throw err
    }
  }

  async connect(config) {
    try {
      // Close existing connection if any
      if (this.connected) {
        await this.disconnect()
      }

      const connectionOptions = {
        host: config.host,
        port: config.port || 21,
        user: config.username,
        password: config.password,
        secure: config.secure || false,
        secureOptions: config.secureOptions || {},
        passive: config.passive !== false // Default to passive mode
      }

      console.log(`Connecting to FTP server: ${config.host}:${config.port}`)
      
      await this.client.access(connectionOptions)
      
      this.connected = true
      this.currentConnection = config
      
      console.log('Successfully connected to FTP server')
      
      // Change to default path if specified
      if (config.defaultPath && config.defaultPath !== '/') {
        await this.client.cd(config.defaultPath)
      }
      
      return true
    } catch (error) {
      console.error('FTP connection failed:', error)
      this.connected = false
      throw new Error(`FTP connection failed: ${error.message}`)
    }
  }

  async disconnect() {
    try {
      if (this.connected) {
        await this.client.close()
        this.connected = false
        this.currentConnection = null
        console.log('Disconnected from FTP server')
      }
    } catch (error) {
      console.error('Error disconnecting from FTP:', error)
      throw error
    }
  }

  async listFiles(remotePath = '/') {
    const attempt = async () => {
      await this.ensureConnected()
      console.log(`Listing files in: ${remotePath}`)
      const files = []
      const sanitized = String(remotePath).replace(/\\/g, '/')
      let list
      let basePath = sanitized
      try {
        list = await this.client.list(sanitized === '/' ? '' : sanitized)
        if (sanitized === '/' || sanitized === '') {
          try { basePath = await this.client.pwd() } catch { basePath = '/' }
        }
      } catch {
        try {
          if (sanitized !== '/') {
            await this.client.cd(sanitized)
          }
          list = await this.client.list()
          try { basePath = await this.client.pwd() } catch {}
        } catch {
          // Fallback: treat the provided path as RELATIVE to current working directory
          let cwd = '/'
          try { cwd = await this.client.pwd() } catch {}
          const parts = sanitized.replace(/^\/+/, '').split('/').filter(Boolean)
          for (const seg of parts) {
            try { await this.client.cd(seg) } catch {}
          }
          list = await this.client.list()
          try { basePath = await this.client.pwd() } catch { basePath = cwd }
        }
      }
      const posix = require('path').posix
      for (const item of list) {
        files.push({
          name: item.name,
          path: posix.join(basePath, item.name),
          type: item.isDirectory ? 'directory' : 'file',
          size: item.size,
          modified: item.modifiedAt,
          permissions: item.permissions
        })
      }
      return files
    }
    try {
      return await attempt()
    } catch (error) {
      try {
        await this.ensureConnected()
        return await attempt()
      } catch (error2) {
        console.error('Error listing files:', error2)
        throw new Error(`Failed to list files: ${error2.message}`)
      }
    }
  }

  async listAll(remotePath = '/') {
    if (!this.connected) {
      throw new Error('Not connected to FTP server')
    }
    const posix = require('path').posix
    const build = async (base) => {
      const entries = await this.client.list(base === '/' ? '' : base)
      const out = []
      for (const item of entries) {
        const p = posix.join(base, item.name)
        const node = {
          name: item.name,
          path: p,
          type: item.isDirectory ? 'directory' : 'file',
          size: item.size,
          modified: item.modifiedAt,
          permissions: item.permissions,
          children: []
        }
        if (item.isDirectory) {
          try {
            node.children = await build(p)
          } catch {}
        }
        out.push(node)
      }
      return out
    }
    return await build(remotePath)
  }

  async downloadFile(remotePath, localPath = null) {
    await this.ensureConnected()

    try {
      console.log(`Downloading file: ${remotePath}`)

      const remote = String(remotePath).replace(/\\/g, '/')
      const posix = require('path').posix
      const dir = posix.dirname(remote)
      const base = posix.basename(remote)

      const tryDirect = async (targetPath) => {
        await this.client.downloadTo(targetPath, remote)
      }

      const tryCdAndBase = async (targetPath) => {
        if (dir && dir !== '/') {
          try { await this.client.cd(dir) } catch {}
        }
        await this.client.downloadTo(targetPath, base)
      }

      if (!localPath) {
        const os = require('os')
        const tmp = path.join(os.tmpdir(), `ftp-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`)
        try {
          await tryDirect(tmp)
        } catch {
          await tryCdAndBase(tmp)
        }
        const content = await fs.readFile(tmp, 'utf-8')
        try { await fs.unlink(tmp) } catch {}
        return content
      }

      try {
        await tryDirect(localPath)
      } catch {
        await tryCdAndBase(localPath)
      }
      const content = await fs.readFile(localPath, 'utf-8')
      return content
    } catch (error) {
      console.error('Error downloading file:', error)
      // Attempt one reconnect and retry
      try {
        await this.ensureConnected()
        return await this.downloadFile(remotePath, localPath)
      } catch (err2) {
        throw new Error(`Failed to download file: ${error.message}`)
      }
    }
  }

  async uploadFile(localPath, remotePath) {
    if (!this.connected) {
      throw new Error('Not connected to FTP server')
    }

    try {
      console.log(`Uploading file: ${localPath} -> ${remotePath}`)
      
      // Check if local path is a file or content string
      let content
      let isFile = false
      
      try {
        await fs.access(localPath)
        isFile = (await fs.stat(localPath)).isFile()
      } catch {
        // Treat as content string if file doesn't exist
        content = localPath
      }
      
      if (isFile) {
        await this.client.uploadFrom(localPath, remotePath)
      } else {
        // Upload from buffer
        const buffer = Buffer.from(content, 'utf-8')
        await this.client.uploadFrom(buffer, remotePath)
      }
      
      console.log('File uploaded successfully')
      return true
    } catch (error) {
      console.error('Error uploading file:', error)
      throw new Error(`Failed to upload file: ${error.message}`)
    }
  }

  async createDirectory(remotePath) {
    if (!this.connected) {
      throw new Error('Not connected to FTP server')
    }

    try {
      console.log(`Creating directory: ${remotePath}`)
      await this.client.ensureDir(remotePath)
      return true
    } catch (error) {
      console.error('Error creating directory:', error)
      throw new Error(`Failed to create directory: ${error.message}`)
    }
  }

  async deleteFile(remotePath) {
    if (!this.connected) {
      throw new Error('Not connected to FTP server')
    }

    try {
      console.log(`Deleting file: ${remotePath}`)
      await this.client.remove(remotePath)
      return true
    } catch (error) {
      console.error('Error deleting file:', error)
      throw new Error(`Failed to delete file: ${error.message}`)
    }
  }

  async deleteDirectory(remotePath) {
    if (!this.connected) {
      throw new Error('Not connected to FTP server')
    }

    try {
      console.log(`Deleting directory: ${remotePath}`)
      await this.client.removeDir(remotePath)
      return true
    } catch (error) {
      console.error('Error deleting directory:', error)
      throw new Error(`Failed to delete directory: ${error.message}`)
    }
  }

  async rename(oldPath, newPath) {
    if (!this.connected) {
      throw new Error('Not connected to FTP server')
    }

    try {
      console.log(`Renaming: ${oldPath} -> ${newPath}`)
      await this.client.rename(oldPath, newPath)
      return true
    } catch (error) {
      console.error('Error renaming:', error)
      throw new Error(`Failed to rename: ${error.message}`)
    }
  }

  async getFileSize(remotePath) {
    if (!this.connected) {
      throw new Error('Not connected to FTP server')
    }

    try {
      const size = await this.client.size(remotePath)
      return size
    } catch (error) {
      console.error('Error getting file size:', error)
      throw new Error(`Failed to get file size: ${error.message}`)
    }
  }

  async exists(remotePath) {
    if (!this.connected) {
      throw new Error('Not connected to FTP server')
    }

    try {
      await this.client.cd(remotePath)
      return { exists: true, type: 'directory' }
    } catch (dirError) {
      try {
        await this.client.size(remotePath)
        return { exists: true, type: 'file' }
      } catch (fileError) {
        return { exists: false }
      }
    }
  }

  isConnected() {
    return this.connected
  }

  getCurrentConnection() {
    return this.currentConnection
  }
}

module.exports = { FTPService }
