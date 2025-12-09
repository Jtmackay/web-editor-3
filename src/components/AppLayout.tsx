import React from 'react'
import Sidebar from './Sidebar'
import EditorArea from './EditorArea'
import StatusBar from './StatusBar'

const AppLayout: React.FC = () => {
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
  return (
    <div className="flex flex-col h-screen bg-vscode-bg text-vscode-text">
      {isMac && (
        <div className="h-8 drag-region" />
      )}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <EditorArea />
      </div>
      <StatusBar />
    </div>
  )
}

export default AppLayout
