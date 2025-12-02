const { Pool } = require('pg')
const Store = require('electron-store')

class DatabaseService {
  constructor() {
    this.pool = null
    this.store = new Store({ name: 'database-config' })
    this.currentUser = null
  }

  async initialize(config = null) {
    try {
      // Use provided config or get from store
      const dbConfig = config || this.store.get('database', {
        host: 'localhost',
        port: 5432,
        database: 'vscode_editor',
        user: 'postgres',
        password: 'postgres'
      })

      this.pool = new Pool({
        ...dbConfig,
        ssl: false, // Disable SSL for local development
        max: 20, // Maximum number of clients in the pool
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      })

      // Test connection
      await this.pool.query('SELECT NOW()')
      console.log('Database connection established')

      // Initialize database schema
      await this.initializeSchema()
      
      return true
    } catch (error) {
      console.error('Database initialization failed:', error)
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

      // Execute table creation queries
      await this.pool.query(createUsersTable)
      await this.pool.query(createFTPConnectionsTable)
      await this.pool.query(createActiveFilesTable)
      await this.pool.query(createFileHistoryTable)

      // Create indexes for better performance
      await this.pool.query('CREATE INDEX IF NOT EXISTS idx_active_files_user_id ON active_files(user_id)')
      await this.pool.query('CREATE INDEX IF NOT EXISTS idx_active_files_connection_id ON active_files(ftp_connection_id)')
      await this.pool.query('CREATE INDEX IF NOT EXISTS idx_file_history_connection_id ON file_history(ftp_connection_id)')
      await this.pool.query('CREATE INDEX IF NOT EXISTS idx_file_history_user_id ON file_history(user_id)')

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
    try {
      const query = `
        INSERT INTO file_history (ftp_connection_id, file_path, user_id, action, file_hash, changes_summary)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `
      const result = await this.pool.query(query, [ftpConnectionId, filePath, userId, action, fileHash, changesSummary])
      return result.rows[0]
    } catch (error) {
      console.error('Error adding file history:', error)
      throw error
    }
  }

  async getFileHistory(ftpConnectionId, filePath, limit = 50) {
    try {
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
    } catch (error) {
      console.error('Error getting file history:', error)
      throw error
    }
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
