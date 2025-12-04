import React, { useRef, useEffect, useState } from 'react'
import { useEditorStore } from '../stores/editorStore'
import MonacoEditor from './MonacoEditor'
import EditorTabs from './EditorTabs'
import InspectPanel from './InspectPanel'

interface BrowserPreviewProps {
  url: string
  /**
   * Whether this preview tab is currently the active/visible tab.
   * Used to capture and restore scroll position when switching tabs.
   */
  isActive: boolean
}

const BrowserPreview: React.FC<BrowserPreviewProps> = ({ url, isActive }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [showInspect, setShowInspect] = useState(false)
  const [selectedElement, setSelectedElement] = useState<any>(null)
  const [pendingElement, setPendingElement] = useState<any>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [inspectPanelWidth, setInspectPanelWidth] = useState(450)
  const [editingText, setEditingText] = useState<{
    path: string
    text: string
    originalText: string
    kind: 'text' | 'html'
  } | null>(null)
  const [latestTextChange, setLatestTextChange] = useState<{
    token: number
    path: string
    oldText: string
    newText: string
    kind?: 'text' | 'html'
  } | null>(null)
  const textChangeTokenRef = useRef(0)
  const [resetChangesToken, setResetChangesToken] = useState(0)
  const scrollPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    let attempts = 0
    const maxAttempts = 10

    const injectInspectionScript = () => {
      attempts++
      
      try {
        const iframeWin = iframe.contentWindow
        if (!iframeWin) {
          if (attempts < maxAttempts) {
            setTimeout(injectInspectionScript, 500)
          }
          return
        }

        const iframeDoc = iframeWin.document
        if (!iframeDoc || !iframeDoc.body) {
          if (attempts < maxAttempts) {
            setTimeout(injectInspectionScript, 500)
          }
          return
        }

        // Check if already installed
        if ((iframeWin as any).__inspectionInstalled__) return
        
        const script = iframeDoc.createElement('script')
        script.textContent = `
          (function() {
            if (window.__inspectionInstalled__) return;
            window.__inspectionInstalled__ = true;

            function buildDOMTree(element, depth = 0, maxDepth = 10) {
              if (depth > maxDepth || !element) return null;
              const node = {
                tagName: element.tagName,
                attributes: {},
                textContent: '',
                children: [],
                path: getElementPath(element)
              };
              if (element.attributes) {
                for (let attr of element.attributes) {
                  node.attributes[attr.name] = attr.value;
                }
              }
              for (let child of element.childNodes) {
                if (child.nodeType === 3) {
                  const text = child.textContent.trim();
                  if (text) node.textContent += text;
                }
              }
              for (let child of element.children) {
                const childNode = buildDOMTree(child, depth + 1, maxDepth);
                if (childNode) node.children.push(childNode);
              }
              return node;
            }

            function getElementPath(element) {
              const path = [];
              let current = element;
              while (current && current !== document.body) {
                let selector = current.tagName;
                if (current.id) {
                  selector += '#' + current.id;
                } else if (current.className && typeof current.className === 'string') {
                  selector += '.' + current.className.split(' ').join('.');
                }

                // Disambiguate siblings: add :nth-of-type when there are multiple
                // elements with the same tag under the same parent.
                const parent = current.parentElement;
                if (parent) {
                  const sameTagSiblings = [];
                  for (var i = 0; i < parent.children.length; i++) {
                    var child = parent.children[i];
                    if (child.tagName === current.tagName) {
                      sameTagSiblings.push(child);
                    }
                  }
                  if (sameTagSiblings.length > 1) {
                    var index = sameTagSiblings.indexOf(current);
                    if (index !== -1) {
                      selector += ':nth-of-type(' + (index + 1) + ')';
                    }
                  }
                }

                path.unshift(selector);
                current = current.parentElement;
              }
              return path.join('>');
            }

            function getComputedStylesObj(element) {
              const computed = window.getComputedStyle(element);
              const styles = {};
              const importantProps = [
                'display', 'position', 'width', 'height', 'margin', 'padding',
                'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
                'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
                'border', 'border-width', 'border-style', 'border-color',
                'background', 'background-color', 'color', 'font-size', 'font-family',
                'flex', 'grid', 'top', 'left', 'right', 'bottom', 'z-index'
              ];
              for (let prop of importantProps) {
                const value = computed.getPropertyValue(prop);
                if (value) styles[prop] = value;
              }
              return styles;
            }

            function getInlineStyles(element) {
              const styles = {};
              if (element.style) {
                for (let i = 0; i < element.style.length; i++) {
                  const prop = element.style[i];
                  styles[prop] = element.style.getPropertyValue(prop);
                }
              }
              return styles;
            }

            function getMatchedRules(element) {
              const results = [];
              const styleSheets = document.styleSheets || [];
              for (let i = 0; i < styleSheets.length; i++) {
                const sheet = styleSheets[i];
                if (!sheet) continue;
                let rules;
                try {
                  rules = sheet.cssRules || sheet.rules;
                } catch (e) {
                  // Some stylesheets (e.g. cross-origin) may not be accessible
                  continue;
                }
                if (!rules) continue;
                for (let j = 0; j < rules.length; j++) {
                  const rule = rules[j];
                  if (!rule || rule.type !== 1 || !rule.selectorText) continue;
                  try {
                    if (!element.matches(rule.selectorText)) continue;
                  } catch (e) {
                    continue;
                  }
                  const decls = {};
                  const styleDecl = rule.style;
                  if (styleDecl && styleDecl.length) {
                    for (let k = 0; k < styleDecl.length; k++) {
                      const prop = styleDecl[k];
                      decls[prop] = styleDecl.getPropertyValue(prop);
                    }
                  }
                  results.push({
                    selector: rule.selectorText,
                    source: sheet.href || (sheet.ownerNode && sheet.ownerNode.tagName === 'STYLE' ? '<style>' : ''),
                    style: decls,
                    sheetIndex: i,
                    ruleIndex: j
                  });
                }
              }
              return results;
            }

            function getElementInfo(element) {
              return {
                tagName: element.tagName,
                id: element.id || '',
                className: element.className || '',
                textContent: element.textContent || '',
                path: getElementPath(element),
                domTree: buildDOMTree(document.body),
                styles: {
                  computed: getComputedStylesObj(element),
                  inline: getInlineStyles(element),
                  rules: getMatchedRules(element)
                }
              };
            }

            document.addEventListener('contextmenu', function(e) {
              e.preventDefault();
              const elementInfo = getElementInfo(e.target);
              window.parent.postMessage({
                type: 'inspectElement',
                data: elementInfo,
                mouseX: e.clientX,
                mouseY: e.clientY
              }, '*');
            }, true);

            // Allow the parent window to request inspection of a specific element
            // by its path (as used in the DOM tree).
            window.addEventListener('message', function(e) {
              try {
                if (!e.data || typeof e.data.type !== 'string') return;

                if (e.data.type === 'inspectByPath' && e.data.path) {
                  var el = document.querySelector(e.data.path);
                  if (!el) return;
                  var elementInfo = getElementInfo(el);
                  window.parent.postMessage({
                    type: 'inspectElementByPath',
                    data: elementInfo
                  }, '*');
                  return;
                }

                if (e.data.type === 'getScrollPosition') {
                  var sx = window.scrollX || window.pageXOffset || document.documentElement.scrollLeft || document.body.scrollLeft || 0;
                  var sy = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
                  window.parent.postMessage({
                    type: 'scrollPosition',
                    scrollX: sx,
                    scrollY: sy
                  }, '*');
                  return;
                }

                if (e.data.type === 'setScrollPosition') {
                  var targetX = typeof e.data.scrollX === 'number' ? e.data.scrollX : (window.scrollX || window.pageXOffset || 0);
                  var targetY = typeof e.data.scrollY === 'number' ? e.data.scrollY : (window.scrollY || window.pageYOffset || 0);
                  window.scrollTo(targetX || 0, targetY || 0);
                  return;
                }
              } catch (err) {
                console.error('iframe message handler error', err);
              }
            });
          })();
        `
        
        iframeDoc.head.appendChild(script)
        console.log('Inspection script injected successfully')
        
      } catch (err) {
        console.error('Failed to inject inspection script:', err)
        if (attempts < maxAttempts) {
          setTimeout(injectInspectionScript, 500)
        }
      }
    }

    iframe.addEventListener('load', injectInspectionScript)

    const handleMessage = (event: MessageEvent) => {
      if (!event.data || typeof event.data.type !== 'string') return

      if (event.data.type === 'inspectElement') {
        // Remember which element was right-clicked and where the context menu should appear.
        // We only update the active inspected element when the user explicitly clicks "Inspect"
        // so the Elements panel doesn't jump just on right-click.
        setPendingElement(event.data.data)
        setContextMenu({ x: event.data.mouseX, y: event.data.mouseY })
      } else if (event.data.type === 'inspectElementByPath') {
        // When the iframe sends an inspect-by-path response (from clicking a node
        // in the Elements tree), immediately update the selected element and ensure
        // the inspect panel is visible.
        setSelectedElement(event.data.data)
        setShowInspect(true)
      } else if (event.data.type === 'scrollPosition') {
        const sx = typeof event.data.scrollX === 'number' ? event.data.scrollX : 0
        const sy = typeof event.data.scrollY === 'number' ? event.data.scrollY : 0
        scrollPosRef.current = { x: sx, y: sy }
      }
    }

    const handleClick = () => {
      setContextMenu(null)
    }

    window.addEventListener('message', handleMessage)
    window.addEventListener('click', handleClick)

    return () => {
      iframe.removeEventListener('load', injectInspectionScript)
      window.removeEventListener('message', handleMessage)
      window.removeEventListener('click', handleClick)
    }
  }, [])

  // When the preview tab becomes inactive, ask the iframe to report its scroll
  // position. When it becomes active again, restore the last known position.
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    try {
      const iframeWin = iframe.contentWindow
      if (!iframeWin) return

      if (!isActive) {
        // Capture current scroll position (no-op if the injected script is unavailable)
        iframeWin.postMessage(
          {
            type: 'getScrollPosition'
          },
          '*'
        )
      } else {
        // Restore the last known scroll position for this preview
        const { x, y } = scrollPosRef.current
        if (x !== 0 || y !== 0) {
          iframeWin.postMessage(
            {
              type: 'setScrollPosition',
              scrollX: x,
              scrollY: y
            },
            '*'
          )
        }
      }
    } catch (err) {
      console.error('Failed to sync preview scroll position:', err)
    }
  }, [isActive])

  const handleSelectElement = (path: string) => {
    const iframe = iframeRef.current
    if (!iframe) return

    try {
      const iframeWin = iframe.contentWindow
      if (!iframeWin) return

      iframeWin.postMessage(
        {
          type: 'inspectByPath',
          path
        },
        '*'
      )
    } catch (err) {
      console.error('Failed to request inspect by path:', err)
    }
  }

  const handleUpdateInlineStyle = (property: string, value: string) => {
    const iframe = iframeRef.current
    if (!iframe || !selectedElement?.path) return

    try {
      const iframeWin = iframe.contentWindow
      if (!iframeWin) return

      const iframeDoc = iframeWin.document
      if (!iframeDoc) return

      const element = iframeDoc.querySelector(selectedElement.path)
      if (element && (element as HTMLElement).style) {
        ;(element as HTMLElement).style.setProperty(property, value)
      }

      // Update the selectedElement state so the panel reflects the change
      setSelectedElement((prev: any) => {
        if (!prev) return prev
        const prevStyles = prev.styles || {}
        const prevInline = prevStyles.inline || {}
        return {
          ...prev,
          styles: {
            ...prevStyles,
            inline: {
              ...prevInline,
              [property]: value
            }
          }
        }
      })
    } catch (err) {
      console.error('Failed to update inline style:', err)
    }
  }

  const handleUpdateRuleStyle = (
    sheetIndex: number,
    ruleIndex: number,
    property: string,
    value: string
  ) => {
    const iframe = iframeRef.current
    if (!iframe) return

    try {
      const iframeWin = iframe.contentWindow
      const iframeDoc = iframeWin?.document
      const styleSheets = iframeDoc?.styleSheets
      const sheet = styleSheets?.[sheetIndex] as CSSStyleSheet | undefined
      if (!sheet) return

      let rules: CSSRuleList | undefined
      try {
        // Accessing cssRules can throw for cross-origin stylesheets
        rules = sheet.cssRules || (sheet as any).rules
      } catch {
        return
      }

      const rule = rules?.[ruleIndex] as CSSStyleRule | undefined
      if (!rule || !(rule as any).style) return

      ;(rule as CSSStyleRule).style.setProperty(property, value)

      // Update our cached selectedElement rules so the panel reflects the change
      setSelectedElement((prev: any) => {
        if (!prev) return prev
        const prevStyles = prev.styles || {}
        const prevRules = prevStyles.rules || []
        const newRules = prevRules.map((r: any) => {
          if (r.sheetIndex === sheetIndex && r.ruleIndex === ruleIndex) {
            return {
              ...r,
              style: {
                ...(r.style || {}),
                [property]: value
              }
            }
          }
          return r
        })
        return {
          ...prev,
          styles: {
            ...prevStyles,
            rules: newRules
          }
        }
      })
    } catch (err) {
      console.error('Failed to update rule style:', err)
    }
  }

  const handleRemoveInlineStyle = (property: string) => {
    const iframe = iframeRef.current
    if (!iframe || !selectedElement?.path) return

    try {
      const iframeWin = iframe.contentWindow
      if (!iframeWin) return

      const iframeDoc = iframeWin.document
      if (!iframeDoc) return

      const element = iframeDoc.querySelector(selectedElement.path)
      if (element && (element as HTMLElement).style) {
        ;(element as HTMLElement).style.removeProperty(property)
      }

      setSelectedElement((prev: any) => {
        if (!prev) return prev
        const prevStyles = prev.styles || {}
        const prevInline = { ...(prevStyles.inline || {}) }
        if (!(property in prevInline)) return prev
        delete prevInline[property]
        return {
          ...prev,
          styles: {
            ...prevStyles,
            inline: prevInline
          }
        }
      })
    } catch (err) {
      console.error('Failed to remove inline style:', err)
    }
  }

  const handleReorderInlineStyles = (orderedKeys: string[]) => {
    const iframe = iframeRef.current

    setSelectedElement((prev: any) => {
      if (!prev) return prev
      const prevStyles = prev.styles || {}
      const prevInline = prevStyles.inline || {}

      const newInline: Record<string, string> = {}
      // First, apply the explicit ordered keys
      orderedKeys.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(prevInline, key)) {
          newInline[key] = prevInline[key]
        }
      })
      // Then, append any keys that weren't in orderedKeys to avoid losing data
      Object.keys(prevInline).forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(newInline, key)) {
          newInline[key] = prevInline[key]
        }
      })

      // Update the actual DOM inline style to match the new order
      try {
        if (iframe && prev.path) {
          const iframeWin = iframe.contentWindow
          const iframeDoc = iframeWin?.document
          const element = iframeDoc?.querySelector(prev.path) as HTMLElement | null
          if (element && element.style) {
            let cssText = ''
            Object.entries(newInline).forEach(([prop, val]) => {
              if (val != null && String(val).trim() !== '') {
                cssText += `${prop}: ${String(val)}; `
              }
            })
            element.setAttribute('style', cssText.trim())
          }
        }
      } catch (err) {
        console.error('Failed to reorder inline styles:', err)
      }

      return {
        ...prev,
        styles: {
          ...prevStyles,
          inline: newInline
        }
      }
    })
  }

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
    <div className="h-full w-full flex">
      <div className="flex-1 relative min-w-[200px]">
        <iframe
          ref={iframeRef}
          src={url}
          className="w-full h-full border-0 bg-white"
          data-role="browser-preview-iframe"
        />
        
        {/* Custom context menu */}
        {contextMenu && (
          <div
            className="fixed z-50 bg-vscode-sidebar border border-vscode-border rounded shadow-lg text-sm min-w-[180px]"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="block w-full text-left px-3 py-2 hover:bg-vscode-hover border-b border-vscode-border"
              onClick={() => {
                setContextMenu(null)
                setSelectedElement(null)
                setPendingElement(null)
                setShowInspect(false)
                setLatestTextChange(null)
                setResetChangesToken((t) => t + 1)
                const iframe = iframeRef.current
                if (iframe) {
                  try {
                    const win = iframe.contentWindow
                    if (win && typeof win.location.reload === 'function') {
                      win.location.reload()
                    } else {
                      // Fallback: force src reset
                      iframe.src = iframe.src
                    }
                  } catch {
                    iframe.src = iframe.src
                  }
                }
              }}
            >
              Refresh
            </button>
            <button
              className="block w-full text-left px-3 py-2 hover:bg-vscode-hover border-b border-vscode-border"
              onClick={() => {
                setContextMenu(null)
                const path = pendingElement?.path
                if (!path || !iframeRef.current) {
                  return
                }
                let text = ''
                let kind: 'text' | 'html' = 'text'
                try {
                  const iframeWin = iframeRef.current.contentWindow
                  const iframeDoc = iframeWin?.document
                  const el = iframeDoc?.querySelector(path) as HTMLElement | null
                  if (el) {
                    const hasElementChildren = !!(el.children && el.children.length > 0)
                    if (hasElementChildren) {
                      // Rich text node (contains nested markup): edit innerHTML so we
                      // preserve links, <br>, etc.
                      kind = 'html'
                      text = el.innerHTML || ''
                    } else {
                      kind = 'text'
                      const current =
                        typeof (el as any).innerText === 'string'
                          ? (el as any).innerText
                          : el.textContent || ''
                      text = current
                    }
                  }
                } catch (err) {
                  console.error('Failed to read element text for editing:', err)
                }
                setEditingText({ path, text, originalText: text, kind })
              }}
            >
              Edit text
            </button>
            <button
              className="block w-full text-left px-3 py-2 hover:bg-vscode-hover"
              onClick={() => {
                setContextMenu(null)
                // When the user chooses "Inspect", promote the last right-clicked element
                // to be the actively inspected element and show the panel.
                if (pendingElement) {
                  setSelectedElement(pendingElement)
                }
                setShowInspect(true)
              }}
            >
              Inspect
            </button>
            {showInspect && (
              <button
                className="block w-full text-left px-3 py-2 hover:bg-vscode-hover border-t border-vscode-border"
                onClick={() => {
                  setShowInspect(false)
                  setContextMenu(null)
                }}
              >
                Hide DevTools
              </button>
            )}
          </div>
        )}
        {editingText && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-vscode-bg border border-vscode-border rounded shadow-lg w-[420px] max-w-[90%] p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">Edit text</h2>
                <button
                  className="text-xs px-2 py-1 rounded hover:bg-vscode-hover"
                  onClick={() => setEditingText(null)}
                >
                  Cancel
                </button>
              </div>
              <textarea
                className="w-full h-32 bg-vscode-sidebar border border-vscode-border rounded p-2 text-xs resize-none outline-none"
                value={editingText.text}
                onChange={(e) =>
                  setEditingText((prev) =>
                    prev ? { ...prev, text: e.target.value } : prev
                  )
                }
              />
              <div className="mt-3 flex justify-end gap-2 text-xs">
                <button
                  className="px-3 py-1 rounded bg-vscode-sidebar hover:bg-vscode-hover"
                  onClick={() => setEditingText(null)}
                >
                  Cancel
                </button>
                <button
                  className="px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-500"
                  onClick={() => {
                    if (!editingText?.path || !iframeRef.current) {
                      setEditingText(null)
                      return
                    }
                    try {
                      const iframeWin = iframeRef.current.contentWindow
                      const iframeDoc = iframeWin?.document
                      const el = iframeDoc?.querySelector(editingText.path) as
                        | HTMLElement
                        | null
                      if (el) {
                        if (editingText.kind === 'html') {
                          el.innerHTML = editingText.text
                        } else {
                          ;(el as any).innerText = editingText.text
                        }
                      }
                    } catch (err) {
                      console.error('Failed to update element text:', err)
                    }
                    // Record the text change so the InspectPanel "Changes" tab can display it.
                    setLatestTextChange({
                      token: ++textChangeTokenRef.current,
                      path: editingText.path,
                      oldText: editingText.originalText,
                      newText: editingText.text,
                      kind: editingText.kind
                    })
                    setEditingText(null)
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {showInspect && (
        <InspectPanel
          selectedElement={selectedElement}
          onClose={() => setShowInspect(false)}
          onSelectElement={handleSelectElement}
          width={inspectPanelWidth}
          onWidthChange={setInspectPanelWidth}
          onUpdateInlineStyle={handleUpdateInlineStyle}
          onAddInlineStyle={handleUpdateInlineStyle}
          onRemoveInlineStyle={handleRemoveInlineStyle}
          onReorderInlineStyles={handleReorderInlineStyles}
          onUpdateRuleStyle={handleUpdateRuleStyle}
          onToggleTextChange={({ path, oldText, newText, enable, kind }) => {
            const iframe = iframeRef.current
            if (!iframe) return
            try {
              const iframeWin = iframe.contentWindow
              const iframeDoc = iframeWin?.document
              const el = iframeDoc?.querySelector(path) as HTMLElement | null
              if (el) {
                const mode: 'text' | 'html' = kind === 'html' ? 'html' : 'text'
                if (mode === 'html') {
                  el.innerHTML = enable ? newText : oldText
                } else {
                  ;(el as any).innerText = enable ? newText : oldText
                }
              }
            } catch (err) {
              console.error('Failed to toggle text change:', err)
            }
          }}
          latestTextChange={latestTextChange}
          resetChangesToken={resetChangesToken}
        />
      )}
    </div>
  )
}

const EditorArea: React.FC = () => {
  const { activeFile, openFiles } = useEditorStore()
  const currentFile = openFiles.find((f) => f.id === activeFile) || null
  const previewFiles = openFiles.filter((f) => f.kind === 'preview')

  return (
    <div className="flex-1 flex flex-col bg-vscode-bg">
      <EditorTabs />
      <div className="flex-1 relative">
        {currentFile ? (
          <>
            {/* Keep the Monaco editor mounted at all times; just hide it when a preview tab is active */}
            <div
              className={`absolute inset-0 ${
                currentFile.kind === 'preview' ? 'hidden' : 'block'
              }`}
            >
              <MonacoEditor />
            </div>

            {/* Keep each preview iframe mounted while its tab is open; toggle visibility on tab switch */}
            {previewFiles.map((file) => (
              <div
                key={file.id}
                className={`absolute inset-0 ${
                  file.id === activeFile && file.previewUrl ? 'block' : 'hidden'
                }`}
              >
                <BrowserPreview url={file.previewUrl || ''} isActive={file.id === activeFile} />
              </div>
            ))}
          </>
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