import React, { useEffect, useRef, useState } from 'react'
import { useEditorStore } from '../stores/editorStore'
import MonacoEditor from './MonacoEditor'
import EditorTabs from './EditorTabs'

interface ElementsInspectorProps {
  root: Document | null
  element: Element | null
  onClose: () => void
}

const ElementsInspector: React.FC<ElementsInspectorProps> = ({ root, element, onClose }) => {
  if (!root || !element) {
    return null
  }

  const buildTagLabel = (el: Element) => {
    const tag = el.tagName.toLowerCase()
    const id = el.id ? `#${el.id}` : ''
    const className = (el.className && typeof el.className === 'string')
      ? '.' + el.className.trim().split(/\s+/).filter(Boolean).join('.')
      : ''
    return `${tag}${id}${className}`
  }

  const ancestors: Element[] = []
  let cursor: Element | null = element
  while (cursor) {
    ancestors.unshift(cursor)
    if (!cursor.parentElement) break
    cursor = cursor.parentElement
  }

  let computed: [string, string][] = []
  try {
    const win = root.defaultView
    if (win && element) {
      const styles = win.getComputedStyle(element)
      computed = Array.from(styles).map((prop) => [prop, styles.getPropertyValue(prop)])
    }
  } catch {
    computed = []
  }

  const [styleText, setStyleText] = useState('')

  useEffect(() => {
    if (!element) {
      setStyleText('')
      return
    }
    try {
      const anyEl = element as any
      const inlineStyle =
        (typeof anyEl.getAttribute === 'function' && anyEl.getAttribute('style')) ||
        (anyEl.style && anyEl.style.cssText) ||
        ''
      setStyleText(String(inlineStyle))
    } catch {
      setStyleText('')
    }
  }, [element])

  const applyInlineStyles = () => {
    if (!element) return
    try {
      const anyEl = element as any
      if (typeof anyEl.setAttribute === 'function') {
        anyEl.setAttribute('style', styleText)
      } else if (anyEl.style) {
        anyEl.style.cssText = styleText
      }
    } catch (err) {
      console.error('Failed to apply inline styles', err)
    }
  }

  return (
    <div className="h-64 border-t border-vscode-border bg-[#1e1e1e] text-xs text-gray-200 flex flex-col">
      <div className="flex items-center justify-between px-2 py-1 border-b border-vscode-border bg-[#252526]">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-gray-400">Elements</span>
          <span className="text-[11px] text-gray-500">
            {buildTagLabel(element)}
          </span>
        </div>
        <button
          className="px-2 py-0.5 rounded hover:bg-vscode-hover text-[11px]"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="w-2/3 border-r border-vscode-border overflow-auto p-2 font-mono text-[11px] leading-snug">
          {ancestors.map((el, idx) => {
            const isSelected = el === element
            const indent = idx * 8
            const tag = el.tagName.toLowerCase()
            const attrs: string[] = []
            Array.from(el.attributes).forEach((attr) => {
              if (!attr.name) return
              attrs.push(`${attr.name}="${attr.value}"`)
            })
            return (
              <div
                key={idx}
                className={`whitespace-nowrap ${isSelected ? 'bg-[#094771]' : ''}`}
                style={{ paddingLeft: indent }}
              >
                <span className="text-[#569cd6]">&lt;{tag}</span>
                {attrs.map((a, i) => {
                  const [name, ...rest] = a.split('=')
                  const value = rest.join('=')
                  return (
                    <span key={i}>
                      {' '}
                      <span className="text-[#9cdcfe]">{name}</span>
                      ={value}
                    </span>
                  )
                })}
                <span className="text-[#569cd6]">&gt;</span>
              </div>
            )
          })}
        </div>
        <div className="w-1/3 overflow-auto p-2 font-mono text-[11px] leading-snug">
          <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">Styles</div>
          {computed.slice(0, 200).map(([prop, value]) => (
            <div key={prop} className="flex">
              <span className="text-[#9cdcfe] min-w-[110px]">{prop}</span>
              <span className="text-gray-300 break-all">: {value}</span>
            </div>
          ))}
          {computed.length === 0 && (
            <div className="text-gray-500 mb-2">No styles available for this element.</div>
          )}
          <div className="mt-2 border-t border-vscode-border pt-2">
            <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">
              Inline style
            </div>
            <textarea
              className="w-full h-20 bg-[#1e1e1e] border border-vscode-border rounded text-[11px] p-1 text-gray-200 font-mono resize-none"
              spellCheck={false}
              value={styleText}
              onChange={(e) => setStyleText(e.target.value)}
              onBlur={applyInlineStyles}
            />
            <div className="mt-1 flex justify-end">
              <button
                className="px-2 py-0.5 rounded bg-vscode-hover hover:bg-vscode-border text-[11px]"
                type="button"
                onClick={applyInlineStyles}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const BrowserPreview: React.FC<{ url: string }> = ({ url }) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [inspectorRoot, setInspectorRoot] = useState<Document | null>(null)
  const [inspectorElement, setInspectorElement] = useState<Element | null>(null)
  const [inspectorSupported, setInspectorSupported] = useState<boolean | null>(null)

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    const attachContextMenuListener = () => {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document || null
        if (!doc) {
          setInspectorSupported(false)
          return
        }

        const handler = (ev: MouseEvent) => {
          ev.preventDefault()
          const target = ev.target as Element | null
          if (!target) return
          setInspectorRoot(doc)
          setInspectorElement(target)
        }

        doc.addEventListener('contextmenu', handler)

        ;(iframe as any).__elementsInspectorHandler = handler
        setInspectorSupported(true)
      } catch (err) {
        console.error('Failed to attach inspector listener (likely cross-origin)', err)
        setInspectorSupported(false)
      }
    }

    // Try once immediately (in case content is already loaded) and again on load.
    attachContextMenuListener()
    iframe.addEventListener('load', attachContextMenuListener)

    return () => {
      try {
        const handler = (iframe as any).__elementsInspectorHandler as ((ev: MouseEvent) => void) | undefined
        const doc = iframe.contentDocument || iframe.contentWindow?.document || null
        if (doc && handler) {
          doc.removeEventListener('contextmenu', handler)
        }
      } catch {
        // ignore cleanup errors
      }
      iframe.removeEventListener('load', attachContextMenuListener)
    }
  }, [url])

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
    <div className="h-full w-full flex flex-col">
      <div className="flex-1 relative">
        <iframe
          ref={iframeRef}
          src={url}
          className="w-full h-full border-0 bg-white"
          // Keep sandbox reasonably permissive for typical sites while still isolating content.
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        />
      </div>
      {inspectorSupported === false && (
        <div className="h-8 flex items-center px-3 border-t border-vscode-border bg-[#252526] text-[11px] text-gray-400">
          Element inspector is unavailable for this page (cross-origin). Use “View in browser” to inspect with DevTools.
        </div>
      )}
      {inspectorRoot && inspectorElement && (
        <ElementsInspector
          root={inspectorRoot}
          element={inspectorElement}
          onClose={() => {
            setInspectorRoot(null)
            setInspectorElement(null)
          }}
        />
      )}
    </div>
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