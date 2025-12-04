import React from 'react'
import { useEditorStore } from '../stores/editorStore'
import { useFTPStore } from '../stores/ftpStore'
import { FileText, Users, GitBranch } from 'lucide-react'
import { electronAPI } from '../utils/electronAPI'

const StatusBar: React.FC = () => {
  const { activeFile, openFiles, currentUserId, error, statusMessage } = useEditorStore()
  const { isConnected, currentPath } = useFTPStore()
  const [otherEditors, setOtherEditors] = React.useState<any[]>([])

  const currentFile = React.useMemo(
    () => openFiles.find((f) => f.id === activeFile) || null,
    [openFiles, activeFile],
  )

  React.useEffect(() => {
    let interval: number | undefined
    const loadPresence = async () => {
      if (!currentFile?.path || !currentUserId) {
        setOtherEditors([])
        return
      }
      const res = await electronAPI.dbGetActiveFiles()
      if (!res.success || !res.files) {
        setOtherEditors([])
        return
      }
      const others = res.files.filter(
        (f: any) => f.file_path === currentFile.path && f.user_id !== currentUserId,
      )
      setOtherEditors(others)
    }

    if (currentFile?.path && currentUserId) {
      loadPresence()
      interval = window.setInterval(loadPresence, 5000)
    } else {
      setOtherEditors([])
    }

    return () => {
      if (interval) {
        window.clearInterval(interval)
      }
    }
  }, [currentFile?.path, currentUserId])

  return (
    <div className="h-6 bg-vscode-statusBar border-t border-vscode-border flex items-center justify-between px-4 text-xs">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span>FTP {isConnected ? 'Connected' : 'Disconnected'}</span>
        </div>
        
        {activeFile && (
          <div className="flex items-center gap-1">
            <FileText size={12} />
            <span>{activeFile}</span>
          </div>
        )}
        
        {currentPath && (
          <div className="flex items-center gap-1">
            <span>{currentPath}</span>
          </div>
        )}
      </div>
      
      <div className="flex items-center gap-4">
        {currentFile && otherEditors.length > 0 && (
          <div className="flex items-center gap-1 text-vscode-text-muted">
            <Users size={12} />
            <span className="truncate" title={otherEditors.map((u: any) => u.username).join(', ')}>
              Also editing: {otherEditors.map((u: any) => u.username).join(', ')}
            </span>
          </div>
        )}

        {(error || statusMessage) && (
          <div className="max-w-xs truncate" title={error || statusMessage || undefined}>
            <span className={error ? 'text-red-400' : 'text-green-400'}>
              {error || statusMessage}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

export default StatusBar