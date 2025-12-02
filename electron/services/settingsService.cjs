const Store = require('electron-store')

class SettingsService {
  constructor() {
    this.store = new Store({ name: 'settings' })
  }
  getFTPConnections() {
    return this.store.get('ftpConnections', [])
  }
  addFTPConnection(conn) {
    const list = this.getFTPConnections()
    const id = conn.id || Date.now()
    const item = { id, ...conn, createdAt: new Date().toISOString() }
    this.store.set('ftpConnections', [...list, item])
    return item
  }
  removeFTPConnection(id) {
    const list = this.getFTPConnections().filter(c => String(c.id) !== String(id))
    this.store.set('ftpConnections', list)
    return true
  }
  getFTPPassword(id) {
    const list = this.getFTPConnections()
    const found = list.find(c => String(c.id) === String(id))
    return found ? found.password || '' : ''
  }
  getSyncIgnorePatterns() {
    return this.store.get('syncIgnorePatterns', [])
  }
  setSyncIgnorePatterns(patterns) {
    const safe = Array.isArray(patterns) ? patterns.map(p => String(p)) : []
    this.store.set('syncIgnorePatterns', safe)
    return safe
  }
  getSyncFolder() {
    return this.store.get('syncFolder', '')
  }
  setSyncFolder(folderPath) {
    const normalized = folderPath ? String(folderPath) : ''
    this.store.set('syncFolder', normalized)
    return normalized
  }
}

module.exports = { SettingsService }

