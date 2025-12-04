import React, { useRef, useEffect, useState } from 'react'
import { useEditorStore } from '../stores/editorStore'
import MonacoEditor from './MonacoEditor'
import EditorTabs from './EditorTabs'
import InspectPanel from './InspectPanel'

const BrowserPreview: React.FC<{ url: string }> = ({ url }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [showInspect, setShowInspect] = useState(false)
  const [selectedElement, setSelectedElement] = useState<any>(null)
  const [pendingElement, setPendingElement] = useState<any>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [inspectPanelWidth, setInspectPanelWidth] = useState(450)

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
                if (!e.data || e.data.type !== 'inspectByPath' || !e.data.path) return;
                var el = document.querySelector(e.data.path);
                if (!el) return;
                var elementInfo = getElementInfo(el);
                window.parent.postMessage({
                  type: 'inspectElementByPath',
                  data: elementInfo
                }, '*');
              } catch (err) {
                console.error('inspectByPath failed', err);
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