const { Pool } = require('pg')
const Store = require('electron-store')

class DatabaseService {
  constructor() {
    this.pool = null
    this.store = new Store({ name: 'database-config' })
    this.currentUser = null
    this.dbAvailable = false
    this.local = new Store({ name: 'database-local' })
  }
  getConfig() {
    return this.store.get('database', {
      host: 'localhost',
      port: 5432,
      database: 'vscode_editor',
      user: 'postgres',
      password: 'postgres'
    })
  }
  setConfig(nextConfig) {
    const current = this.getConfig()
    const merged = { ...current, ...nextConfig }
    this.store.set('database', merged)
    return merged
  }
  getEncryptionKey() { let key = this.store.get('encryptionKey'); if (!key) { const crypto = require('crypto'); key = crypto.randomBytes(32).toString('base64'); this.store.set('encryptionKey', key) } return Buffer.from(key, 'base64') }
  encrypt(text) { const crypto = require('crypto'); const key = this.getEncryptionKey(); const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv); const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); const tag = cipher.getAuthTag(); return JSON.stringify({ iv: iv.toString('base64'), tag: tag.toString('base64'), data: enc.toString('base64') }) }
  decrypt(payload) { const crypto = require('crypto'); const key = this.getEncryptionKey(); const obj = JSON.parse(payload); const iv = Buffer.from(obj.iv, 'base64'); const tag = Buffer.from(obj.tag, 'base64'); const data = Buffer.from(obj.data, 'base64'); const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv); decipher.setAuthTag(tag); const dec = Buffer.concat([decipher.update(data), decipher.final()]); return dec.toString('utf8') }
  async initialize(config = null) {
    try {
      const envConnectionString = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || null
      if (envConnectionString && !config) {
        this.pool = new Pool({
          connectionString: envConnectionString,
          ssl: { rejectUnauthorized: false },
          max: 20,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 2000
        })
      } else {
        const dbConfig = config || this.getConfig()
        const shouldUseSSL =
          typeof dbConfig.ssl === 'boolean'
            ? dbConfig.ssl
            : dbConfig.host && !['localhost', '127.0.0.1'].includes(dbConfig.host)
        this.pool = new Pool({
          ...dbConfig,
          ssl: shouldUseSSL ? { rejectUnauthorized: false } : false,
          max: 20,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 2000
        })
      }
      await this.pool.query('SELECT NOW()')
      await this.initializeSchema()
      this.dbAvailable = true
      return true
    } catch (error) { this.dbAvailable = false; throw error }
  }
  async initializeSchema() {
    try {
      const createUsersTable = `CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username VARCHAR(100) UNIQUE NOT NULL, email VARCHAR(255), avatar_url VARCHAR(500), status VARCHAR(20) DEFAULT 'offline', last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
      const createFTPConnectionsTable = `CREATE TABLE IF NOT EXISTS ftp_connections (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), name VARCHAR(100) NOT NULL, host VARCHAR(255) NOT NULL, port INTEGER DEFAULT 21, username VARCHAR(100) NOT NULL, password_encrypted TEXT NOT NULL, default_path VARCHAR(500), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
      const createActiveFilesTable = `CREATE TABLE IF NOT EXISTS active_files (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), ftp_connection_id INTEGER REFERENCES ftp_connections(id), file_path TEXT NOT NULL, file_hash VARCHAR(64), last_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP, is_locked BOOLEAN DEFAULT false, locked_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, ftp_connection_id, file_path))`
      const createFileHistoryTable = `CREATE TABLE IF NOT EXISTS file_history (id SERIAL PRIMARY KEY, ftp_connection_id INTEGER REFERENCES ftp_connections(id), file_path TEXT NOT NULL, file_hash VARCHAR(64) NOT NULL, user_id INTEGER REFERENCES users(id), action VARCHAR(20) NOT NULL, changes_summary TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
      const createFileVersionsTable = `CREATE TABLE IF NOT EXISTS file_versions (
        id SERIAL PRIMARY KEY,
        ftp_connection_id INTEGER REFERENCES ftp_connections(id),
        file_path TEXT NOT NULL,
        user_id INTEGER REFERENCES users(id),
        content TEXT,
        content_hash VARCHAR(64) NOT NULL,
        action VARCHAR(20) NOT NULL,
        parent_version_id INTEGER REFERENCES file_versions(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
      await this.pool.query(createUsersTable)
      await this.pool.query(createFTPConnectionsTable)
      await this.pool.query(createActiveFilesTable)
      await this.pool.query(createFileHistoryTable)
      await this.pool.query(createFileVersionsTable)
      await this.pool.query('CREATE INDEX IF NOT EXISTS idx_active_files_user_id ON active_files(user_id)')
      await this.pool.query('CREATE INDEX IF NOT EXISTS idx_active_files_connection_id ON active_files(ftp_connection_id)')
      await this.pool.query('CREATE INDEX IF NOT EXISTS idx_file_history_connection_id ON file_history(ftp_connection_id)')
      await this.pool.query('CREATE INDEX IF NOT EXISTS idx_file_history_user_id ON file_history(user_id)')
      await this.pool.query('CREATE INDEX IF NOT EXISTS idx_file_versions_path ON file_versions(file_path)')
      await this.pool.query('CREATE INDEX IF NOT EXISTS idx_file_versions_created_at ON file_versions(created_at)')
    } catch (error) { throw error }
  }
  async getOrCreateDefaultUser() {
    try { const existing = await this.pool.query('SELECT * FROM users WHERE username = $1', ['local']); if (existing.rows.length > 0) { this.currentUser = existing.rows[0]; return this.currentUser } const created = await this.pool.query('INSERT INTO users (username) VALUES ($1) RETURNING *', ['local']); this.currentUser = created.rows[0]; return this.currentUser } catch (error) { throw error }
  }
  async getUsers() { const result = await this.pool.query('SELECT * FROM users ORDER BY username'); return result.rows }
  async updateUserStatus(userId, status) { const q = `UPDATE users SET status = $1, last_seen = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`; const result = await this.pool.query(q, [status, userId]); return result.rows[0] }
  async getActiveFiles() { const q = `SELECT af.*, u.username, u.avatar_url FROM active_files af JOIN users u ON af.user_id = u.id ORDER BY af.last_modified DESC`; const result = await this.pool.query(q); return result.rows }
  async setActiveFile(userId, filePath, ftpConnectionId = null, fileHash = null) { await this.removeActiveFile(userId, filePath); const q = `INSERT INTO active_files (user_id, ftp_connection_id, file_path, file_hash) VALUES ($1, $2, $3, $4) RETURNING *`; const r = await this.pool.query(q, [userId, ftpConnectionId, filePath, fileHash]); return r.rows[0] }
  async removeActiveFile(userId, filePath) { const q = `DELETE FROM active_files WHERE user_id = $1 AND file_path = $2 RETURNING *`; const r = await this.pool.query(q, [userId, filePath]); return r.rows[0] }
  async getFTPConnections(userId) { const q = `SELECT id, name, host, port, username, default_path, created_at FROM ftp_connections WHERE user_id = $1 ORDER BY name`; const r = await this.pool.query(q, [userId]); return r.rows }
  async addFTPConnection(userId, name, host, port, username, passwordPlain, defaultPath = '/') { const enc = this.encrypt(passwordPlain); const q = `INSERT INTO ftp_connections (user_id, name, host, port, username, password_encrypted, default_path) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, name, host, port, username, default_path, created_at`; const r = await this.pool.query(q, [userId, name, host, port, username, enc, defaultPath]); return r.rows[0] }
  async removeFTPConnection(connectionId, userId) { const q = `DELETE FROM ftp_connections WHERE id = $1 AND user_id = $2 RETURNING *`; const r = await this.pool.query(q, [connectionId, userId]); return r.rows[0] }
  async getFTPConnectionPassword(connectionId) { const r = await this.pool.query('SELECT password_encrypted FROM ftp_connections WHERE id = $1', [connectionId]); if (r.rows.length === 0) { return null } return this.decrypt(r.rows[0].password_encrypted) }
  async close() { if (this.pool) { await this.pool.end() } }

  async addFileVersion(ftpConnectionId, filePath, userId, content, contentHash, action, parentVersionId = null) {
    if (this.dbAvailable && this.pool) {
      const q = `INSERT INTO file_versions (ftp_connection_id, file_path, user_id, content, content_hash, action, parent_version_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING *`
      const r = await this.pool.query(q, [ftpConnectionId, filePath, userId, content, contentHash, action, parentVersionId])
      return r.rows[0]
    }
    const all = Array.isArray(this.local.get('file_versions')) ? this.local.get('file_versions') : []
    const now = new Date().toISOString()
    const id = Date.now()
    const row = { id, ftp_connection_id: ftpConnectionId, file_path: filePath, user_id: userId, content, content_hash: contentHash, action, parent_version_id: parentVersionId, created_at: now }
    this.local.set('file_versions', [...all, row])
    return row
  }

  async getLatestFileVersion(ftpConnectionId, filePath) {
    if (this.dbAvailable && this.pool) {
      const q = `SELECT * FROM file_versions WHERE (ftp_connection_id IS NULL OR ftp_connection_id = $1) AND file_path = $2 ORDER BY created_at DESC LIMIT 1`
      const r = await this.pool.query(q, [ftpConnectionId, filePath])
      return r.rows[0] || null
    }
    const all = Array.isArray(this.local.get('file_versions')) ? this.local.get('file_versions') : []
    const filtered = all.filter((r) => String(r.file_path) === String(filePath))
    filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    return filtered[0] || null
  }

  async getFileVersions(ftpConnectionId, filePath, limit = 50) {
    if (this.dbAvailable && this.pool) {
      const q = `SELECT fv.*, u.username, u.avatar_url FROM file_versions fv LEFT JOIN users u ON fv.user_id = u.id WHERE (fv.ftp_connection_id IS NULL OR fv.ftp_connection_id = $1) AND fv.file_path = $2 ORDER BY fv.created_at DESC LIMIT $3`
      const r = await this.pool.query(q, [ftpConnectionId, filePath, limit])
      return r.rows
    }
    const all = Array.isArray(this.local.get('file_versions')) ? this.local.get('file_versions') : []
    const filtered = all.filter((r) => String(r.file_path) === String(filePath))
    filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    return filtered.slice(0, limit)
  }

  async getRecentVersionedPaths(days = 30) {
    if (this.dbAvailable && this.pool) {
      const q = `SELECT DISTINCT file_path FROM file_versions WHERE created_at > NOW() - INTERVAL '${days} days'`
      const r = await this.pool.query(q)
      return r.rows.map((row) => row.file_path)
    }
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    const all = Array.isArray(this.local.get('file_versions')) ? this.local.get('file_versions') : []
    const recent = all.filter((r) => new Date(r.created_at).getTime() >= cutoff)
    const set = new Set(recent.map((r) => r.file_path))
    return Array.from(set)
  }

  async getAllVersionedPaths() {
    if (this.dbAvailable && this.pool) {
      const q = `SELECT DISTINCT file_path FROM file_versions`
      const r = await this.pool.query(q)
      return r.rows.map((row) => row.file_path)
    }
    const all = Array.isArray(this.local.get('file_versions')) ? this.local.get('file_versions') : []
    const set = new Set(all.map((r) => r.file_path))
    return Array.from(set)
  }
  async getEditedFiles(limit = 100) {
    if (this.dbAvailable && this.pool) {
      const q = `
        SELECT file_path, MAX(created_at) AS last_edit, COUNT(*) AS version_count
        FROM file_versions
        WHERE file_path !~ '^[0-9A-Fa-f]{12,64}$'
          AND file_path ~ '\\.[^/]+$'
        GROUP BY file_path
        ORDER BY last_edit DESC
        LIMIT $1`
      const r = await this.pool.query(q, [limit])
      return r.rows.map(row => ({ file_path: row.file_path, last_edit: row.last_edit, version_count: Number(row.version_count || 0) }))
    }
    let all = Array.isArray(this.local.get('file_versions')) ? this.local.get('file_versions') : []
    all = all.filter((v) => {
      const p = String(v.file_path || '')
      const base = p.replace(/\\/g, '/').split('/').pop() || ''
      const hasExt = /\.[^./]+$/.test(base)
      const isHex = /^[0-9A-Fa-f]{12,64}$/.test(base)
      return hasExt && !isHex
    })
    const map = new Map()
    for (const v of all) {
      const p = String(v.file_path)
      const ts = new Date(v.created_at).getTime() || 0
      const prev = map.get(p)
      if (!prev || ts > prev.ts) {
        map.set(p, { ts, count: (prev ? prev.count : 0) + 1 })
      } else {
        map.set(p, { ts: prev.ts, count: prev.count + 1 })
      }
    }
    const arr = Array.from(map.entries()).map(([file_path, d]) => ({ file_path, last_edit: new Date(d.ts).toISOString(), version_count: d.count }))
    arr.sort((a, b) => new Date(b.last_edit).getTime() - new Date(a.last_edit).getTime())
    return arr.slice(0, limit)
  }

  async getEditedFilesSince(sinceMs = 0, limit = 100) {
    if (this.dbAvailable && this.pool) {
      const q = `
        SELECT file_path, MAX(created_at) AS last_edit, COUNT(*) AS version_count
        FROM file_versions
        WHERE action <> 'baseline'
          AND created_at > TO_TIMESTAMP($1 / 1000.0)
          AND file_path !~ '^[0-9A-Fa-f]{12,64}$'
          AND file_path ~ '\\.[^/]+$'
        GROUP BY file_path
        ORDER BY last_edit DESC
        LIMIT $2`
      const r = await this.pool.query(q, [Number(sinceMs) || 0, limit])
      return r.rows.map(row => ({ file_path: row.file_path, last_edit: row.last_edit, version_count: Number(row.version_count || 0) }))
    }
    let all = Array.isArray(this.local.get('file_versions')) ? this.local.get('file_versions') : []
    const cutoff = Number(sinceMs) || 0
    all = all.filter((v) => {
      const t = new Date(v.created_at).getTime() || 0
      if (v.action === 'baseline') return false
      if (cutoff > 0 && t <= cutoff) return false
      const p = String(v.file_path || '')
      const base = p.replace(/\\/g, '/').split('/').pop() || ''
      const hasExt = /\.[^./]+$/.test(base)
      const isHex = /^[0-9A-Fa-f]{12,64}$/.test(base)
      return hasExt && !isHex
    })
    const map = new Map()
    for (const v of all) {
      const p = String(v.file_path)
      const ts = new Date(v.created_at).getTime() || 0
      const prev = map.get(p)
      if (!prev || ts > prev.ts) {
        map.set(p, { ts, count: (prev ? prev.count : 0) + 1 })
      } else {
        map.set(p, { ts: prev.ts, count: prev.count + 1 })
      }
    }
    const arr = Array.from(map.entries()).map(([file_path, d]) => ({ file_path, last_edit: new Date(d.ts).toISOString(), version_count: d.count }))
    arr.sort((a, b) => new Date(b.last_edit).getTime() - new Date(a.last_edit).getTime())
    return arr.slice(0, limit)
  }

  async addFileHistory(ftpConnectionId, filePath, userId, action, fileHash = null, changesSummary = null) {
    if (this.dbAvailable && this.pool) {
      const q = `INSERT INTO file_history (ftp_connection_id, file_path, user_id, action, file_hash, changes_summary)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING *`
      const r = await this.pool.query(q, [ftpConnectionId, filePath, userId, action, fileHash, changesSummary])
      return r.rows[0]
    }
    const all = Array.isArray(this.local.get('file_history')) ? this.local.get('file_history') : []
    const now = new Date().toISOString()
    const id = Date.now()
    const row = { id, ftp_connection_id: ftpConnectionId, file_path: filePath, user_id: userId, action, file_hash: fileHash, changes_summary: changesSummary, created_at: now }
    this.local.set('file_history', [...all, row])
    return row
  }

  async getFileHistory(ftpConnectionId, filePath, limit = 50) {
    if (this.dbAvailable && this.pool) {
      const q = `SELECT fh.*, u.username, u.avatar_url
                 FROM file_history fh
                 JOIN users u ON fh.user_id = u.id
                 WHERE (fh.ftp_connection_id IS NULL OR fh.ftp_connection_id = $1) AND fh.file_path = $2
                 ORDER BY fh.created_at DESC
                 LIMIT $3`
      const r = await this.pool.query(q, [ftpConnectionId, filePath, limit])
      return r.rows
    }
    const all = Array.isArray(this.local.get('file_history')) ? this.local.get('file_history') : []
    const filtered = all.filter((r) => String(r.file_path) === String(filePath))
    filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    return filtered.slice(0, limit)
  }

  async clearAllFileHistory() {
    if (this.dbAvailable && this.pool) {
      await this.pool.query('DELETE FROM file_history')
      return true
    }
    this.local.set('file_history', [])
    return true
  }

  async clearAllFileVersions() {
    if (this.dbAvailable && this.pool) {
      await this.pool.query('DELETE FROM file_versions')
      return true
    }
    this.local.set('file_versions', [])
    return true
  }
}

module.exports = { DatabaseService }
