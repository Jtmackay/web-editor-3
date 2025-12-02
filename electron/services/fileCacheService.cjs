const fs = require('fs').promises
const path = require('path')
const crypto = require('crypto')
const { app } = require('electron')

class FileCacheService {
  constructor() { this.cacheDir = null; this.metadataFile = null; this.metadata = new Map(); this.maxCacheSize = 100 * 1024 * 1024; this.maxFileAge = 24 * 60 * 60 * 1000; this.initialized = false }
  async initialize() { const userDataPath = app.getPath('userData'); this.cacheDir = path.join(userDataPath, 'file-cache'); this.metadataFile = path.join(this.cacheDir, 'metadata.json'); await this.ensureDirectoryExists(this.cacheDir); await this.loadMetadata(); await this.cleanup(); this.initialized = true }
  async ensureDirectoryExists(dirPath) { try { await fs.access(dirPath) } catch { await fs.mkdir(dirPath, { recursive: true }) } }
  async loadMetadata() { try { const metadataContent = await fs.readFile(this.metadataFile, 'utf-8'); const metadataObj = JSON.parse(metadataContent); this.metadata = new Map(); for (const [key, value] of Object.entries(metadataObj)) { this.metadata.set(key, { ...value, lastAccessed: new Date(value.lastAccessed), created: new Date(value.created) }) } } catch { this.metadata = new Map(); await this.saveMetadata() } }
  async saveMetadata() { const metadataObj = {}; for (const [key, value] of this.metadata) { metadataObj[key] = { ...value, lastAccessed: value.lastAccessed.toISOString(), created: value.created.toISOString() } } await fs.writeFile(this.metadataFile, JSON.stringify(metadataObj, null, 2)) }
  generateCacheKey(filePath, connectionId) { const hash = crypto.createHash('md5'); hash.update(`${connectionId}:${filePath}`); return hash.digest('hex') }
  getCacheFilePath(cacheKey) { return path.join(this.cacheDir, `${cacheKey}.cache`) }
  async getCachedFile(filePath, connectionId = 'default') { if (!this.initialized) { await this.initialize() } const cacheKey = this.generateCacheKey(filePath, connectionId); const metadata = this.metadata.get(cacheKey); if (!metadata) { return null } const cacheFilePath = this.getCacheFilePath(cacheKey); try { await fs.access(cacheFilePath) } catch { this.metadata.delete(cacheKey); await this.saveMetadata(); return null } const now = new Date(); const age = now.getTime() - metadata.lastAccessed.getTime(); if (age > this.maxFileAge) { await this.removeCachedFile(cacheKey); return null } metadata.lastAccessed = now; await this.saveMetadata(); const content = await fs.readFile(cacheFilePath, 'utf-8'); return content }
  async setCachedFile(filePath, content, connectionId = 'default', metadata = {}) { if (!this.initialized) { await this.initialize() } const cacheKey = this.generateCacheKey(filePath, connectionId); const cacheFilePath = this.getCacheFilePath(cacheKey); const now = new Date(); await fs.writeFile(cacheFilePath, content, 'utf-8'); const fileMetadata = { originalPath: filePath, connectionId, size: Buffer.byteLength(content, 'utf-8'), hash: this.generateContentHash(content), created: now, lastAccessed: now, ...metadata }; this.metadata.set(cacheKey, fileMetadata); await this.saveMetadata(); await this.cleanupIfNeeded(); return cacheKey }
  async clearCachedFile(filePath, connectionId = 'default') { const cacheKey = this.generateCacheKey(filePath, connectionId); await this.removeCachedFile(cacheKey) }
  async removeCachedFile(cacheKey) { const cacheFilePath = this.getCacheFilePath(cacheKey); try { await fs.unlink(cacheFilePath) } catch {} this.metadata.delete(cacheKey); await this.saveMetadata() }
  async clearAllCache() { const files = await fs.readdir(this.cacheDir); for (const file of files) { if (file.endsWith('.cache')) { await fs.unlink(path.join(this.cacheDir, file)) } } this.metadata.clear(); await this.saveMetadata() }
  async cleanup() { const now = new Date(); const keysToRemove = []; for (const [key, metadata] of this.metadata) { const age = now.getTime() - metadata.lastAccessed.getTime(); if (age > this.maxFileAge) { keysToRemove.push(key) } } for (const key of keysToRemove) { await this.removeCachedFile(key) } }
  async cleanupIfNeeded() { const totalSize = await this.getTotalCacheSize(); if (totalSize > this.maxCacheSize) { const sortedEntries = Array.from(this.metadata.entries()).sort((a, b) => a[1].lastAccessed.getTime() - b[1].lastAccessed.getTime()); let currentSize = totalSize; for (const [key, metadata] of sortedEntries) { if (currentSize <= this.maxCacheSize * 0.8) { break } await this.removeCachedFile(key); currentSize -= metadata.size } } }
  async getTotalCacheSize() { let totalSize = 0; for (const metadata of this.metadata.values()) { totalSize += metadata.size } return totalSize }
  generateContentHash(content) { return crypto.createHash('md5').update(content).digest('hex') }
  async getCacheStats() { const totalSize = await this.getTotalCacheSize(); const fileCount = this.metadata.size; return { totalSize, fileCount, maxCacheSize: this.maxCacheSize, maxFileAge: this.maxFileAge, cacheDir: this.cacheDir } }
  async isFileCached(filePath, connectionId = 'default') { const cacheKey = this.generateCacheKey(filePath, connectionId); return this.metadata.has(cacheKey) }
  async getFileHash(filePath, connectionId = 'default') { const cacheKey = this.generateCacheKey(filePath, connectionId); const metadata = this.metadata.get(cacheKey); return metadata ? metadata.hash : null }
}

module.exports = { FileCacheService }

