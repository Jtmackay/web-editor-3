import React, { useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { useEditorStore } from '../stores/editorStore'
import { electronAPI } from '../utils/electronAPI'

const MonacoEditor: React.FC<{ fileId?: string }> = ({ fileId }) => {
  const { openFiles, activeFile, updateFileContent } = useEditorStore()
  const editorRef = useRef<any>(null)
  const changeTimerRef = useRef<number | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [showAccordionDialog, setShowAccordionDialog] = useState(false)
  const findOpenRef = useRef<boolean>(false)

  const targetId = fileId || activeFile
  const currentFile = openFiles.find(f => f.id === targetId)

  

  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor
    const isFindVisible = (): boolean => {
      try {
        const ctrl = editor.getContribution?.('editor.contrib.findController')
        const state = ctrl?.getState?.()
        return !!state?.isVisible
      } catch {
        return false
      }
    }
    const isFindActive = (): boolean => {
      return !!findOpenRef.current || isFindVisible()
    }
    
    // Configure editor options to match VSCode
    editor.updateOptions({
      fontSize: 14,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif",
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
        const target = fileId || state.activeFile
        if (!target) return
        const file = state.openFiles.find((f) => f.id === target)
        if (!file) return
        const val = editor.getValue()
        if (typeof val === 'string' && val !== file.content) {
          state.updateFileContent(file.id, val)
        }
      }, 60)
    })

    editor.onDidChangeCursorSelection?.(() => {})
    editor.onKeyDown?.(() => {})

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

  // Removed custom find overlay and global key interception to match VSCode/Monaco behaviour

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
    <div
      className="h-full w-full"
      onContextMenu={(e) => {
      e.preventDefault()
      setContextMenu({ x: e.clientX, y: e.clientY })
    }}
    >
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
          wordBasedSuggestions: 'currentDocument',
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
          className="fixed z-[250] bg-vscode-sidebar border border-vscode-border rounded shadow-lg text-sm py-1 min-w-[160px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="relative group">
            <button
              className="flex items-center justify-between w-full text-left px-3 py-1 hover:bg-vscode-hover"
            >
              <span>Insert</span>
              <span className="text-[10px] opacity-70">▶</span>
            </button>
            {/* Submenu */}
            <div className="absolute left-full top-0 hidden group-hover:block bg-vscode-sidebar border border-vscode-border rounded shadow-lg min-w-[160px] py-1 -ml-1">
              <button
                className="block w-full text-left px-3 py-1 hover:bg-vscode-hover"
                onClick={() => {
                  setContextMenu(null)
                  setShowAccordionDialog(true)
                }}
              >
                Accordion
              </button>
              <button
                className="block w-full text-left px-3 py-1 hover:bg-vscode-hover"
                onClick={() => {
                  setContextMenu(null)
                  try { window.dispatchEvent(new CustomEvent('open-image-picker-editor')) } catch {}
                }}
              >
                Image
              </button>
            </div>
          </div>

          <div className="h-px bg-vscode-border/50 my-1 mx-2"></div>

          <button
            className="block w-full text-left px-3 py-1 hover:bg-vscode-hover"
            onClick={() => setContextMenu(null)}
          >
            Cancel
          </button>
        </div>
      )}

      {showAccordionDialog && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50" onClick={() => setShowAccordionDialog(false)}>
          <div className="bg-vscode-sidebar border border-vscode-border p-4 rounded shadow-lg w-96" onClick={e => e.stopPropagation()}>
            <h3 className="text-vscode-text font-bold mb-4">Insert Accordion</h3>
            <form onSubmit={(e) => {
              e.preventDefault()
              const formData = new FormData(e.currentTarget)
              const title = formData.get('title') as string
              let content = formData.get('content') as string
              const wrapInParagraph = formData.get('wrapInParagraph') === 'on'
              
              if (wrapInParagraph) {
                content = `<p>${content}</p>`
              }
              
              const html = `<div class="accordion"> \n   <h2 onclick="toggleAccordion(this)">${title}<span class="arrow">▼</span></h2> \n   <div class="accordion-content"> \n     ${content} \n   </div> \n </div>`
              
              if (editorRef.current) {
                  editorRef.current.trigger('keyboard', 'type', { text: html })
              }
              setShowAccordionDialog(false)
            }}>
              <div className="mb-3">
                <label className="block text-vscode-text-muted text-xs mb-1">Header</label>
                <input name="title" autoFocus className="w-full px-2 py-1 bg-vscode-bg border border-vscode-border rounded text-sm focus:outline-none focus:border-vscode-accent text-vscode-text" />
              </div>
              <div className="mb-3">
                <label className="block text-vscode-text-muted text-xs mb-1">Content</label>
                <textarea name="content" rows={3} className="w-full px-2 py-1 bg-vscode-bg border border-vscode-border rounded text-sm focus:outline-none focus:border-vscode-accent text-vscode-text" />
              </div>
              <div className="mb-4 flex items-center gap-2">
                <input type="checkbox" id="wrapInParagraph" name="wrapInParagraph" className="bg-vscode-bg border border-vscode-border rounded" />
                <label htmlFor="wrapInParagraph" className="text-vscode-text text-sm select-none">Wrap content in paragraph</label>
              </div>
              <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setShowAccordionDialog(false)} className="px-3 py-1 text-sm text-vscode-text hover:bg-vscode-hover rounded">Cancel</button>
                  <button type="submit" className="px-3 py-1 text-sm bg-vscode-selection text-white rounded hover:bg-opacity-90">Insert</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default MonacoEditor
