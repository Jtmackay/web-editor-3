import React, { useState, useEffect } from 'react'
import { FileText, Folder, Server, Users, Settings } from 'lucide-react'
import FTPExplorer from './FTPExplorer'
import UserPresence from './UserPresence'
import { electronAPI } from '../utils/electronAPI'

const Sidebar: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'files' | 'users' | 'settings'>('files')

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
      <div className="flex-1 w-64 flex flex-col">
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
    </div>
  )
}

const SettingsPanel: React.FC = () => {
  const [syncFolder, setSyncFolder] = useState('')
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
        const res = await electronAPI.settingsGetSyncFolder()
        if (mounted && res.success && res.path) {
          setSyncFolder(res.path)
        }
      } catch (err) {
        console.error('Failed to load sync folder', err)
        if (mounted) setError('Failed to load sync folder')
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
      const res = await electronAPI.settingsSetSyncFolder(syncFolder.trim())
      if (!res.success) {
        setError(res.error || 'Failed to save sync folder')
      } else {
        setStatus('Sync folder saved')
      }
    } catch (err) {
      console.error('Failed to save sync folder', err)
      setError('Failed to save sync folder')
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
    </div>
  )
}

export default Sidebar