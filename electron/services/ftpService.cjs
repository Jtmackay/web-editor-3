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
    if (!this.connected) { throw new Error('Not connected to FTP server') }
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
  async downloadFile(remotePath, localPath = null) {
    if (!this.connected) { throw new Error('Not connected to FTP server') }
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
    } catch (error) { throw new Error(`Failed to download file: ${error.message}`) }
  }
  async uploadFile(localPath, remotePath) {
    if (!this.connected) { throw new Error('Not connected to FTP server') }
    try {
      let content; let isFile = false
      try { await fs.access(localPath); isFile = (await fs.stat(localPath)).isFile() } catch { content = localPath }
      if (isFile) { await this.client.uploadFrom(localPath, remotePath) } else { const buffer = Buffer.from(content, 'utf-8'); await this.client.uploadFrom(buffer, remotePath) }
      return true
    } catch (error) { throw new Error(`Failed to upload file: ${error.message}`) }
  }
  async createDirectory(remotePath) { if (!this.connected) { throw new Error('Not connected to FTP server') } try { await this.client.ensureDir(remotePath); return true } catch (error) { throw new Error(`Failed to create directory: ${error.message}`) } }
  async deleteFile(remotePath) { if (!this.connected) { throw new Error('Not connected to FTP server') } try { await this.client.remove(remotePath); return true } catch (error) { throw new Error(`Failed to delete file: ${error.message}`) } }
  async deleteDirectory(remotePath) { if (!this.connected) { throw new Error('Not connected to FTP server') } try { await this.client.removeDir(remotePath); return true } catch (error) { throw new Error(`Failed to delete directory: ${error.message}`) } }
  async rename(oldPath, newPath) { if (!this.connected) { throw new Error('Not connected to FTP server') } try { await this.client.rename(oldPath, newPath); return true } catch (error) { throw new Error(`Failed to rename: ${error.message}`) } }
  async getFileSize(remotePath) { if (!this.connected) { throw new Error('Not connected to FTP server') } try { const size = await this.client.size(remotePath); return size } catch (error) { throw new Error(`Failed to get file size: ${error.message}`) } }
  async exists(remotePath) { if (!this.connected) { throw new Error('Not connected to FTP server') } try { await this.client.cd(remotePath); return { exists: true, type: 'directory' } } catch { try { await this.client.size(remotePath); return { exists: true, type: 'file' } } catch { return { exists: false } } } }
  isConnected() { return this.connected }
  getCurrentConnection() { return this.currentConnection }
  async syncToLocal(remoteRoot, localRoot, ignorePatterns = [], onProgress) {
    if (!this.connected) { throw new Error('Not connected to FTP server') }
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

    const ignore = (Array.isArray(ignorePatterns) ? ignorePatterns : []).map(normalizeRemote)

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

    const isIgnored = (remotePath) => {
      const p = normalizeRemote(remotePath)
      return ignore.some(pattern => p === pattern || p.startsWith(pattern + '/'))
    }

    const ensureLocalDir = async (dir) => {
      await fsNative.mkdir(dir, { recursive: true })
    }

    const walk = async (remotePath, localDir) => {
      const normalizedPath = normalizeRemote(remotePath)
      if (isIgnored(normalizedPath)) return

      const entries = await this.listFiles(normalizedPath)
      await ensureLocalDir(localDir)

      for (const entry of entries) {
        if (entry.name && entry.name.startsWith('._')) {
          continue
        }
        const remoteChild = normalizeRemote(entry.path)
        if (isIgnored(remoteChild)) continue
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
