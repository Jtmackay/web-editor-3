import React, { useRef, useEffect, useState } from 'react'
import { useEditorStore } from '../stores/editorStore'
import MonacoEditor from './MonacoEditor'
import EditorTabs from './EditorTabs'
import InspectPanel from './InspectPanel'

const BrowserPreview: React.FC<{ url: string }> = ({ url }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [showInspect, setShowInspect] = useState(false)
  const [selectedElement, setSelectedElement] = useState<any>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

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

            function getElementInfo(element) {
              return {
                tagName: element.tagName,
                id: element.id || '',
                className: element.className || '',
                path: getElementPath(element),
                domTree: buildDOMTree(document.body),
                styles: {
                  computed: getComputedStylesObj(element),
                  inline: getInlineStyles(element)
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
      if (event.data.type === 'inspectElement') {
        setSelectedElement(event.data.data)
        setShowInspect(true)
        setContextMenu({ x: event.data.mouseX, y: event.data.mouseY })
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
      
      const iframeDoc = iframeWin.document
      if (!iframeDoc) return
      
      const element = iframeDoc.querySelector(path)
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    } catch (err) {
      console.error('Failed to select element:', err)
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
      <div className={showInspect ? 'flex-1 relative' : 'w-full h-full relative'}>
        <iframe
          ref={iframeRef}
          src={url}
          className="w-full h-full border-0 bg-white"
        />
        
        {/* Custom context menu */}
        {contextMenu && (
          <div
            className="fixed z-50 bg-vscode-sidebar border border-vscode-border rounded shadow-lg text-sm min-w-[180px]"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="block w-full text-left px-3 py-2 hover:bg-vscode-hover"
              onClick={() => {
                setContextMenu(null)
                if (!showInspect) setShowInspect(true)
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
        <div className="w-96 h-full">
          <InspectPanel
            selectedElement={selectedElement}
            onClose={() => setShowInspect(false)}
            onSelectElement={handleSelectElement}
          />
        </div>
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