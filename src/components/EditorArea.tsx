import React from 'react'
import { useEditorStore } from '../stores/editorStore'
import MonacoEditor from './MonacoEditor'
import EditorTabs from './EditorTabs'

const BrowserPreview: React.FC<{ url: string }> = ({ url }) => {
  if (!url) {
    return (
      <div className="flex items-center justify-center h-full text-vscode-text-muted">
        <div className="text-center">
          <h2 className="text-xl mb-2">Preview</h2>
          <p>No preview URL available</p>
        </div>
      </div>
    )
  }

  return (
    <iframe
      src={url}
      className="w-full h-full border-0 bg-white"
      // Keep sandbox reasonably permissive for typical sites while still isolating content.
      sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
    />
  )
}

const EditorArea: React.FC = () => {
  const { activeFile, openFiles } = useEditorStore()
  const currentFile = openFiles.find((f) => f.id === activeFile) || null

  return (
    <div className="flex-1 flex flex-col bg-vscode-bg">
      <EditorTabs />
      <div className="flex-1">
        {currentFile ? (
          currentFile.kind === 'preview' ? (
            <BrowserPreview url={currentFile.previewUrl || ''} />
          ) : (
            <MonacoEditor />
          )
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