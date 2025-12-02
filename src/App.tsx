import React from 'react'
import AppLayout from './components/AppLayout'
import { electronAPI } from './utils/electronAPI'
import { useEditorStore } from './stores/editorStore'
import { useFTPStore } from './stores/ftpStore'

function App() {
  const { setCurrentUserId } = useEditorStore()
  React.useEffect(() => {
    const init = async () => {
      const u = await electronAPI.dbGetOrCreateDefaultUser()
      if (u.success && u.user?.id) {
        setCurrentUserId(u.user.id)
        await electronAPI.dbUpdateUserStatus(String(u.user.id), 'online')
      }
    }
    init()
  }, [])

  React.useEffect(() => {
    const unsubscribe = electronAPI.onMenuEvent(async (_e: any, action: string) => {
      const state = useEditorStore.getState()
      if (action === 'menu-save-file') {
        const activeId = state.activeFile
        if (!activeId) return
        const file = state.openFiles.find(f => f.id === activeId)
        if (!file) return
        const res = await electronAPI.ftpUploadFile(file.content, file.path)
        if (res.success) {
          useEditorStore.getState().setFileDirty(file.id, false)
        } else {
          useEditorStore.getState().setError(res.error || 'Failed to save file')
        }
      } else if (action === 'menu-save-all') {
        for (const file of state.openFiles) {
          if (file.isDirty) {
            const res = await electronAPI.ftpUploadFile(file.content, file.path)
            if (res.success) {
              useEditorStore.getState().setFileDirty(file.id, false)
            } else {
              useEditorStore.getState().setError(res.error || `Failed to save ${file.name}`)
            }
          }
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
      } else if (action === 'menu-go-to-page') {
        const editor = useEditorStore.getState()
        const ftp = useFTPStore.getState()
        const activeId = editor.activeFile
        if (!activeId) return
        const file = editor.openFiles.find(f => f.id === activeId)
        if (!file) return
        const connId = ftp.activeConnection
        const conn = connId ? ftp.connections.find(c => c.id === connId) : undefined
        const baseRaw = conn?.appendedUrl || ''
        if (!baseRaw) {
          window.alert('Appended URL is not set in FTP settings')
          return
        }
        const hasProtocol = /^https?:\/\//i.test(baseRaw)
        const base = (hasProtocol ? baseRaw : `https://${baseRaw}`).replace(/\/$/, '')
        const path = String(file.path || '').replace(/\\/g, '/').startsWith('/') ? String(file.path) : `/${String(file.path)}`
        const url = encodeURI(`${base}${path}`)
        await electronAPI.openExternalUrl(url)
      }
    })
    return () => { unsubscribe && unsubscribe() }
  }, [])
  return <AppLayout />
}

export default App
