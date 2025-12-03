import React, { useState, useEffect } from 'react'
import { FileText, Server, Users, Settings, Search, ListChecks } from 'lucide-react'
import FTPExplorer from './FTPExplorer'
import UserPresence from './UserPresence'
import SearchPanel from './SearchPanel'
import TodoPanel from './TodoPanel'
import { electronAPI } from '../utils/electronAPI'

const Sidebar: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'files' | 'search' | 'todo' | 'users' | 'settings'>('files')
  const [panelWidth, setPanelWidth] = useState<number>(260)

  const handleResizeMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()

    const startX = e.clientX
    const startWidth = panelWidth
    const minWidth = 180
    const maxWidth = 600

    const onMouseMove = (event: MouseEvent) => {
      const delta = event.clientX - startX
      let next = startWidth + delta
      if (next < minWidth) next = minWidth
      if (next > maxWidth) next = maxWidth
      setPanelWidth(next)
    }

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  return (
    <div className="flex h-full bg-vscode-sidebar border-r border-vscode-border">
      {/* Activity Bar */}
      <div className="w-12 bg-vscode-activityBar flex flex-col items-center py-2 space-y-2">
        <button
          onClick={() => setActiveTab('files')}
          className={`p-2 rounded transition-colors ${
            activeTab === 'files' ? 'bg-vscode-selection text-white' : 'text-vscode-text-muted hover:bg-vscode-hover'
          }`}
          title="Files"
        >
          <FileText size={20} />
        </button>
        <button
          onClick={() => setActiveTab('search')}
          className={`p-2 rounded transition-colors ${
            activeTab === 'search' ? 'bg-vscode-selection text-white' : 'text-vscode-text-muted hover:bg-vscode-hover'
          }`}
          title="Search"
        >
          <Search size={20} />
        </button>
        <button
          onClick={() => setActiveTab('todo')}
          className={`p-2 rounded transition-colors ${
            activeTab === 'todo'
              ? 'bg-vscode-selection text-white'
              : 'text-vscode-text-muted hover:bg-vscode-hover'
          }`}
          title="To Do"
        >
          <ListChecks size={20} />
        </button>
        <button
          onClick={() => setActiveTab('users')}
          className={`p-2 rounded transition-colors ${
            activeTab === 'users' ? 'bg-vscode-selection text-white' : 'text-vscode-text-muted hover:bg-vscode-hover'
          }`}
          title="Users"
        >
          <Users size={20} />
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`p-2 rounded transition-colors ${
            activeTab === 'settings' ? 'bg-vscode-selection text-white' : 'text-vscode-text-muted hover:bg-vscode-hover'
          }`}
          title="Settings"
        >
          <Settings size={20} />
        </button>
      </div>

      {/* Side Panel */}
      <div className="flex flex-col h-full flex-shrink-0" style={{ width: panelWidth }}>
        {activeTab === 'files' && (
          <div className="flex flex-col h-full">
            <div className="p-3 border-b border-vscode-border">
              <h3 className="text-sm font-semibold text-vscode-text flex items-center gap-2">
                <Server size={16} />
                FTP Explorer
              </h3>
            </div>
            <FTPExplorer />
          </div>
        )}

        {activeTab === 'search' && (
          <div className="flex flex-col h-full">
            <div className="p-3 border-b border-vscode-border">
              <h3 className="text-sm font-semibold text-vscode-text">Search</h3>
            </div>
            <SearchPanel />
          </div>
        )}

        {activeTab === 'todo' && (
          <div className="flex flex-col h-full">
            <div className="p-3 border-b border-vscode-border">
              <h3 className="text-sm font-semibold text-vscode-text">To Do</h3>
            </div>
            <TodoPanel />
          </div>
        )}
        
        {activeTab === 'users' && (
          <div className="flex flex-col h-full">
            <div className="p-3 border-b border-vscode-border">
              <h3 className="text-sm font-semibold text-vscode-text">Team Members</h3>
            </div>
            <UserPresence />
          </div>
        )}
        
        {activeTab === 'settings' && (
          <div className="flex flex-col h-full">
            <div className="p-3 border-b border-vscode-border">
              <h3 className="text-sm font-semibold text-vscode-text">Settings</h3>
            </div>
            <SettingsPanel />
          </div>
        )}
      </div>
      {/* Resizer */}
      <div
        className="w-[3px] cursor-col-resize self-stretch bg-transparent hover:bg-vscode-border/80 active:bg-vscode-border"
        onMouseDown={handleResizeMouseDown}
      />
    </div>
  )
}

