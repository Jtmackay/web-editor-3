const { Pool } = require('pg')
const Store = require('electron-store')

class DatabaseService {
  constructor() { this.pool = null; this.store = new Store({ name: 'database-config' }); this.currentUser = null }
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
      return true
    } catch (error) { throw error }
  }
  async initializeSchema() {
    try {
      const createUsersTable = `CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username VARCHAR(100) UNIQUE NOT NULL, email VARCHAR(255), avatar_url VARCHAR(500), status VARCHAR(20) DEFAULT 'offline', last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
      const createFTPConnectionsTable = `CREATE TABLE IF NOT EXISTS ftp_connections (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), name VARCHAR(100) NOT NULL, host VARCHAR(255) NOT NULL, port INTEGER DEFAULT 21, username VARCHAR(100) NOT NULL, password_encrypted TEXT NOT NULL, default_path VARCHAR(500), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
      const createActiveFilesTable = `CREATE TABLE IF NOT EXISTS active_files (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), ftp_connection_id INTEGER REFERENCES ftp_connections(id), file_path TEXT NOT NULL, file_hash VARCHAR(64), last_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP, is_locked BOOLEAN DEFAULT false, locked_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, ftp_connection_id, file_path))`
      const createFileHistoryTable = `CREATE TABLE IF NOT EXISTS file_history (id SERIAL PRIMARY KEY, ftp_connection_id INTEGER REFERENCES ftp_connections(id), file_path TEXT NOT NULL, file_hash VARCHAR(64) NOT NULL, user_id INTEGER REFERENCES users(id), action VARCHAR(20) NOT NULL, changes_summary TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
      await this.pool.query(createUsersTable)
      await this.pool.query(createFTPConnectionsTable)
      await this.pool.query(createActiveFilesTable)
      await this.pool.query(createFileHistoryTable)
      await this.pool.query('CREATE INDEX IF NOT EXISTS idx_active_files_user_id ON active_files(user_id)')
      await this.pool.query('CREATE INDEX IF NOT EXISTS idx_active_files_connection_id ON active_files(ftp_connection_id)')
      await this.pool.query('CREATE INDEX IF NOT EXISTS idx_file_history_connection_id ON file_history(ftp_connection_id)')
      await this.pool.query('CREATE INDEX IF NOT EXISTS idx_file_history_user_id ON file_history(user_id)')
    } catch (error) { throw error }
  }
  async getOrCreateDefaultUser() {
    try {
      return await this.getOrCreateUserByName('local')
    } catch (error) { throw error }
  }
  async getOrCreateUserByName(username) {
    const name = String(username || '').trim() || 'local'
    const existing = await this.pool.query('SELECT * FROM users WHERE username = $1', [name])
    if (existing.rows.length > 0) {
      this.currentUser = existing.rows[0]
      return this.currentUser
    }
    const created = await this.pool.query('INSERT INTO users (username) VALUES ($1) RETURNING *', [name])
    this.currentUser = created.rows[0]
    return this.currentUser
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
}

module.exports = { DatabaseService }
