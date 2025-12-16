import React, { useEffect, useState } from 'react'
import { electronAPI } from '../utils/electronAPI'
import { useEditorStore } from '../stores/editorStore'
import { DiffEditor } from '@monaco-editor/react'

const HistoryPanel: React.FC = () => {
  const { openFiles } = useEditorStore()
  const [pathInput, setPathInput] = useState<string>('')
  const [filePath, setFilePath] = useState<string>('')
  const [versions, setVersions] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [compare, setCompare] = useState<{ left: string; right: string; language: string; timestamp?: string; key: string } | null>(null)
  const [editedFiles, setEditedFiles] = useState<{ file_path: string; last_edit: string; version_count: number }[]>([])
  const [tab, setTab] = useState<'versions' | 'recent'>('versions')

  useEffect(() => {
    const current = openFiles.find(f => f.kind !== 'preview')
    if (current && current.path) {
      setPathInput(current.path)
      setFilePath(current.path)
    }
  }, [openFiles])

  const load = async (target: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await electronAPI.dbGetFileVersions?.(target, 50)
      if (res && res.success && Array.isArray(res.versions)) {
        setVersions(res.versions)
      } else {
        setVersions([])
        setError((res && (res as any).error) || 'Failed to load versions')
      }
    } catch (err) {
      setError('Failed to load versions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (filePath) {
      load(filePath)
    }
  }, [filePath])

  useEffect(() => {
    ;(async () => {
      try {
        const res = await electronAPI.dbGetEditedFiles?.(200)
        if (res && res.success && Array.isArray(res.files)) {
          setEditedFiles(res.files)
        }
      } catch {}
    })()
  }, [])

  const getLanguageFromExtension = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase()
    const map: Record<string, string> = {
      js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
      html: 'html', htm: 'html', css: 'css', scss: 'scss', sass: 'scss',
      json: 'json', md: 'markdown', xml: 'xml', yml: 'yaml', yaml: 'yaml'
    }
    return map[ext || ''] || 'plaintext'
  }

  const openCompare = async (v: any) => {
    try {
      let right = ''
      const editor = useEditorStore.getState()
      const opened = editor.openFiles.find((f) => f.path === v.file_path && (!f.kind || f.kind === 'code'))
      if (opened) {
        right = opened.content || ''
      } else {
        const dl = await electronAPI.ftpDownloadFile(v.file_path, undefined as any)
        if (dl && dl.success && typeof dl.content === 'string') {
          right = dl.content
        }
      }
      const left = String(v.content || '')
      const language = getLanguageFromExtension(String(v.file_path || ''))
      const key = `${String(v.id)}:${String(v.created_at || '')}:${String(v.file_path || '')}`
      setCompare({ left, right, language, timestamp: v.created_at, key })
    } catch (err) {
      setError('Failed to load current content for comparison')
    }
  }

  const basename = (p: string): string => {
    const s = String(p || '').replace(/\\/g, '/').replace(/\/+$/, '')
    const parts = s.split('/')
    return parts.pop() || s
  }

  const openRecentFile = async (p: string) => {
    try {
      const dl = await electronAPI.ftpDownloadFile(p, undefined as any)
      const content = dl && dl.success && typeof dl.content === 'string' ? dl.content : ''
      const lang = getLanguageFromExtension(basename(p))
      const editor = useEditorStore.getState()
      const existing = editor.openFiles.find((f) => f.path === p && (!f.kind || f.kind === 'code'))
      if (existing) {
        editor.setActiveFile(existing.id)
      } else {
        const now = new Date()
        editor.openFile({ id: p, path: p, name: basename(p), content, language: lang, isDirty: false, lastModified: now })
        editor.setActiveFile(p)
      }
      setPathInput(p)
      setFilePath(p)
      setTab('versions')
    } catch (err) {
      setError('Failed to open file')
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-vscode-border">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { const v = pathInput.trim(); setFilePath(v); } }}
            className="flex-1 px-2 py-1 bg-vscode-bg border border-vscode-border rounded text-xs"
            placeholder="/www/www/index.html"
          />
          <button
            className="px-2 py-1 text-xs rounded bg-vscode-sidebar hover:bg-vscode-hover border border-vscode-border"
            onClick={() => { const v = pathInput.trim(); if (v) setFilePath(v) }}
          >Load</button>
        </div>
      </div>
      <div className="p-2 border-t border-vscode-border flex items-center gap-2">
        <button
          className={`px-2 py-1 text-xs rounded border ${tab === 'versions' ? 'bg-vscode-selection text-white border-vscode-selection' : 'bg-vscode-sidebar border-vscode-border hover:bg-vscode-hover'}`}
          onClick={() => setTab('versions')}
        >Versions</button>
        <button
          className={`px-2 py-1 text-xs rounded border ${tab === 'recent' ? 'bg-vscode-selection text-white border-vscode-selection' : 'bg-vscode-sidebar border-vscode-border hover:bg-vscode-hover'}`}
          onClick={() => setTab('recent')}
        >Recent Edits</button>
      </div>
      {tab === 'versions' ? (
        <div className="flex-1 overflow-auto vscode-scrollbar">
          {loading ? (
            <div className="p-3 text-xs text-vscode-text-muted">Loading…</div>
          ) : error ? (
            <div className="p-3 text-xs text-red-400">{error}</div>
          ) : versions.length === 0 ? (
            <div className="p-3 text-xs text-vscode-text-muted">No versions</div>
          ) : (
            <div className="p-2 space-y-2">
              {versions.map((v, i) => (
                <div key={v.id} className="border border-vscode-border rounded p-2 text-xs bg-vscode-bg">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold">{i === 0 ? 'Current' : v.action}</span>
                      <span className="ml-2 text-vscode-text-muted">{new Date(v.created_at).toLocaleString()}</span>
                      {v.username && <span className="ml-2">by {v.username}</span>}
                    </div>
                    <div className="flex flex-col gap-1 items-end">
                      <button
                        className="px-2 py-1 rounded bg-vscode-sidebar hover:bg-vscode-hover border border-vscode-border"
                        onClick={async () => { await openCompare(v) }}
                      >Compare</button>
                      <button
                        className="px-2 py-1 rounded bg-vscode-sidebar hover:bg-vscode-hover border border-vscode-border"
                        onClick={async () => {
                          try {
                            const res = await electronAPI.dbRestoreFileVersion?.(v.id)
                            if (!res || !res.success) {
                              setError((res && (res as any).error) || 'Restore failed')
                            } else {
                              await load(filePath)
                            }
                          } catch (err) {
                            setError('Restore failed')
                          }
                        }}
                      >Restore</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-auto vscode-scrollbar">
          {editedFiles.length === 0 ? (
            <div className="p-3 text-xs text-vscode-text-muted">No recent edits</div>
          ) : (
            <div className="p-2 space-y-1">
              {editedFiles.map((f) => (
                <div key={f.file_path} className="flex items-center justify-between px-2 py-1 hover:bg-vscode-hover cursor-pointer rounded"
                  onClick={() => openRecentFile(f.file_path)}
                >
                  <span className="text-xs truncate flex-1">{basename(f.file_path)}</span>
                  <span className="ml-2 text-[11px] text-vscode-text-muted">{new Date(f.last_edit).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {compare && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50" onClick={() => setCompare(null)}>
          <div className="bg-vscode-bg border border-vscode-border rounded shadow-lg w-[1200px] max-w-[95vw] max-h-[90vh] p-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs">
                <span className="font-semibold">Compare</span>
                {compare.timestamp && <span className="ml-2 text-vscode-text-muted">Version: {new Date(compare.timestamp).toLocaleString()}</span>}
              </div>
              <button className="px-2 py-1 text-xs rounded bg-vscode-sidebar hover:bg-vscode-hover border border-vscode-border" onClick={() => setCompare(null)}>Close</button>
            </div>
            <div className="h-[70vh]">
              <DiffEditor
                key={compare.key}
                height="100%"
                original={compare.left}
                modified={compare.right}
                language={compare.language}
                theme="vs-dark"
                options={{ renderSideBySide: true, readOnly: true }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default HistoryPanel
