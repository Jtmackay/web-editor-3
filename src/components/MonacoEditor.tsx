import React, { useEffect, useRef } from 'react'
import Editor from '@monaco-editor/react'
import { useEditorStore } from '../stores/editorStore'
import { electronAPI } from '../utils/electronAPI'

const MonacoEditor: React.FC = () => {
  const { openFiles, activeFile, updateFileContent } = useEditorStore()
  const editorRef = useRef<any>(null)

  const currentFile = openFiles.find(f => f.id === activeFile)

  

  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor
    
    // Configure editor options to match VSCode
    editor.updateOptions({
      fontSize: 14,
      fontFamily: 'Monaco, Menlo, Ubuntu Mono, monospace',
      lineNumbers: 'on',
      renderLineHighlight: 'line',
      scrollBeyondLastLine: false,
      minimap: { enabled: true },
      wordWrap: 'on',
      automaticLayout: true,
      tabSize: 2,
      insertSpaces: true,
      detectIndentation: true,
      trimAutoWhitespace: true,
      formatOnPaste: true,
      formatOnType: true,
    })
  }

  useEffect(() => {
    const unsubscribe = electronAPI.onMenuEvent((_e: any, action: string) => {
      if (!editorRef.current) return
      if (action === 'menu-find') {
        const a = editorRef.current.getAction('actions.find')
        a && a.run()
      }
      if (action === 'menu-replace') {
        const a = editorRef.current.getAction('editor.action.startFindReplaceAction')
        a && a.run()
      }
    })
    return () => { unsubscribe && unsubscribe() }
  }, [])

  const handleEditorChange = (value: string | undefined) => {
    if (currentFile && value !== undefined) {
      if (value !== currentFile.content) {
        updateFileContent(currentFile.id, value)
      }
    }
  }

  if (!currentFile) {
    return null
  }

  return (
    <div className="h-full w-full">
      <Editor
        height="100%"
        language={currentFile.language}
        value={currentFile.content}
        onChange={handleEditorChange}
        onMount={handleEditorDidMount}
        theme="vs-dark"
        options={{
          selectOnLineNumbers: true,
          matchBrackets: 'always',
          autoClosingBrackets: 'always',
          autoClosingQuotes: 'always',
          autoIndent: 'full',
          formatOnPaste: true,
          formatOnType: true,
          suggestOnTriggerCharacters: true,
          quickSuggestions: true,
          wordBasedSuggestions: 'allDocuments',
          parameterHints: { enabled: true },
          hover: { enabled: true },
          folding: true,
          foldingStrategy: 'auto',
          showFoldingControls: 'always',
          unfoldOnClickAfterEndOfLine: true,
          smoothScrolling: true,
          cursorBlinking: 'blink',
          cursorSmoothCaretAnimation: 'on',
          multiCursorModifier: 'ctrlCmd',
          renderWhitespace: 'selection',
          bracketPairColorization: { enabled: true },
          guides: {
            indentation: true,
            highlightActiveIndentation: true,
            bracketPairs: true
          }
        }}
      />
    </div>
  )
}

export default MonacoEditor
