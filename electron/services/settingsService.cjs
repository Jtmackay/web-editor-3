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
  getSyncHideIgnoredInExplorer() {
    return !!this.store.get('syncHideIgnoredInExplorer', false)
  }
  setSyncHideIgnoredInExplorer(hide) {
    const value = !!hide
    this.store.set('syncHideIgnoredInExplorer', value)
    return value
  }
  getSyncHiddenPaths() {
    const raw = this.store.get('syncHiddenPaths', [])
    return Array.isArray(raw) ? raw.map(p => String(p)) : []
  }
  setSyncHiddenPaths(paths) {
    const safe = Array.isArray(paths) ? paths.map(p => String(p)) : []
    this.store.set('syncHiddenPaths', safe)
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
  getPreviewBaseUrl() {
    return this.store.get('previewBaseUrl', '')
  }
  setPreviewBaseUrl(baseUrl) {
    const normalized = baseUrl ? String(baseUrl).trim() : ''
    this.store.set('previewBaseUrl', normalized)
    return normalized
  }
  getPreviewStartAfter() {
    return this.store.get('previewStartAfter', '')
  }
  setPreviewStartAfter(startAfter) {
    const normalized = startAfter ? String(startAfter).trim() : ''
    this.store.set('previewStartAfter', normalized)
    return normalized
  }
  getEditorName() {
    return this.store.get('editorName', '')
  }
  setEditorName(name) {
    const normalized = name ? String(name).trim() : ''
    this.store.set('editorName', normalized)
    return { name: normalized }
  }
  getEnablePreviewInspector() {
    return !!this.store.get('enablePreviewInspector', true)
  }
  setEnablePreviewInspector(enabled) {
    const value = !!enabled
    this.store.set('enablePreviewInspector', value)
    return value
  }
  getImagePickerStartPath() {
    const raw = this.store.get('imagePickerStartPath', '/')
    let p = raw ? String(raw) : '/'
    p = p.replace(/\\/g, '/')
    if (!p.startsWith('/')) p = '/' + p
    return p
  }
  setImagePickerStartPath(path) {
    let p = path ? String(path) : '/'
    p = p.replace(/\\/g, '/')
    if (!p.startsWith('/')) p = '/' + p
    this.store.set('imagePickerStartPath', p)
    return p
  }
}

module.exports = { SettingsService }
