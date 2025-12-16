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
    const merged = {
      ...current,
      ...nextConfig,
    }
    this.store.set('database', merged)
    return merged
  }

  async initialize(config = null) {
    try {
      // Prefer a DATABASE_URL/NEON_DATABASE_URL when available (e.g. Neon.tech),
      // otherwise fall back to the stored per-machine config.
      const envConnectionString = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || null

      if (envConnectionString && !config) {
        // Hosted Postgres (Neon, etc.) – always use SSL.
        this.pool = new Pool({
          connectionString: envConnectionString,
          ssl: { rejectUnauthorized: false },
          max: 20,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 2000
        })
      } else {
        // Use provided config or get from store
        const dbConfig = config || this.getConfig()

        // If ssl is explicitly set in config, respect it.
        // Otherwise, default to SSL for non-local hosts.
        const shouldUseSSL =
          typeof dbConfig.ssl === 'boolean'
            ? dbConfig.ssl
            : dbConfig.host && !['localhost', '127.0.0.1'].includes(dbConfig.host)

        this.pool = new Pool({
          ...dbConfig,
          ssl: shouldUseSSL ? { rejectUnauthorized: false } : false,
          max: 20, // Maximum number of clients in the pool
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 2000
        })
      }

      // Test connection
      await this.pool.query('SELECT NOW()')
      console.log('Database connection established')

      // Initialize database schema
      await this.initializeSchema()
      this.dbAvailable = true
      
      return true
    } catch (error) {
      console.error('Database initialization failed:', error)
      this.dbAvailable = false
      throw error
    }
  }

  async initializeSchema() {
    try {
      // Create tables if they don't exist
      const createUsersTable = `
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(100) UNIQUE NOT NULL,
          email VARCHAR(255),
          avatar_url VARCHAR(500),
          status VARCHAR(20) DEFAULT 'offline',
          last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `

      const createFTPConnectionsTable = `
        CREATE TABLE IF NOT EXISTS ftp_connections (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id),
          name VARCHAR(100) NOT NULL,
          host VARCHAR(255) NOT NULL,
          port INTEGER DEFAULT 21,
          username VARCHAR(100) NOT NULL,
          password_encrypted TEXT NOT NULL,
          default_path VARCHAR(500),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `

      const createActiveFilesTable = `
        CREATE TABLE IF NOT EXISTS active_files (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id),
          ftp_connection_id INTEGER REFERENCES ftp_connections(id),
          file_path TEXT NOT NULL,
          file_hash VARCHAR(64),
          last_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          is_locked BOOLEAN DEFAULT false,
          locked_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, ftp_connection_id, file_path)
        )
      `

      const createFileHistoryTable = `
        CREATE TABLE IF NOT EXISTS file_history (
          id SERIAL PRIMARY KEY,
          ftp_connection_id INTEGER REFERENCES ftp_connections(id),
          file_path TEXT NOT NULL,
          file_hash VARCHAR(64) NOT NULL,
          user_id INTEGER REFERENCES users(id),
          action VARCHAR(20) NOT NULL,
          changes_summary TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `

      const createFileVersionsTable = `
        CREATE TABLE IF NOT EXISTS file_versions (
          id SERIAL PRIMARY KEY,
          ftp_connection_id INTEGER REFERENCES ftp_connections(id),
          file_path TEXT NOT NULL,
          user_id INTEGER REFERENCES users(id),
          content TEXT,
          content_hash VARCHAR(64) NOT NULL,
          action VARCHAR(20) NOT NULL,
          parent_version_id INTEGER REFERENCES file_versions(id),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `

      // Execute table creation queries
      await this.pool.query(createUsersTable)
      await this.pool.query(createFTPConnectionsTable)
      await this.pool.query(createActiveFilesTable)
      await this.pool.query(createFileHistoryTable)
      await this.pool.query(createFileVersionsTable)

      // Create indexes for better performance
      await this.pool.query('CREATE INDEX IF NOT EXISTS idx_active_files_user_id ON active_files(user_id)')
      await this.pool.query('CREATE INDEX IF NOT EXISTS idx_active_files_connection_id ON active_files(ftp_connection_id)')
      await this.pool.query('CREATE INDEX IF NOT EXISTS idx_file_history_connection_id ON file_history(ftp_connection_id)')
      await this.pool.query('CREATE INDEX IF NOT EXISTS idx_file_history_user_id ON file_history(user_id)')

      await this.pool.query('CREATE INDEX IF NOT EXISTS idx_file_versions_path ON file_versions(file_path)')
      await this.pool.query('CREATE INDEX IF NOT EXISTS idx_file_versions_created_at ON file_versions(created_at)')

      console.log('Database schema initialized')
    } catch (error) {
      console.error('Schema initialization failed:', error)
      throw error
    }
  }

  async getOrCreateDefaultUser() {
    try {
      const existing = await this.pool.query('SELECT * FROM users WHERE username = $1', ['local'])
      if (existing.rows.length > 0) {
        this.currentUser = existing.rows[0]
        return this.currentUser
      }
      const created = await this.pool.query('INSERT INTO users (username) VALUES ($1) RETURNING *', ['local'])
      this.currentUser = created.rows[0]
      return this.currentUser
    } catch (error) {
      console.error('Error ensuring default user:', error)
      throw error
    }
  }

  async getUsers() {
    try {
      const result = await this.pool.query('SELECT * FROM users ORDER BY username')
      return result.rows
    } catch (error) {
      console.error('Error getting users:', error)
      throw error
    }
  }

  async createUser(username, email = null, avatarUrl = null) {
    try {
      const query = `
        INSERT INTO users (username, email, avatar_url)
        VALUES ($1, $2, $3)
        RETURNING *
      `
      const result = await this.pool.query(query, [username, email, avatarUrl])
      return result.rows[0]
    } catch (error) {
      console.error('Error creating user:', error)
      throw error
    }
  }

  async updateUserStatus(userId, status) {
    try {
      const query = `
        UPDATE users 
        SET status = $1, last_seen = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *
      `
      const result = await this.pool.query(query, [status, userId])
      return result.rows[0]
    } catch (error) {
      console.error('Error updating user status:', error)
      throw error
    }
  }

  async getUserById(userId) {
    try {
      const query = 'SELECT * FROM users WHERE id = $1'
      const result = await this.pool.query(query, [userId])
      return result.rows[0]
    } catch (error) {
      console.error('Error getting user by ID:', error)
      throw error
    }
  }

  async getActiveFiles() {
    try {
      const query = `
        SELECT af.*, u.username, u.avatar_url
        FROM active_files af
        JOIN users u ON af.user_id = u.id
        ORDER BY af.last_modified DESC
      `
      const result = await this.pool.query(query)
      return result.rows
    } catch (error) {
      console.error('Error getting active files:', error)
      throw error
    }
  }

  async setActiveFile(userId, filePath, ftpConnectionId = null, fileHash = null) {
    try {
      // Remove existing active file for this user and path
      await this.removeActiveFile(userId, filePath)

      const query = `
        INSERT INTO active_files (user_id, ftp_connection_id, file_path, file_hash)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `
      const result = await this.pool.query(query, [userId, ftpConnectionId, filePath, fileHash])
      return result.rows[0]
    } catch (error) {
      console.error('Error setting active file:', error)
      throw error
    }
  }

  async removeActiveFile(userId, filePath) {
    try {
      const query = `
        DELETE FROM active_files 
        WHERE user_id = $1 AND file_path = $2
        RETURNING *
      `
      const result = await this.pool.query(query, [userId, filePath])
      return result.rows[0]
    } catch (error) {
      console.error('Error removing active file:', error)
      throw error
    }
  }

  async getActiveFilesByConnection(ftpConnectionId) {
    try {
      const query = `
        SELECT af.*, u.username, u.avatar_url
        FROM active_files af
        JOIN users u ON af.user_id = u.id
        WHERE af.ftp_connection_id = $1
        ORDER BY af.last_modified DESC
      `
      const result = await this.pool.query(query, [ftpConnectionId])
      return result.rows
    } catch (error) {
      console.error('Error getting active files by connection:', error)
      throw error
    }
  }

  async addFileHistory(ftpConnectionId, filePath, userId, action, fileHash = null, changesSummary = null) {
    if (this.dbAvailable && this.pool) {
      const query = `
        INSERT INTO file_history (ftp_connection_id, file_path, user_id, action, file_hash, changes_summary)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `
      const result = await this.pool.query(query, [ftpConnectionId, filePath, userId, action, fileHash, changesSummary])
      return result.rows[0]
    }
    const all = Array.isArray(this.local.get('file_history')) ? this.local.get('file_history') : []
    const row = { id: Date.now(), ftp_connection_id: ftpConnectionId, file_path: filePath, user_id: userId, action, file_hash: fileHash, changes_summary: changesSummary, created_at: new Date().toISOString() }
    this.local.set('file_history', [...all, row])
    return row
  }

  async getFileHistory(ftpConnectionId, filePath, limit = 50) {
    if (this.dbAvailable && this.pool) {
      const query = `
        SELECT fh.*, u.username, u.avatar_url
        FROM file_history fh
        JOIN users u ON fh.user_id = u.id
        WHERE fh.ftp_connection_id = $1 AND fh.file_path = $2
        ORDER BY fh.created_at DESC
        LIMIT $3
      `
      const result = await this.pool.query(query, [ftpConnectionId, filePath, limit])
      return result.rows
    }
    const all = Array.isArray(this.local.get('file_history')) ? this.local.get('file_history') : []
    const filtered = all.filter((r) => String(r.file_path) === String(filePath))
    filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    return filtered.slice(0, limit)
  }

  async getFTPConnections(userId) {
    try {
      const query = `
        SELECT id, name, host, port, username, default_path, created_at
        FROM ftp_connections
        WHERE user_id = $1
        ORDER BY name
      `
      const result = await this.pool.query(query, [userId])
      return result.rows
    } catch (error) {
      console.error('Error getting FTP connections:', error)
      throw error
    }
  }

  async addFTPConnection(userId, name, host, port, username, passwordEncrypted, defaultPath = '/') {
    try {
      const query = `
        INSERT INTO ftp_connections (user_id, name, host, port, username, password_encrypted, default_path)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, name, host, port, username, default_path, created_at
      `
      const result = await this.pool.query(query, [userId, name, host, port, username, passwordEncrypted, defaultPath])
      return result.rows[0]
    } catch (error) {
      console.error('Error adding FTP connection:', error)
      throw error
    }
  }

  async removeFTPConnection(connectionId, userId) {
    try {
      const query = `
        DELETE FROM ftp_connections 
        WHERE id = $1 AND user_id = $2
        RETURNING *
      `
      const result = await this.pool.query(query, [connectionId, userId])
      return result.rows[0]
    } catch (error) {
      console.error('Error removing FTP connection:', error)
      throw error
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.end()
      console.log('Database connection closed')
    }
  }

  async addFileVersion(ftpConnectionId, filePath, userId, content, contentHash, action, parentVersionId = null) {
    if (this.dbAvailable && this.pool) {
      const query = `
        INSERT INTO file_versions (ftp_connection_id, file_path, user_id, content, content_hash, action, parent_version_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `
      const result = await this.pool.query(query, [ftpConnectionId, filePath, userId, content, contentHash, action, parentVersionId])
      return result.rows[0]
    }
    const all = Array.isArray(this.local.get('file_versions')) ? this.local.get('file_versions') : []
    const row = { id: Date.now(), ftp_connection_id: ftpConnectionId, file_path: filePath, user_id: userId, content, content_hash: contentHash, action, parent_version_id: parentVersionId, created_at: new Date().toISOString() }
    this.local.set('file_versions', [...all, row])
    return row
  }

  async getLatestFileVersion(ftpConnectionId, filePath) {
    if (this.dbAvailable && this.pool) {
      const query = `SELECT * FROM file_versions WHERE (ftp_connection_id IS NULL OR ftp_connection_id = $1) AND file_path = $2 ORDER BY created_at DESC LIMIT 1`
      const result = await this.pool.query(query, [ftpConnectionId, filePath])
      return result.rows[0] || null
    }
    const all = Array.isArray(this.local.get('file_versions')) ? this.local.get('file_versions') : []
    const filtered = all.filter((r) => String(r.file_path) === String(filePath))
    filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    return filtered[0] || null
  }

  async getFileVersions(ftpConnectionId, filePath, limit = 50) {
    if (this.dbAvailable && this.pool) {
      const query = `
        SELECT fv.*, u.username, u.avatar_url
        FROM file_versions fv
        LEFT JOIN users u ON fv.user_id = u.id
        WHERE (fv.ftp_connection_id IS NULL OR fv.ftp_connection_id = $1) AND fv.file_path = $2
        ORDER BY fv.created_at DESC
        LIMIT $3
      `
      const result = await this.pool.query(query, [ftpConnectionId, filePath, limit])
      return result.rows
    }
    const all = Array.isArray(this.local.get('file_versions')) ? this.local.get('file_versions') : []
    const filtered = all.filter((r) => String(r.file_path) === String(filePath))
    filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    return filtered.slice(0, limit)
  }

  async getEditedFiles(limit = 100) {
    if (this.dbAvailable && this.pool) {
      const query = `SELECT file_path, MAX(created_at) AS last_edit, COUNT(*) AS version_count FROM file_versions GROUP BY file_path ORDER BY last_edit DESC LIMIT $1`
      const result = await this.pool.query(query, [limit])
      return result.rows.map((row) => ({ file_path: row.file_path, last_edit: row.last_edit, version_count: Number(row.version_count || 0) }))
    }
    const all = Array.isArray(this.local.get('file_versions')) ? this.local.get('file_versions') : []
    const map = new Map<string, { ts: number; count: number }>()
    for (const v of all as any[]) {
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

  async getRecentVersionedPaths(days = 30) {
    if (this.dbAvailable && this.pool) {
      const query = `SELECT DISTINCT file_path FROM file_versions WHERE created_at > NOW() - INTERVAL '${days} days'`
      const result = await this.pool.query(query)
      return result.rows.map((row) => row.file_path)
    }
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    const all = Array.isArray(this.local.get('file_versions')) ? this.local.get('file_versions') : []
    const recent = all.filter((r) => new Date(r.created_at).getTime() >= cutoff)
    const set = new Set(recent.map((r) => r.file_path))
    return Array.from(set)
  }

  async addFileVersion(ftpConnectionId, filePath, userId, content, contentHash, action, parentVersionId = null) {
    const query = `
      INSERT INTO file_versions (ftp_connection_id, file_path, user_id, content, content_hash, action, parent_version_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `
    const result = await this.pool.query(query, [ftpConnectionId, filePath, userId, content, contentHash, action, parentVersionId])
    return result.rows[0]
  }

  async getLatestFileVersion(ftpConnectionId, filePath) {
    const query = `
      SELECT * FROM file_versions
      WHERE (ftp_connection_id IS NULL OR ftp_connection_id = $1) AND file_path = $2
      ORDER BY created_at DESC
      LIMIT 1
    `
    const result = await this.pool.query(query, [ftpConnectionId, filePath])
    return result.rows[0] || null
  }

  async getFileVersions(ftpConnectionId, filePath, limit = 50) {
    const query = `
      SELECT fv.*, u.username, u.avatar_url
      FROM file_versions fv
      LEFT JOIN users u ON fv.user_id = u.id
      WHERE (fv.ftp_connection_id IS NULL OR fv.ftp_connection_id = $1) AND fv.file_path = $2
      ORDER BY fv.created_at DESC
      LIMIT $3
    `
    const result = await this.pool.query(query, [ftpConnectionId, filePath, limit])
    return result.rows
  }

  // Utility method to get current timestamp
  getCurrentTimestamp() {
    return new Date().toISOString()
  }

  // Method to clean up old active files (files that haven't been updated in a while)
  async cleanupOldActiveFiles(maxAgeMinutes = 30) {
    try {
      const query = `
        DELETE FROM active_files 
        WHERE last_modified < CURRENT_TIMESTAMP - INTERVAL '${maxAgeMinutes} minutes'
        RETURNING *
      `
      const result = await this.pool.query(query)
      return result.rows
    } catch (error) {
      console.error('Error cleaning up old active files:', error)
      throw error
    }
  }
}

module.exports = { DatabaseService }
