import React, { useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { useEditorStore } from '../stores/editorStore'
import { electronAPI } from '../utils/electronAPI'

const MonacoEditor: React.FC = () => {
  const { openFiles, activeFile, updateFileContent } = useEditorStore()
  const editorRef = useRef<any>(null)
  const changeTimerRef = useRef<number | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  const currentFile = openFiles.find(f => f.id === activeFile)

  

  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor
    const selectionJustMadeRef: { current: boolean } = { current: false }
    
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
      formatOnType: false,
    })

    editor.onDidChangeModelContent(() => {
      if (changeTimerRef.current) {
        window.clearTimeout(changeTimerRef.current)
        changeTimerRef.current = null
      }
      changeTimerRef.current = window.setTimeout(() => {
        const state = useEditorStore.getState()
        const activeId = state.activeFile
        if (!activeId) return
        const file = state.openFiles.find((f) => f.id === activeId)
        if (!file) return
        const val = editor.getValue()
        if (typeof val === 'string' && val !== file.content) {
          state.updateFileContent(file.id, val)
        }
      }, 60)
    })

    editor.onDidChangeCursorSelection((e: any) => {
      try { editor.focus() } catch {}
      try {
        const sel = e?.selection || editor.getSelection?.()
        const hasSelection = sel && !sel.isEmpty?.()
        if (hasSelection) {
          selectionJustMadeRef.current = true
        }
      } catch {}
    })
    editor.onKeyDown?.((ev: any) => {
      try {
        if (!selectionJustMadeRef.current) return
        const be = ev?.browserEvent
        const key = be?.key || ''
        const ctrl = be?.ctrlKey || be?.metaKey
        const alt = be?.altKey
        const isPrintable = key && key.length === 1 && !ctrl && !alt
        if (!isPrintable) return
        selectionJustMadeRef.current = false
        ev.preventDefault?.()
        ev.stopPropagation?.()
        editor.trigger('keyboard', 'type', { text: key })
      } catch {}
    })
    editor.onDidFocusEditorText?.(() => {
      try { editor.focus() } catch {}
    })

    try {
      editor.addAction({
        id: 'insert-image-picker',
        label: 'Insert Image',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 1.5,
        run: async () => {
          try { window.dispatchEvent(new CustomEvent('open-image-picker-editor')) } catch {}
        }
      })
    } catch {}
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

  useEffect(() => {
    const onInsertHtml = (e: Event) => {
      try {
        const d = (e as CustomEvent).detail as any
        const html = d && typeof d.html === 'string' ? d.html : ''
        if (!html || !editorRef.current) return
        editorRef.current.trigger('keyboard', 'type', { text: html })
      } catch {}
    }
    window.addEventListener('insert-img-into-editor', onInsertHtml as any)
    return () => window.removeEventListener('insert-img-into-editor', onInsertHtml as any)
  }, [])

  

  useEffect(() => {
    if (!editorRef.current || !currentFile) return
    const model = editorRef.current.getModel?.()
    const current = model?.getValue?.()
    const hasFocus = editorRef.current.hasTextFocus?.()
    if (hasFocus) return
    if (typeof currentFile.content === 'string' && current !== currentFile.content) {
      model?.setValue?.(currentFile.content)
    }
  }, [currentFile?.content])

  useEffect(() => {
    if (!editorRef.current || !currentFile) return
    const model = editorRef.current.getModel?.()
    model?.setValue?.(currentFile.content)
  }, [currentFile?.id])
  

  if (!currentFile) {
    return null
  }

  return (
    <div className="h-full w-full" onContextMenu={(e) => {
      e.preventDefault()
      setContextMenu({ x: e.clientX, y: e.clientY })
    }}>
      <Editor
        height="100%"
        language={currentFile.language}
        defaultValue={currentFile.content}
        path={currentFile.id}
        saveViewState
        onMount={handleEditorDidMount}
        theme="vs-dark"
        options={{
          contextmenu: false,
          selectOnLineNumbers: true,
          matchBrackets: 'always',
          autoClosingBrackets: 'always',
          autoClosingQuotes: 'always',
          autoIndent: 'full',
          formatOnPaste: true,
          formatOnType: false,
          suggestOnTriggerCharacters: true,
          quickSuggestions: true,
          wordBasedSuggestions: true,
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
      {contextMenu && (
        <div
          className="fixed z-[250] bg-vscode-sidebar border border-vscode-border rounded shadow-lg text-sm"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="block w-full text-left px-3 py-1 hover:bg-vscode-hover"
            onClick={() => {
              setContextMenu(null)
              try { window.dispatchEvent(new CustomEvent('open-image-picker-editor')) } catch {}
            }}
          >
            Insert Image
          </button>
          <button
            className="block w-full text-left px-3 py-1 hover:bg-vscode-hover"
            onClick={() => setContextMenu(null)}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

export default MonacoEditor
