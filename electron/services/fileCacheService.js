const fs = require('fs').promises
const path = require('path')
const crypto = require('crypto')
const { app } = require('electron')

class FileCacheService {
  constructor() {
    this.cacheDir = null
    this.metadataFile = null
    this.metadata = new Map()
    this.maxCacheSize = 100 * 1024 * 1024 // 100MB default cache size
    this.maxFileAge = 24 * 60 * 60 * 1000 // 24 hours default
    this.initialized = false
  }

  async initialize() {
    try {
      // Get the app's user data directory
      const userDataPath = app.getPath('userData')
      this.cacheDir = path.join(userDataPath, 'file-cache')
      this.metadataFile = path.join(this.cacheDir, 'metadata.json')

      // Ensure cache directory exists
      await this.ensureDirectoryExists(this.cacheDir)

      // Load existing metadata
      await this.loadMetadata()

      // Clean up old files on initialization
      await this.cleanup()

      this.initialized = true
      console.log('File cache service initialized')
    } catch (error) {
      console.error('Failed to initialize file cache service:', error)
      throw error
    }
  }

  async ensureDirectoryExists(dirPath) {
    try {
      await fs.access(dirPath)
    } catch {
      await fs.mkdir(dirPath, { recursive: true })
    }
  }

  async loadMetadata() {
    try {
      const metadataContent = await fs.readFile(this.metadataFile, 'utf-8')
      const metadataObj = JSON.parse(metadataContent)
      
      this.metadata = new Map()
      for (const [key, value] of Object.entries(metadataObj)) {
        this.metadata.set(key, {
          ...value,
          lastAccessed: new Date(value.lastAccessed),
          created: new Date(value.created)
        })
      }
    } catch (error) {
      // If metadata file doesn't exist or is corrupted, start fresh
      this.metadata = new Map()
      await this.saveMetadata()
    }
  }

  async saveMetadata() {
    try {
      const metadataObj = {}
      for (const [key, value] of this.metadata) {
        metadataObj[key] = {
          ...value,
          lastAccessed: value.lastAccessed.toISOString(),
          created: value.created.toISOString()
        }
      }
      
      await fs.writeFile(this.metadataFile, JSON.stringify(metadataObj, null, 2))
    } catch (error) {
      console.error('Failed to save metadata:', error)
      throw error
    }
  }

  generateCacheKey(filePath, connectionId) {
    const hash = crypto.createHash('md5')
    hash.update(`${connectionId}:${filePath}`)
    return hash.digest('hex')
  }

  getCacheFilePath(cacheKey) {
    return path.join(this.cacheDir, `${cacheKey}.cache`)
  }

  async getCachedFile(filePath, connectionId = 'default') {
    if (!this.initialized) {
      await this.initialize()
    }

    try {
      const cacheKey = this.generateCacheKey(filePath, connectionId)
      const metadata = this.metadata.get(cacheKey)

      if (!metadata) {
        return null // File not in cache
      }

      const cacheFilePath = this.getCacheFilePath(cacheKey)

      // Check if cache file exists
      try {
        await fs.access(cacheFilePath)
      } catch {
        // Cache file doesn't exist, remove metadata
        this.metadata.delete(cacheKey)
        await this.saveMetadata()
        return null
      }

      // Check if cache is expired
      const now = new Date()
      const age = now.getTime() - metadata.lastAccessed.getTime()
      if (age > this.maxFileAge) {
        // Cache expired, remove file and metadata
        await this.removeCachedFile(cacheKey)
        return null
      }

      // Update last accessed time
      metadata.lastAccessed = now
      await this.saveMetadata()

      // Read and return cached content
      const content = await fs.readFile(cacheFilePath, 'utf-8')
      return content
    } catch (error) {
      console.error('Error getting cached file:', error)
      throw error
    }
  }

  async setCachedFile(filePath, content, connectionId = 'default', metadata = {}) {
    if (!this.initialized) {
      await this.initialize()
    }

    try {
      const cacheKey = this.generateCacheKey(filePath, connectionId)
      const cacheFilePath = this.getCacheFilePath(cacheKey)
      const now = new Date()

      // Write content to cache file
      await fs.writeFile(cacheFilePath, content, 'utf-8')

      // Update metadata
      const fileMetadata = {
        originalPath: filePath,
        connectionId: connectionId,
        size: Buffer.byteLength(content, 'utf-8'),
        hash: this.generateContentHash(content),
        created: now,
        lastAccessed: now,
        ...metadata
      }

      this.metadata.set(cacheKey, fileMetadata)
      await this.saveMetadata()

      // Check if we need to clean up old files
      await this.cleanupIfNeeded()

      return cacheKey
    } catch (error) {
      console.error('Error setting cached file:', error)
      throw error
    }
  }

