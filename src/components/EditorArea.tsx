import React from 'react'
import { useEditorStore } from '../stores/editorStore'
import MonacoEditor from './MonacoEditor'
import EditorTabs from './EditorTabs'

const EditorArea: React.FC = () => {
  const { activeFile, openFiles } = useEditorStore()

  return (
    <div className="flex-1 flex flex-col bg-vscode-bg">
      <EditorTabs />
      <div className="flex-1">
        {activeFile ? (
          <MonacoEditor />
        ) : (
          <div className="flex items-center justify-center h-full text-vscode-text-muted">
            <div className="text-center">
              <h2 className="text-xl mb-2">VSCode Editor</h2>
              <p>Open a file from the FTP explorer to start editing</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default EditorArea