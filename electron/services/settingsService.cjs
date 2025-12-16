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
  getDriftWatchEnabled() {
    return !!this.store.get('driftWatchEnabled', true)
  }
  setDriftWatchEnabled(enabled) {
    const v = !!enabled
    this.store.set('driftWatchEnabled', v)
    return v
  }
  getDriftWatchIntervalMinutes() {
    const v = Number(this.store.get('driftWatchIntervalMinutes', 60))
    return isNaN(v) ? 60 : Math.max(5, v)
  }
  setDriftWatchIntervalMinutes(mins) {
    const v = Number(mins)
    const safe = isNaN(v) ? 60 : Math.max(5, v)
    this.store.set('driftWatchIntervalMinutes', safe)
    return safe
  }
  getDriftPolicy() {
    const raw = String(this.store.get('driftPolicy', 'alert'))
    return raw === 'auto_restore' ? 'auto_restore' : 'alert'
  }
  setDriftPolicy(policy) {
    const val = policy === 'auto_restore' ? 'auto_restore' : 'alert'
    this.store.set('driftPolicy', val)
    return val
  }
  getProtectedPaths() {
    const list = this.store.get('protectedPaths', [])
    return Array.isArray(list) ? list.map(String) : []
  }
  setProtectedPaths(paths) {
    const safe = Array.isArray(paths) ? paths.map(String) : []
    this.store.set('protectedPaths', safe)
    return safe
  }
  getAutoSnapshotOnPublish() {
    return !!this.store.get('autoSnapshotOnPublish', false)
  }
  setAutoSnapshotOnPublish(enabled) {
    const v = !!enabled
    this.store.set('autoSnapshotOnPublish', v)
    return v
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
