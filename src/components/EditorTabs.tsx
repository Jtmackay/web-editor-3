import React, { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useEditorStore, EditorFile } from '../stores/editorStore'
import { electronAPI } from '../utils/electronAPI'

const EditorTabs: React.FC = () => {
  const { openFiles, activeFile, closeFile, setActiveFile } = useEditorStore()
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: EditorFile } | null>(null)

  useEffect(() => {
    const handleGlobalClick = () => setContextMenu(null)
    window.addEventListener('click', handleGlobalClick)
    return () => window.removeEventListener('click', handleGlobalClick)
  }, [])

  const buildPreviewUrlForPath = async (rawPath: string): Promise<string | null> => {
    const normalizedPath = String(rawPath || '').replace(/\\/g, '/')

    const [baseRes, startAfterRes] = await Promise.all([
      electronAPI.settingsGetPreviewBaseUrl(),
      electronAPI.settingsGetPreviewStartAfter()
    ])

    if (!baseRes.success) {
      window.alert(baseRes.error || 'Failed to load preview base URL from settings')
      return null
    }

    const baseRaw = (baseRes.baseUrl || '').trim()
    if (!baseRaw) {
      window.alert('Base URL is not configured. Set it in the Settings tab.')
      return null
    }

    const hasProtocol = /^https?:\/\//i.test(baseRaw)
    const base = (hasProtocol ? baseRaw : `https://${baseRaw}`).replace(/\/+$/, '')

    let urlPath = normalizedPath
    const startAfterRaw = (startAfterRes.success && startAfterRes.startAfter) ? startAfterRes.startAfter : ''
    const startAfter = startAfterRaw.replace(/\\/g, '/').replace(/^\/+/, '')

    if (startAfter) {
      const relative = normalizedPath.replace(/^\/+/, '')
      const lowerRelative = relative.toLowerCase()
      const lowerStart = startAfter.toLowerCase()
      if (lowerRelative.startsWith(lowerStart + '/') || lowerRelative === lowerStart) {
        let trimmed = relative.slice(startAfter.length)
        trimmed = trimmed.replace(/^\/+/, '')
        urlPath = '/' + trimmed
      } else {
        urlPath = normalizedPath.startsWith('/') ? normalizedPath : '/' + normalizedPath
      }
    } else {
      urlPath = normalizedPath.startsWith('/') ? normalizedPath : '/' + normalizedPath
    }

    const url = encodeURI(`${base}${urlPath}`)
    return url
  }

  const handleViewInBrowser = async (file: EditorFile) => {
    const path = file.path || ''
    const url = await buildPreviewUrlForPath(path)
    if (!url) return
    await electronAPI.openExternalUrl(url)
  }

  const handleViewInTab = async (file: EditorFile) => {
    const path = file.path || ''
    const url = await buildPreviewUrlForPath(path)
    if (!url) return

    const editor = useEditorStore.getState()
    const previewId = `preview:${url}`
    const existing = editor.openFiles.find((f) => f.id === previewId)
    const now = new Date()

    if (existing) {
      editor.setActiveFile(previewId)
      return
    }

    editor.openFile({
      id: previewId,
      path,
      name: `${file.name} (Preview)`,
      content: '',
      language: 'plaintext',
      isDirty: false,
      lastModified: now,
      kind: 'preview',
      previewUrl: url
    })
    editor.setActiveFile(previewId)
  }

  const computeContentHash = async (content: string): Promise<string> => {
    try {
      const encoder = new TextEncoder()
      const data = encoder.encode(content)
      const digest = await window.crypto.subtle.digest('SHA-256', data)
      const bytes = Array.from(new Uint8Array(digest))
      return bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
    } catch {
      // Fallback: simple, non-cryptographic hash
      let hash = 0
      for (let i = 0; i < content.length; i++) {
        const chr = content.charCodeAt(i)
        hash = (hash << 5) - hash + chr
        hash |= 0
      }
      return hash.toString(16)
    }
  }

  const handleSaveFile = async (file: EditorFile) => {
    if (file.kind === 'preview') return
    const res = await electronAPI.localSaveFile(file.path, file.content)
    if (res.success) {
      const store = useEditorStore.getState()
      store.setFileDirty(file.id, false)
      store.setStatusMessage(`Saved to sync folder: ${file.path}`)
      store.setError(null)
      try { window.dispatchEvent(new CustomEvent('preview:reload')) } catch {}
    } else {
      const store = useEditorStore.getState()
      store.setError(res.error || 'Failed to save file to sync folder')
      store.setStatusMessage(null)
    }
  }

  const handleSaveAndSync = async (file: EditorFile) => {
    if (file.kind === 'preview') return
    const store = useEditorStore.getState()

    const uid = store.currentUserId
    let newHash: string | null = null

    if (uid) {
      // Compute the hash we are about to save and check for potential conflicts.
      newHash = await computeContentHash(file.content)
      const activeRes = await electronAPI.dbGetActiveFiles()
      if (activeRes.success && activeRes.files) {
        const now = Date.now()
        const others = activeRes.files.filter(
          (f: any) => f.file_path === file.path && f.user_id !== uid,
        )
        const conflictingUsers: string[] = []
        for (const other of others) {
          const otherHash: string | null = other.file_hash || null
          const lastModifiedMs = other.last_modified
            ? new Date(other.last_modified as string).getTime()
            : 0
          const activeRecently = lastModifiedMs > now - 10 * 60 * 1000 // last 10 minutes

          if (!activeRecently) continue

          if (otherHash && newHash && otherHash !== newHash) {
            conflictingUsers.push(other.username || `User #${other.user_id}`)
          } else if (!otherHash) {
            // We know someone else has the file open and was active recently,
            // but we don't know their content; still worth a warning.
            conflictingUsers.push(other.username || `User #${other.user_id}`)
          }
        }

        if (conflictingUsers.length > 0) {
          const proceed = window.confirm(
            `Warning: ${conflictingUsers.join(
              ', ',
            )} also ha${conflictingUsers.length === 1 ? 's' : 've'
            } recent changes on this file.\n\n` +
              'Saving now may overwrite their edits.\n\n' +
              'Do you want to continue and upload your version?',
          )
          if (!proceed) {
            return
          }
        }
      }
    }

    const localRes = await electronAPI.localSaveFile(file.path, file.content)
    if (!localRes.success || !localRes.path) {
      store.setError(localRes.error || 'Failed to save file to sync folder')
      store.setStatusMessage(null)
      return
    }
    const ftpRes = await electronAPI.ftpUploadFile(localRes.path, file.path)
    if (ftpRes.success) {
      store.setFileDirty(file.id, false)
      store.setStatusMessage(`Saved and synced to server: ${file.path}`)
      store.setError(null)
       try { window.dispatchEvent(new CustomEvent('preview:reload')) } catch {}
      if (uid) {
        try {
          const hashToStore = newHash ?? (await computeContentHash(file.content))
          await electronAPI.dbSetActiveFile(String(uid), file.path, hashToStore)
        } catch {
          // Presence/hash updates are best-effort; ignore errors here.
        }
      }
    } else {
      store.setError(ftpRes.error || 'File saved locally, but failed to sync to server')
      store.setStatusMessage(null)
    }
  }

  if (openFiles.length === 0) {
    return null
  }

  return (
    <div className="flex bg-vscode-sidebar border-b border-vscode-border">
      {openFiles.map((file) => (
        <div
          key={file.id}
          className={`flex items-center gap-2 px-3 py-2 border-r border-vscode-border cursor-pointer transition-colors ${
            activeFile === file.id
              ? 'bg-vscode-bg text-vscode-text'
              : 'bg-vscode-sidebar text-vscode-text-muted hover:bg-vscode-hover'
          }`}
          onClick={async () => {
            setActiveFile(file.id)
            if (!file.kind || file.kind === 'code') {
              const uid = useEditorStore.getState().currentUserId
              if (uid) {
                try {
                  const hash = await computeContentHash(file.content)
                  await electronAPI.dbSetActiveFile(String(uid), file.path, hash)
                } catch {
                  // Presence updates are best-effort.
                }
              }
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            setContextMenu({ x: e.clientX, y: e.clientY, file })
          }}
        >
          <span className="text-sm">{file.name}</span>
          {file.isDirty && (
            <div className="w-2 h-2 bg-orange-500 rounded-full" />
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              const uid = useEditorStore.getState().currentUserId
              if (uid) {
                electronAPI.dbRemoveActiveFile(String(uid), file.path)
              }
              closeFile(file.id)
            }}
            className="p-1 hover:bg-vscode-border rounded transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      ))}
      {contextMenu && (
        <div
          className="fixed z-50 bg-vscode-sidebar border border-vscode-border rounded shadow-lg text-xs"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {(!contextMenu.file.kind || contextMenu.file.kind === 'code') && (
            <>
              <button
                className="block w-full text-left px-3 py-1 hover:bg-vscode-hover"
                onClick={async () => {
                  await handleSaveFile(contextMenu.file)
                  setContextMenu(null)
                }}
              >
                Save
              </button>
              <button
                className="block w-full text-left px-3 py-1 hover:bg-vscode-hover"
                onClick={async () => {
                  await handleSaveAndSync(contextMenu.file)
                  setContextMenu(null)
                }}
              >
                Save and Sync to Server
              </button>
              <div className="h-px bg-vscode-border/50 my-1" />
            </>
          )}
          <button
            className="block w-full text-left px-3 py-1 hover:bg-vscode-hover"
            onClick={async () => {
              await handleViewInBrowser(contextMenu.file)
              setContextMenu(null)
            }}
          >
            View in browser
          </button>
          <button
            className="block w-full text-left px-3 py-1 hover:bg-vscode-hover"
            onClick={async () => {
              await handleViewInTab(contextMenu.file)
              setContextMenu(null)
            }}
          >
            View in tab
          </button>
        </div>
      )}
    </div>
  )
}

export default EditorTabs
