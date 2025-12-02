import React from 'react'
import { X } from 'lucide-react'
import { useEditorStore } from '../stores/editorStore'
import { electronAPI } from '../utils/electronAPI'

const EditorTabs: React.FC = () => {
  const { openFiles, activeFile, closeFile, setActiveFile } = useEditorStore()

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
          onClick={() => setActiveFile(file.id)}
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
    </div>
  )
}

export default EditorTabs