const SettingsPanel: React.FC = () => {
  const [syncFolder, setSyncFolder] = useState('')
  const [previewBaseUrl, setPreviewBaseUrl] = useState('')
  const [previewStartAfter, setPreviewStartAfter] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const [syncRes, baseUrlRes, startAfterRes] = await Promise.all([
          electronAPI.settingsGetSyncFolder(),
          electronAPI.settingsGetPreviewBaseUrl(),
          electronAPI.settingsGetPreviewStartAfter()
        ])
        if (mounted && syncRes.success && typeof syncRes.path === 'string') {
          setSyncFolder(syncRes.path)
        }
        if (mounted && baseUrlRes.success && typeof baseUrlRes.baseUrl === 'string') {
          setPreviewBaseUrl(baseUrlRes.baseUrl)
        }
        if (mounted && startAfterRes.success && typeof startAfterRes.startAfter === 'string') {
          setPreviewStartAfter(startAfterRes.startAfter)
        }
      } catch (err) {
        console.error('Failed to load sync folder', err)
        if (mounted) setError('Failed to load settings')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  const handleBrowse = async () => {
    setError(null)
    setStatus(null)
    // Only attempt folder picker if the Electron side has implemented it
    const hasPicker =
      typeof window !== 'undefined' &&
      (window as any).electronAPI &&
      typeof (window as any).electronAPI.settingsChooseSyncFolder === 'function'

    if (!hasPicker) {
      setError('Folder picker is not available. Please type the folder path manually.')
      return
    }

    try {
      const res = await electronAPI.settingsChooseSyncFolder()
      if (res.success && res.path) {
        setSyncFolder(res.path)
      } else if (!res.success && res.error) {
        setError(res.error)
      }
    } catch (err) {
      console.error('Failed to choose sync folder', err)
      setError('Failed to open folder picker')
    }
  }

  const handleSave = async () => {
    setError(null)
    setStatus(null)
    if (!syncFolder.trim()) {
      setError('Please enter a folder path')
      return
    }
    setSaving(true)
    try {
      const [syncRes, baseUrlRes, startAfterRes] = await Promise.all([
        electronAPI.settingsSetSyncFolder(syncFolder.trim()),
        electronAPI.settingsSetPreviewBaseUrl(previewBaseUrl.trim()),
        electronAPI.settingsSetPreviewStartAfter(previewStartAfter.trim())
      ])
      if (!syncRes.success) {
        setError(syncRes.error || 'Failed to save sync folder')
      } else if (!baseUrlRes.success) {
        setError(baseUrlRes.error || 'Failed to save preview base URL')
      } else if (!startAfterRes.success) {
        setError(startAfterRes.error || 'Failed to save preview start-after path')
      } else {
        setStatus('Settings saved')
      }
    } catch (err) {
      console.error('Failed to save settings', err)
      setError('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 text-sm text-vscode-text space-y-4">
      <section>
        <h4 className="font-semibold mb-1">FTP Sync</h4>
        <p className="text-vscode-text-muted mb-2">
          Choose the local folder where files from the current FTP connection should be synced.
        </p>
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={syncFolder}
            onChange={(e) => setSyncFolder(e.target.value)}
            className="flex-1 px-2 py-1 bg-vscode-bg border border-vscode-border rounded text-xs focus:outline-none focus:border-vscode-accent"
            placeholder="C:\path\to\local\folder"
          />
          <button
            type="button"
            onClick={handleBrowse}
            className="px-3 py-1 bg-vscode-hover text-xs rounded border border-vscode-border hover:bg-vscode-border transition-colors"
          >
            Browse…
          </button>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={`px-3 py-1 text-xs rounded ${
            saving ? 'bg-vscode-border text-vscode-text-muted' : 'bg-vscode-accent text-white hover:bg-blue-600'
          } transition-colors`}
        >
          {saving ? 'Saving…' : 'Save Sync Folder'}
        </button>
        {loading && (
          <div className="mt-1 text-xs text-vscode-text-muted">
            Loading current settings…
          </div>
        )}
        {error && (
          <div className="mt-1 text-xs text-red-400">
            {error}
          </div>
        )}
        {status && (
          <div className="mt-1 text-xs text-green-400">
            {status}
          </div>
        )}
      </section>
      <section>
        <h4 className="font-semibold mb-1">Preview in Browser</h4>
        <p className="text-vscode-text-muted mb-2">
          Configure how file paths on the server map to your website URLs for the “View in browser” option.
        </p>
        <div className="space-y-2">
          <div>
            <label className="block text-xs font-medium mb-1">Base URL</label>
            <input
              type="text"
              value={previewBaseUrl}
              onChange={(e) => setPreviewBaseUrl(e.target.value)}
              className="w-full px-2 py-1 bg-vscode-bg border border-vscode-border rounded text-xs focus:outline-none focus:border-vscode-accent"
              placeholder="www.novak-adapt.com"
            />
            <div className="mt-1 text-[11px] text-vscode-text-muted">
              Protocol is optional. For example, enter <code>www.novak-adapt.com</code> or <code>https://www.novak-adapt.com</code>.
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Start URL after</label>
            <input
              type="text"
              value={previewStartAfter}
              onChange={(e) => setPreviewStartAfter(e.target.value)}
              className="w-full px-2 py-1 bg-vscode-bg border border-vscode-border rounded text-xs focus:outline-none focus:border-vscode-accent"
              placeholder="www/www"
            />
            <div className="mt-1 text-[11px] text-vscode-text-muted">
              Remote paths before this segment are removed when building the URL.
              For example, a file at <code>www/www/catalog/transmissions/ax15.html</code> with{' '}
              <code>www/www</code> here becomes <code>/catalog/transmissions/ax15.html</code>.
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export default Sidebar