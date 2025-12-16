const ftp = require('basic-ftp')
const fs = require('fs').promises
const path = require('path')

class FTPService {
  constructor() {
    this.client = new ftp.Client()
    this.connected = false
    this.currentConnection = null
    this.client.ftp.timeout = 30000
  }

  async ensureConnected() {
    try {
      if (!this.connected || !this.client || this.client.closed) {
        // If the client was closed due to a previous error, create a fresh instance
        if (!this.client || this.client.closed) {
          try {
            this.client.close()
          } catch {
            // ignore close errors
          }
          this.client = new ftp.Client()
          this.client.ftp.timeout = 30000
        }
        const cfg = this.currentConnection
        if (!cfg) {
          throw new Error('Not connected to FTP server')
        }
        const connectionOptions = {
          host: cfg.host,
          port: cfg.port || 21,
          user: cfg.username,
          password: cfg.password,
          secure: cfg.secure || false,
          secureOptions: cfg.secureOptions || {},
          passive: cfg.passive !== false
        }
        await this.client.access(connectionOptions)
        this.connected = true
        if (cfg.defaultPath && cfg.defaultPath !== '/') {
          try {
            await this.client.cd(cfg.defaultPath)
          } catch {
            // ignore cd errors on reconnect
          }
        }
      }
    } catch (error) {
      this.connected = false
      throw new Error(`FTP connection failed: ${error.message}`)
    }
  }
  async connect(config) {
    try {
      if (this.connected) { await this.disconnect() }
      const connectionOptions = { host: config.host, port: config.port || 21, user: config.username, password: config.password, secure: config.secure || false, secureOptions: config.secureOptions || {}, passive: config.passive !== false }
      await this.client.access(connectionOptions)
      this.connected = true; this.currentConnection = config
      if (config.defaultPath && config.defaultPath !== '/') { await this.client.cd(config.defaultPath) }
      return true
    } catch (error) { this.connected = false; throw new Error(`FTP connection failed: ${error.message}`) }
  }
  async disconnect() { try { if (this.connected) { await this.client.close(); this.connected = false; this.currentConnection = null } } catch (error) { throw error } }
  async listFiles(remotePath = '/') {
    await this.ensureConnected()
    try {
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
          if (sanitized !== '/') { await this.client.cd(sanitized) }
          list = await this.client.list()
          try { basePath = await this.client.pwd() } catch {}
        } catch {
          let cwd = '/'
          try { cwd = await this.client.pwd() } catch {}
          const parts = sanitized.replace(/^\/+/, '').split('/').filter(Boolean)
          for (const seg of parts) { try { await this.client.cd(seg) } catch {} }
          list = await this.client.list()
          try { basePath = await this.client.pwd() } catch { basePath = cwd }
        }
      }
      const posix = require('path').posix
      for (const item of list) {
        files.push({ name: item.name, path: posix.join(basePath, item.name), type: item.isDirectory ? 'directory' : 'file', size: item.size, modified: item.modifiedAt, permissions: item.permissions })
      }
      return files
    } catch (error) { throw new Error(`Failed to list files: ${error.message}`) }
  }
  async listFilesReadonly(remotePath = '/') {
    await this.ensureConnected()
    let originalPwd = '/'
    try {
      try { originalPwd = await this.client.pwd() } catch { originalPwd = '/' }
      const files = []
      const sanitized = String(remotePath).replace(/\\/g, '/')
      const posix = require('path').posix
      let list
      let basePath = sanitized
      try {
        list = await this.client.list(sanitized === '/' ? '' : sanitized)
        basePath = sanitized === '/' ? originalPwd : sanitized
      } catch {
        // Try listing by temporarily changing directory, but always restore
        const dirParts = sanitized.replace(/^\/+/, '').split('/').filter(Boolean)
        let targetBase = originalPwd
        try {
          for (const seg of dirParts) { await this.client.cd(seg) }
          targetBase = await this.client.pwd()
          list = await this.client.list()
          basePath = targetBase
        } catch {
          list = []
          basePath = sanitized || originalPwd
        } finally {
          try { await this.client.cd(originalPwd) } catch {}
        }
      }
      for (const item of list) {
        files.push({ name: item.name, path: posix.join(basePath, item.name), type: item.isDirectory ? 'directory' : 'file', size: item.size, modified: item.modifiedAt, permissions: item.permissions })
      }
      return files
    } catch (error) {
      // Attempt to restore CWD on error
      try { if (originalPwd) await this.client.cd(originalPwd) } catch {}
      throw new Error(`Failed to list files (readonly): ${error.message}`)
    }
  }
  async downloadFile(remotePath, localPath = null, _retry = false) {
    await this.ensureConnected()
    try {
      const remote = String(remotePath).replace(/\\/g, '/')
      const posix = require('path').posix
      const dir = posix.dirname(remote)
      const base = posix.basename(remote)
      const tryDirect = async (targetPath) => {
        await this.client.downloadTo(targetPath, remote)
      }
      const tryCdAndBase = async (targetPath) => {
        if (dir && dir !== '/') { try { await this.client.cd(dir) } catch {} }
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
      // Attempt one reconnect-and-retry if the client was closed mid-transfer
      if (!_retry) {
        await this.ensureConnected()
        return this.downloadFile(remotePath, localPath, true)
      }
      throw new Error(`Failed to download file: ${error.message}`)
    }
  }
  async uploadFile(localPath, remotePath, _retry = false) {
    await this.ensureConnected()
    try {
      let content; let isFile = false
      try { await fs.access(localPath); isFile = (await fs.stat(localPath)).isFile() } catch { content = localPath }
      const posix = require('path').posix
      const dir = posix.dirname(String(remotePath).replace(/\\/g, '/'))
      const base = posix.basename(String(remotePath).replace(/\\/g, '/'))
      let originalPwd = '/'
      try { originalPwd = await this.client.pwd() } catch {}
      try { await this.client.ensureDir(dir) } catch {}
      try { if (dir && dir !== '/') { await this.client.cd(dir) } } catch {}
      if (isFile) {
        await this.client.uploadFrom(localPath, base)
      } else {
        let buffer
        const raw = String(content || '')
        if (raw.startsWith('data:') && raw.includes(';base64,')) {
          const idx = raw.indexOf(';base64,')
          const base64 = raw.slice(idx + ';base64,'.length)
          buffer = Buffer.from(base64, 'base64')
        } else {
          buffer = Buffer.from(raw, 'utf-8')
        }
        await this.client.uploadFrom(buffer, base)
      }
      try { await this.client.cd(originalPwd) } catch {}
      return true
    } catch (error) {
      // If the client was closed due to overlapping tasks, reconnect once and retry
      if (!_retry) {
        await this.ensureConnected()
        return this.uploadFile(localPath, remotePath, true)
      }
      throw new Error(`Failed to upload file: ${error.message}`)
    }
  }
  async createDirectory(remotePath) {
    await this.ensureConnected()
    try { await this.client.ensureDir(remotePath); return true } catch (error) { throw new Error(`Failed to create directory: ${error.message}`) }
  }
  async deleteFile(remotePath) {
    await this.ensureConnected()
    try { await this.client.remove(remotePath); return true } catch (error) { throw new Error(`Failed to delete file: ${error.message}`) }
  }
  async deleteDirectory(remotePath) {
    await this.ensureConnected()
    try { await this.client.removeDir(remotePath); return true } catch (error) { throw new Error(`Failed to delete directory: ${error.message}`) }
  }
  async rename(oldPath, newPath) {
    await this.ensureConnected()
    try { await this.client.rename(oldPath, newPath); return true } catch (error) { throw new Error(`Failed to rename: ${error.message}`) }
  }
  async getFileSize(remotePath) {
    await this.ensureConnected()
    try { const size = await this.client.size(remotePath); return size } catch (error) { throw new Error(`Failed to get file size: ${error.message}`) }
  }
  async exists(remotePath) {
    await this.ensureConnected()
    try { await this.client.cd(remotePath); return { exists: true, type: 'directory' } } catch { try { await this.client.size(remotePath); return { exists: true, type: 'file' } } catch { return { exists: false } } }
  }
  isConnected() { return this.connected }
  getCurrentConnection() { return this.currentConnection }
  async syncToLocal(remoteRoot, localRoot, ignorePatterns = [], onProgress) {
    await this.ensureConnected()
    if (!localRoot) { throw new Error('Local sync folder is not set') }
    const nodePath = require('path')
    const fsNative = require('fs').promises

    const normalizeRemote = (p) => {
      if (!p) return '/'
      let out = String(p).replace(/\\/g, '/')
      if (!out.startsWith('/')) out = '/' + out
      if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1)
      return out
    }

    const rawIgnore = Array.isArray(ignorePatterns) ? ignorePatterns : []
    const pathPatterns = rawIgnore
      .filter(p => typeof p === 'string' && (p.includes('/') || String(p).startsWith('/')))
      .map(normalizeRemote)
    const namePatterns = rawIgnore
      .filter(p => typeof p === 'string' && !String(p).includes('/') && !String(p).startsWith('/'))
      .map(p => String(p))

    let filesSynced = 0
    const reportProgress = () => {
      if (typeof onProgress === 'function') {
        try {
          onProgress(filesSynced)
        } catch {
          // ignore callback errors
        }
      }
    }

    const isIgnored = (remotePath, name) => {
      const p = normalizeRemote(remotePath)
      const fileName = String(name || '').trim()

      // Path-based ignore: exact match or directory prefix.
      if (pathPatterns.some(pattern => p === pattern || p.startsWith(pattern + '/'))) {
        return true
      }

      // Name-based ignore: filename starts or ends with the token.
      if (fileName) {
        if (namePatterns.some(token => fileName.startsWith(token) || fileName.endsWith(token))) {
          return true
        }
      }

      return false
    }

    const ensureLocalDir = async (dir) => {
      await fsNative.mkdir(dir, { recursive: true })
    }

    const walk = async (remotePath, localDir) => {
      const normalizedPath = normalizeRemote(remotePath)
      if (isIgnored(normalizedPath, nodePath.basename(normalizedPath))) return

      const entries = await this.listFiles(normalizedPath)
      await ensureLocalDir(localDir)

      for (const entry of entries) {
        const remoteChild = normalizeRemote(entry.path)
        if (isIgnored(remoteChild, entry.name)) continue
        const localChild = nodePath.join(localDir, entry.name)
        if (entry.type === 'directory') {
          await walk(remoteChild, localChild)
        } else {
          try {
            await this.client.downloadTo(localChild, remoteChild)
            filesSynced += 1
            reportProgress()
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`Failed to download ${remoteChild}:`, err.message || err)
          }
        }
      }
    }

    const pad = (n) => String(n).padStart(2, '0')
    const now = new Date()
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`
    const targetRoot = nodePath.join(localRoot, stamp)

    await ensureLocalDir(targetRoot)
    await walk(remoteRoot || '/', targetRoot)
    return { root: targetRoot, files: filesSynced }
  }
}

module.exports = { FTPService }
