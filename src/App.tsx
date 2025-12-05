import React from 'react'
import AppLayout from './components/AppLayout'
import { electronAPI } from './utils/electronAPI'
import { useEditorStore } from './stores/editorStore'
import { useFTPStore } from './stores/ftpStore'

function App() {
  const { setCurrentUserId } = useEditorStore()

  const computeContentHash = async (content: string): Promise<string> => {
    try {
      const encoder = new TextEncoder()
      const data = encoder.encode(content)
      const digest = await window.crypto.subtle.digest('SHA-256', data)
      const bytes = Array.from(new Uint8Array(digest))
      return bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
    } catch {
      let hash = 0
      for (let i = 0; i < content.length; i++) {
        const chr = content.charCodeAt(i)
        hash = (hash << 5) - hash + chr
        hash |= 0
      }
      return hash.toString(16)
    }
  }
  React.useEffect(() => {
    let userId: number | null = null
    let statusInterval: number | undefined

    const handleBeforeUnload = () => {
      if (userId) {
        // Best-effort mark the user as offline when the window is closing.
        electronAPI.dbUpdateUserStatus(String(userId), 'offline')
      }
    }

    const init = async () => {
      const u = await electronAPI.dbGetOrCreateDefaultUser()
      if (u.success && u.user?.id) {
          userId = u.user.id
          setCurrentUserId(u.user.id)
          await electronAPI.dbUpdateUserStatus(String(u.user.id), 'online')

          // Refresh online status periodically so presence stays accurate.
          statusInterval = window.setInterval(() => {
            electronAPI.dbUpdateUserStatus(String(u.user.id), 'online')
          }, 60000)

          window.addEventListener('beforeunload', handleBeforeUnload)
      }
    }
    init()

    return () => {
      if (statusInterval) {
        window.clearInterval(statusInterval)
      }
      window.removeEventListener('beforeunload', handleBeforeUnload)
      if (userId) {
        electronAPI.dbUpdateUserStatus(String(userId), 'offline')
      }
    }
  }, [])

  React.useEffect(() => {
    const unsubscribe = electronAPI.onMenuEvent(async (_e: any, action: string) => {
      const state = useEditorStore.getState()
      if (action === 'menu-save-file') {
        const activeId = state.activeFile
        if (!activeId) return
        const file = state.openFiles.find(f => f.id === activeId)
        if (!file) return
        const res = await electronAPI.localSaveFile(file.path, file.content)
        if (res.success) {
          useEditorStore.getState().setFileDirty(file.id, false)
          useEditorStore.getState().setStatusMessage(`Saved to sync folder: ${file.path}`)
          useEditorStore.getState().setError(null)
        } else {
          useEditorStore.getState().setError(res.error || 'Failed to save file to sync folder')
          useEditorStore.getState().setStatusMessage(null)
        }
      } else if (action === 'menu-save-all') {
        let savedCount = 0
        let failed = false
        for (const file of state.openFiles) {
          if (file.isDirty) {
            const res = await electronAPI.localSaveFile(file.path, file.content)
            if (res.success) {
              useEditorStore.getState().setFileDirty(file.id, false)
            } else {
              useEditorStore.getState().setError(res.error || `Failed to save ${file.name} to sync folder`)
              failed = true
            }
            savedCount += res.success ? 1 : 0
          }
        }
        if (savedCount > 0 && !failed) {
          useEditorStore.getState().setStatusMessage(`Saved ${savedCount} file(s) to sync folder`)
          useEditorStore.getState().setError(null)
        }
      } else if (action === 'menu-save-and-sync') {
        const activeId = state.activeFile
        if (!activeId) return
        const file = state.openFiles.find(f => f.id === activeId)
        if (!file) return

        const uid = state.currentUserId
        let newHash: string | null = null

        if (uid) {
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
              const activeRecently = lastModifiedMs > now - 10 * 60 * 1000

              if (!activeRecently) continue

              if (otherHash && newHash && otherHash !== newHash) {
                conflictingUsers.push(other.username || `User #${other.user_id}`)
              } else if (!otherHash) {
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
          useEditorStore.getState().setError(localRes.error || 'Failed to save file to sync folder')
          useEditorStore.getState().setStatusMessage(null)
          return
        }
        const ftpRes = await electronAPI.ftpUploadFile(localRes.path, file.path)
        if (ftpRes.success) {
          useEditorStore.getState().setFileDirty(file.id, false)
          useEditorStore.getState().setStatusMessage(`Saved and synced to server: ${file.path}`)
          useEditorStore.getState().setError(null)
          if (uid) {
            try {
              const hashToStore = newHash ?? (await computeContentHash(file.content))
              await electronAPI.dbSetActiveFile(String(uid), file.path, hashToStore)
            } catch {
              // Best-effort only; ignore errors.
            }
          }
        } else {
          useEditorStore.getState().setError(ftpRes.error || 'File saved locally, but failed to sync to server')
          useEditorStore.getState().setStatusMessage(null)
        }
      } else if (action === 'menu-save-as') {
        const activeId = state.activeFile
        if (!activeId) return
        const file = state.openFiles.find(f => f.id === activeId)
        if (!file) return
        const nextPath = window.prompt('Enter new remote path for Save As', file.path)
        if (!nextPath || nextPath.trim() === '') return
        const res = await electronAPI.ftpUploadFile(file.content, nextPath.trim())
        if (res.success) {
          const parts = nextPath.trim().split('/')
          const newName = parts[parts.length - 1] || file.name
          useEditorStore.getState().renameFile(file.id, nextPath.trim(), newName)
          useEditorStore.getState().setFileDirty(nextPath.trim(), false)
        } else {
          useEditorStore.getState().setError(res.error || 'Failed to save as')
        }
      }
    })
    return () => { unsubscribe && unsubscribe() }
  }, [])
  return <AppLayout />
}

export default App

