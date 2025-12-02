import React from 'react'
import { useEditorStore } from '../stores/editorStore'
import { useFTPStore } from '../stores/ftpStore'
import { FileText, Users, GitBranch } from 'lucide-react'

const StatusBar: React.FC = () => {
  const { activeFile } = useEditorStore()
  const { isConnected, currentPath } = useFTPStore()

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
        <div className="flex items-center gap-1">
          <Users size={12} />
          <span>1 user online</span>
        </div>
        
        <div className="flex items-center gap-1">
          <GitBranch size={12} />
          <span>main</span>
        </div>
        
        <div>
          <span>UTF-8</span>
        </div>
      </div>
    </div>
  )
}

export default StatusBar