  async clearCachedFile(filePath, connectionId = 'default') {
    try {
      const cacheKey = this.generateCacheKey(filePath, connectionId)
      await this.removeCachedFile(cacheKey)
    } catch (error) {
      console.error('Error clearing cached file:', error)
      throw error
    }
  }

  async removeCachedFile(cacheKey) {
    try {
      const cacheFilePath = this.getCacheFilePath(cacheKey)
      
      // Remove cache file
      try {
        await fs.unlink(cacheFilePath)
      } catch (error) {
        // File might not exist, that's okay
      }

      // Remove metadata
      this.metadata.delete(cacheKey)
      await this.saveMetadata()
    } catch (error) {
      console.error('Error removing cached file:', error)
      throw error
    }
  }

  async clearAllCache() {
    try {
      // Remove all cache files
      const files = await fs.readdir(this.cacheDir)
      
      for (const file of files) {
        if (file.endsWith('.cache')) {
          await fs.unlink(path.join(this.cacheDir, file))
        }
      }

      // Clear metadata
      this.metadata.clear()
      await this.saveMetadata()

      console.log('All cache cleared')
    } catch (error) {
      console.error('Error clearing all cache:', error)
      throw error
    }
  }

  async cleanup() {
    try {
      const now = new Date()
      const keysToRemove = []

      // Find expired files
      for (const [key, metadata] of this.metadata) {
        const age = now.getTime() - metadata.lastAccessed.getTime()
        if (age > this.maxFileAge) {
          keysToRemove.push(key)
        }
      }

      // Remove expired files
      for (const key of keysToRemove) {
        await this.removeCachedFile(key)
      }

      if (keysToRemove.length > 0) {
        console.log(`Cleaned up ${keysToRemove.length} expired cache files`)
      }
    } catch (error) {
      console.error('Error during cleanup:', error)
    }
  }

  async cleanupIfNeeded() {
    try {
      const totalSize = await this.getTotalCacheSize()
      
      if (totalSize > this.maxCacheSize) {
        // Sort files by last accessed time (oldest first)
        const sortedEntries = Array.from(this.metadata.entries())
          .sort((a, b) => a[1].lastAccessed.getTime() - b[1].lastAccessed.getTime())

        // Remove oldest files until we're under the size limit
        let currentSize = totalSize
        for (const [key, metadata] of sortedEntries) {
          if (currentSize <= this.maxCacheSize * 0.8) { // Keep 20% buffer
            break
          }

          await this.removeCachedFile(key)
          currentSize -= metadata.size
        }

        console.log('Cache cleanup completed')
      }
    } catch (error) {
      console.error('Error during cleanup check:', error)
    }
  }

  async getTotalCacheSize() {
    try {
      let totalSize = 0
      for (const metadata of this.metadata.values()) {
        totalSize += metadata.size
      }
      return totalSize
    } catch (error) {
      console.error('Error calculating total cache size:', error)
      return 0
    }
  }

  generateContentHash(content) {
    return crypto.createHash('md5').update(content).digest('hex')
  }

  async getCacheStats() {
    try {
      const totalSize = await this.getTotalCacheSize()
      const fileCount = this.metadata.size
      
      return {
        totalSize,
        fileCount,
        maxCacheSize: this.maxCacheSize,
        maxFileAge: this.maxFileAge,
        cacheDir: this.cacheDir
      }
    } catch (error) {
      console.error('Error getting cache stats:', error)
      throw error
    }
  }

  async isFileCached(filePath, connectionId = 'default') {
    try {
      const cacheKey = this.generateCacheKey(filePath, connectionId)
      return this.metadata.has(cacheKey)
    } catch (error) {
      console.error('Error checking if file is cached:', error)
      return false
    }
  }

  async getFileHash(filePath, connectionId = 'default') {
    try {
      const cacheKey = this.generateCacheKey(filePath, connectionId)
      const metadata = this.metadata.get(cacheKey)
      return metadata ? metadata.hash : null
    } catch (error) {
      console.error('Error getting file hash:', error)
      return null
    }
  }
}

module.exports = { FileCacheService }