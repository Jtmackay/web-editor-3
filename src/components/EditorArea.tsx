import React, { useRef, useEffect, useState } from 'react'
import { useEditorStore } from '../stores/editorStore'
import { electronAPI } from '../utils/electronAPI'
import MonacoEditor from './MonacoEditor'
import EditorTabs from './EditorTabs'
import InspectPanel from './InspectPanel'

interface BrowserPreviewProps {
  url: string
  /**
   * Remote path of the HTML file this preview represents.
   * This is used to save inspector edits back into the synced local file.
   */
  sourcePath: string
  /**
   * Whether this preview tab is currently the active/visible tab.
   * Used to capture and restore scroll position when switching tabs.
   */
  isActive: boolean
}

const BrowserPreview: React.FC<BrowserPreviewProps> = ({ url, sourcePath, isActive }) => {
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
  const [allowInspector, setAllowInspector] = useState(false)
  const [imagePicker, setImagePicker] = useState<{
    mode: 'dom' | 'editor'
    targetPath?: string
    currentDir: string
    entries: { name: string; path: string; type: 'file' | 'directory' }[]
    loading: boolean
    error: string | null
    view?: 'list' | 'gallery'
    selectionPath?: string
    altText?: string
    className?: string
  } | null>(null)
  const [uploadModal, setUploadModal] = useState<{ file?: File; convertWebp: boolean; makeSmall: boolean; smallWidth: number; error: string | null; uploading: boolean } | null>(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const res = await electronAPI.settingsGetEnablePreviewInspector()
        if (mounted && res.success) setAllowInspector(!!res.enabled)
      } catch {}
    })()
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const iframe = iframeRef.current
      if (!iframe) return
      try {
        const win = iframe.contentWindow
        if (win && typeof win.location.reload === 'function') {
          win.location.reload()
        } else {
          iframe.src = iframe.src
        }
      } catch {
        iframe.src = iframe.src
      }
    }
    window.addEventListener('preview:reload', handler as any)
    return () => window.removeEventListener('preview:reload', handler as any)
  }, [])

  useEffect(() => {
    const onOpenPickerEditor = () => {
      openImagePickerEditor()
    }
    window.addEventListener('open-image-picker-editor', onOpenPickerEditor)
    return () => {
      window.removeEventListener('open-image-picker-editor', onOpenPickerEditor)
    }
  }, [])

  useEffect(() => {
    const onOpenPicker = (e: Event) => {
      try {
        const d = (e as CustomEvent).detail as any
        const path = d && typeof d.path === 'string' ? d.path : ''
        if (path) {
          openImagePicker(path)
        }
      } catch {}
    }
    window.addEventListener('open-image-picker', onOpenPicker as any)
    return () => {
      window.removeEventListener('open-image-picker', onOpenPicker as any)
    }
  }, [])

  useEffect(() => {
    if (!allowInspector) return
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
  }, [allowInspector])

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

  const openImagePicker = async (targetPath: string) => {
    let startPath = '/'
    try {
      const res = await electronAPI.settingsGetImagePickerStartPath?.()
      if (res && res.success && typeof res.path === 'string' && res.path.trim()) {
        startPath = res.path
      }
    } catch {}
    const normStart = String(startPath || '/').replace(/\\/g, '/').replace(/\/+$/, '') || '/'
    setImagePicker({ mode: 'dom', targetPath, currentDir: normStart, entries: [], loading: true, error: null })
    try {
      let list = await electronAPI.ftpListFilesReadonly?.(normStart)
      if (!list || !list.success || !Array.isArray(list.files) || list.files.length === 0) {
        list = await electronAPI.ftpListFiles(normStart)
      }
      if (list.success && Array.isArray(list.files)) {
        const mapped = list.files.map((item: any) => {
          const isDir = item && (item.type === 'directory' || item.type === 2 || item.isDirectory === true)
          return { name: item.name, path: item.path, type: isDir ? 'directory' : 'file' as const }
        })
        setImagePicker((prev) => (prev ? { ...prev, entries: mapped, loading: false } : prev))
      } else {
        setImagePicker((prev) => (prev ? { ...prev, error: list.error || 'Failed to list files', loading: false } : prev))
      }
    } catch (err) {
      setImagePicker((prev) => (prev ? { ...prev, error: 'Failed to load files', loading: false } : prev))
    }
  }

  const openImagePickerEditor = async () => {
    let startPath = '/'
    try {
      const res = await electronAPI.settingsGetImagePickerStartPath?.()
      if (res && res.success && typeof res.path === 'string' && res.path.trim()) {
        startPath = res.path
      }
    } catch {}
    const normStart = String(startPath || '/').replace(/\\/g, '/').replace(/\/+$/, '') || '/'
    setImagePicker({ mode: 'editor', currentDir: normStart, entries: [], loading: true, error: null })
    try {
      let list = await electronAPI.ftpListFilesReadonly?.(normStart)
      if (!list || !list.success || !Array.isArray(list.files) || list.files.length === 0) {
        list = await electronAPI.ftpListFiles(normStart)
      }
      if (list.success && Array.isArray(list.files)) {
        const mapped = list.files.map((item: any) => {
          const isDir = item && (item.type === 'directory' || item.type === 2 || item.isDirectory === true)
          return { name: item.name, path: item.path, type: isDir ? 'directory' : 'file' as const }
        })
        setImagePicker((prev) => (prev ? { ...prev, entries: mapped, loading: false } : prev))
      } else {
        setImagePicker((prev) => (prev ? { ...prev, error: list.error || 'Failed to list files', loading: false } : prev))
      }
    } catch (err) {
      setImagePicker((prev) => (prev ? { ...prev, error: 'Failed to load files', loading: false } : prev))
    }
  }

  const navigateImagePicker = async (dir: string) => {
    setImagePicker((prev) => (prev ? { ...prev, currentDir: dir, loading: true, error: null } : prev))
    try {
      const list = await electronAPI.ftpListFilesReadonly?.(dir) || await electronAPI.ftpListFiles(dir)
      if (list.success && Array.isArray(list.files)) {
        const mapped = list.files.map((item: any) => {
          const isDir = item && (item.type === 'directory' || item.type === 2 || item.isDirectory === true)
          return { name: item.name, path: item.path, type: isDir ? 'directory' : 'file' as const }
        })
        setImagePicker((prev) => (prev ? { ...prev, entries: mapped, loading: false } : prev))
      } else {
        setImagePicker((prev) => (prev ? { ...prev, error: list.error || 'Failed to list files', loading: false } : prev))
      }
    } catch (err) {
      setImagePicker((prev) => (prev ? { ...prev, error: 'Failed to load files', loading: false } : prev))
    }
  }

  const insertImageAtPath = async (targetPath: string, imageRemotePath: string, altText?: string, className?: string) => {
    const iframe = iframeRef.current
    if (!iframe) return
    try {
      const iframeDoc = iframe.contentWindow?.document
      const selector = (targetPath && targetPath.trim()) ? targetPath : 'body'
      let el = iframeDoc?.querySelector(selector) as HTMLElement | null
      if (!el && selector === 'body') {
        el = iframeDoc?.body || null
      }
      if (!el) return
      const beforeHtml = el.innerHTML || ''
      const img = iframeDoc!.createElement('img')
      let finalSrc = imageRemotePath
      try {
        const startAfterRes = await electronAPI.settingsGetPreviewStartAfter()
        const startAfter = (startAfterRes.success && startAfterRes.startAfter ? startAfterRes.startAfter : '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
        const p = String(imageRemotePath || '').replace(/\\/g, '/')
        const rel = p.replace(/^\/+/, '')
        if (startAfter) {
          const lowerRel = rel.toLowerCase()
          const lowerStart = startAfter.toLowerCase()
          if (lowerRel.startsWith(lowerStart + '/') || lowerRel === lowerStart) {
            let trimmed = rel.slice(startAfter.length)
            trimmed = trimmed.replace(/^\/+/, '')
            finalSrc = '/' + trimmed
          } else {
            finalSrc = p.startsWith('/') ? p : '/' + p
          }
        } else {
          finalSrc = p.startsWith('/') ? p : '/' + p
        }
      } catch {}
      const tag = (el.tagName || '').toLowerCase()
      const voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','source','track','wbr'])
      if (tag === 'img') {
        el.setAttribute('src', finalSrc)
        if (altText) el.setAttribute('alt', altText)
        if (className) el.setAttribute('class', className)
      } else if (voidTags.has(tag)) {
        img.setAttribute('src', finalSrc)
        if (altText) img.setAttribute('alt', altText)
        if (className) img.setAttribute('class', className)
        el.insertAdjacentElement('afterend', img)
      } else {
        img.setAttribute('src', finalSrc)
        if (altText) img.setAttribute('alt', altText)
        if (className) img.setAttribute('class', className)
        el.appendChild(img)
      }
      const afterHtml = (voidTags.has(tag) ? (el.parentElement?.innerHTML || '') : (el.innerHTML || ''))
      setLatestTextChange({
        token: ++textChangeTokenRef.current,
        path: targetPath,
        oldText: beforeHtml,
        newText: afterHtml,
        kind: 'html'
      })
    } catch (err) {
      console.error('Failed to insert image:', err)
    }
  }

  const buildPreviewUrlForResource = async (remotePath: string): Promise<string | null> => {
    const normalizedPath = String(remotePath || '').replace(/\\/g, '/')
    const [baseRes, startAfterRes] = await Promise.all([
      electronAPI.settingsGetPreviewBaseUrl(),
      electronAPI.settingsGetPreviewStartAfter()
    ])
    const baseRaw = (baseRes.success && baseRes.baseUrl ? baseRes.baseUrl : '').trim()
    if (!baseRaw) return null
    const hasProtocol = /^https?:\/\//i.test(baseRaw)
    const base = (hasProtocol ? baseRaw : `https://${baseRaw}`).replace(/\/+$/, '')
    const startAfterRaw = (startAfterRes.success && startAfterRes.startAfter ? startAfterRes.startAfter : '').replace(/\\/g, '/').replace(/^\/+/, '')
    let urlPath = normalizedPath.startsWith('/') ? normalizedPath : '/' + normalizedPath
    if (startAfterRaw) {
      const rel = normalizedPath.replace(/^\/+/, '')
      const lowerRel = rel.toLowerCase()
      const lowerStart = startAfterRaw.toLowerCase()
      if (lowerRel.startsWith(lowerStart + '/') || lowerRel === lowerStart) {
        let trimmed = rel.slice(startAfterRaw.length)
        trimmed = trimmed.replace(/^\/+/, '')
        urlPath = '/' + trimmed
      }
    }
    return encodeURI(`${base}${urlPath}`)
  }

  const buildImgTagFromRemote = async (remotePath: string, altText?: string, className?: string): Promise<string> => {
    let finalSrc = remotePath
    try {
      const startAfterRes = await electronAPI.settingsGetPreviewStartAfter()
      const startAfter = (startAfterRes.success && startAfterRes.startAfter ? startAfterRes.startAfter : '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
      const p = String(remotePath || '').replace(/\\/g, '/')
      const rel = p.replace(/^\/+/, '')
      if (startAfter) {
        const lowerRel = rel.toLowerCase()
        const lowerStart = startAfter.toLowerCase()
        if (lowerRel.startsWith(lowerStart + '/') || lowerRel === lowerStart) {
          let trimmed = rel.slice(startAfter.length)
          trimmed = trimmed.replace(/^\/+/, '')
          finalSrc = '/' + trimmed
        } else {
          finalSrc = p.startsWith('/') ? p : '/' + p
        }
      } else {
        finalSrc = p.startsWith('/') ? p : '/' + p
      }
    } catch {}
    const altAttr = altText && altText.trim() ? ` alt="${altText.trim()}"` : ''
    const classAttr = className && className.trim() ? ` class="${className.trim()}"` : ''
    return `<img src="${finalSrc}"${altAttr}${classAttr}>`
  }

  const GalleryItem: React.FC<{ ent: { name: string; path: string }; onPickRemote: (remotePath: string) => void }> = ({ ent, onPickRemote }) => {
    const [src, setSrc] = useState<string>('')
    const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
    useEffect(() => {
      let alive = true
      ;(async () => {
        const url = await buildPreviewUrlForResource(ent.path)
        if (alive) setSrc(url || ent.path)
      })()
      return () => { alive = false }
    }, [ent.path])
    return (
      <div className="inline-flex flex-col items-center justify-start p-2 m-1 w-32 h-40 border border-vscode-border rounded hover:bg-vscode-hover cursor-pointer"
        onClick={() => onPickRemote(ent.path)}
      >
        <img className="w-28 h-24 object-cover border border-vscode-border rounded" src={src || ''} alt={ent.name} onLoad={(e) => { const t = e.currentTarget as HTMLImageElement; setDims({ w: t.naturalWidth, h: t.naturalHeight }) }} />
        <span className="mt-1 text-[10px] truncate w-full text-center">{ent.name}</span>
        <span className="text-[10px] w-full text-center">{dims ? `${dims.w}×${dims.h}` : ''}</span>
      </div>
    )
  }

  const processUploadFile = async (
    file: File,
    convertWebp: boolean,
    smallWidth: number
  ): Promise<{ originalDataUrl: string; smallDataUrl: string; baseName: string; originalExt: string; finalExt: string }> => {
    const readAsDataURL = (f: File) => new Promise<string>((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result || ''))
      fr.onerror = reject
      fr.readAsDataURL(f)
    })
    const dataUrl = await readAsDataURL(file)
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = reject
      im.src = dataUrl
    })
    const createResized = (srcImg: HTMLImageElement, targetW: number, type: string) => {
      const ratio = srcImg.naturalHeight / srcImg.naturalWidth
      const w = targetW
      const h = Math.round(w * ratio)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(srcImg, 0, 0, w, h)
      const quality = 0.86
      return canvas.toDataURL(type, quality)
    }
    const name = file.name || 'image'
    const parts = name.split('.')
    const baseName = parts.slice(0, -1).join('.') || parts[0]
    const originalExt = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : 'png'
    const finalExt = convertWebp ? 'webp' : originalExt
    const originalType = convertWebp ? 'image/webp' : (file.type || `image/${originalExt}`)
    const originalDataUrl = convertWebp
      ? createResized(img, img.naturalWidth, 'image/webp')
      : dataUrl
    const smallDataUrl = createResized(img, Math.max(1, smallWidth || 400), convertWebp ? 'image/webp' : originalType)
    return { originalDataUrl, smallDataUrl, baseName, originalExt, finalExt }
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

  /**
   * Map a fully-qualified preview URL (for a stylesheet) back to the
   * corresponding remote FTP path, using the same settings that build
   * preview URLs for HTML files.
   */
  const mapResourceUrlToRemotePath = async (fullUrl: string): Promise<string | null> => {
    if (!fullUrl) return null
    let urlObj: URL
    try {
      urlObj = new URL(fullUrl)
    } catch {
      return null
    }

    const [baseRes, startAfterRes] = await Promise.all([
      electronAPI.settingsGetPreviewBaseUrl(),
      electronAPI.settingsGetPreviewStartAfter()
    ])

    const baseRaw = (baseRes.success && baseRes.baseUrl ? baseRes.baseUrl : '').trim()
    const startAfterRaw =
      startAfterRes.success && startAfterRes.startAfter ? startAfterRes.startAfter : ''

    // If no base is configured, fall back to using just the URL pathname.
    if (!baseRaw) {
      return urlObj.pathname || '/'
    }

    let baseUrl: URL
    try {
      const hasProtocol = /^https?:\/\//i.test(baseRaw)
      const baseStr = hasProtocol ? baseRaw : `https://${baseRaw}`
      baseUrl = new URL(baseStr)
    } catch {
      return urlObj.pathname || '/'
    }

    const normalizedPath = (urlObj.pathname || '/').replace(/\\/g, '/')
    const normalizedStart = startAfterRaw
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '')

    if (!normalizedStart) {
      return normalizedPath || '/'
    }

    const rel = normalizedPath.replace(/^\/+/, '')
    const lowerRel = rel.toLowerCase()
    const lowerStart = normalizedStart.toLowerCase()

    // If the path already starts with the startAfter segment, treat it as the
    // true remote path to avoid duplicating the prefix (e.g. "/www/www/...").
    if (lowerRel.startsWith(lowerStart + '/') || lowerRel === lowerStart) {
      return `/${rel}`
    }

    // Otherwise, assume the remote path is rooted under startAfter.
    return `/${normalizedStart}/${rel}`
  }

  // escapeRegExp was previously used for a more complex inline-style patcher;
  // it is currently unused but kept here for potential future use.

  const handleSaveInspectorChanges = async (payload?: {
    textChanges: {
      path: string
      oldText: string
      newText: string
      kind?: 'text' | 'html'
    }[]
    inlineStyleChanges?: {
      path: string
      property: string
      oldValue: string | null
      newValue: string | null
    }[]
  }) => {
    const iframe = iframeRef.current
    if (!iframe) return

    try {
      const iframeWin = iframe.contentWindow
      const iframeDoc = iframeWin?.document
      if (!iframeDoc) return

      const editorState = useEditorStore.getState()
      const textChanges = payload?.textChanges || []
      const inlineStyleChanges = payload?.inlineStyleChanges || []

      // Always let the user know that a save attempt is happening so it
      // doesn't feel like the button is dead even if nothing ends up written.
      editorState.setStatusMessage('Saving inspector changes...')
      editorState.setError(null)

      // We only need the original HTML when there are text/inline-style edits to apply.
      // CSS rule changes are captured directly from the live <style>/<link> sheets below.
      const hasHtmlWork = textChanges.length > 0 || inlineStyleChanges.length > 0

      // 1. Save HTML by patching the original source content (never by serializing
      // the live DOM). This keeps any server-side code (PHP includes, etc.)
      // untouched and only applies the specific text / inline-style edits.
      const htmlRemotePath = sourcePath || ''
      let savedHtml = false

      if (htmlRemotePath && hasHtmlWork) {
        const matchingFiles = editorState.openFiles.filter(
          (f) => f.kind !== 'preview' && f.path === htmlRemotePath
        )

        let sourceContent: string | null = null
        if (matchingFiles.length > 0) {
          sourceContent = matchingFiles[0].content
        } else {
          const dl: { success: boolean; content?: string; error?: string } =
            await electronAPI.ftpDownloadFile(htmlRemotePath, undefined as any)
          if (dl.success && typeof dl.content === 'string') {
            sourceContent = dl.content
          } else {
            const msg =
              dl.error ||
              `Failed to download original HTML for inspector save: ${htmlRemotePath}`
            editorState.setError(msg)
            editorState.setStatusMessage(null)
            return
          }
        }

        if (sourceContent && (textChanges.length > 0 || inlineStyleChanges.length > 0)) {
          let patched = sourceContent

          // 1a. Patch text content using the tracked old/new text snippets.
          for (const change of textChanges) {
            const oldText = change.oldText || ''
            const newText = change.newText || ''
            if (!oldText) continue
            const idx = patched.indexOf(oldText)
            if (idx === -1) continue
            patched =
              patched.slice(0, idx) + newText + patched.slice(idx + oldText.length)
          }

          // 1b. Patch inline element.style attributes textually in the original
          // HTML/PHP source by rewriting style="..." attributes. We do NOT
          // serialize the DOM; instead we look for style attributes that contain
          // the edited property and update just that declaration. For elements
          // that previously had no inline style attribute, we create a new
          // style="..." attribute based on the live DOM snapshot.
          if (inlineStyleChanges.length > 0) {
            let workingPatched = patched
            let reportedAmbiguousInlineMatch = false

            for (const change of inlineStyleChanges) {
              const { path, property, oldValue, newValue } = change
              if (!property) continue
              const hasOldValue =
                typeof oldValue === 'string' && oldValue.trim().length > 0

              // 1b(i). For edits/removals of an existing property, rewrite any
              // style=\"...\" attributes that contain this property. We no
              // longer rely on the exact previous value (which can differ in
              // formatting, e.g. \"red\" vs \"rgba(...)\"); instead we update
              // every declaration for this property. New properties (no
              // oldValue) are handled by the DOM-anchored injection logic
              // below, so we don't append missing properties here.
              if (hasOldValue) {
                const styleAttrRegex = /style\s*=\s*("([^"]*)"|'([^']*)')/gi
                let match: RegExpExecArray | null
                let result = ''
                let lastIndex = 0

                while ((match = styleAttrRegex.exec(workingPatched)) !== null) {
                  const matchStart = match.index
                  const matchEnd = styleAttrRegex.lastIndex
                  const quoteChar = match[1].startsWith('"') ? '"' : "'"
                  const styleContent = match[2] ?? match[3] ?? ''

                  // Copy everything before this attribute unchanged
                  result += workingPatched.slice(lastIndex, matchStart)

                  // Rewrite the style content
                  const decls = styleContent
                    .split(';')
                    .map((d) => d.trim())
                    .filter(Boolean)

                  const newDecls: string[] = []

                  decls.forEach((decl) => {
                    const colonIdx = decl.indexOf(':')
                    if (colonIdx === -1) {
                      newDecls.push(decl)
                      return
                    }
                    const name = decl.slice(0, colonIdx).trim()
                    const value = decl.slice(colonIdx + 1).trim()

                    if (name.toLowerCase() === property.toLowerCase()) {
                      // Update this declaration (or remove if newValue is
                      // null/empty). We intentionally don't compare the
                      // previous text value so that changes from \"red\" to
                      // \"rgba(...)\" still patch correctly.
                      if (typeof newValue === 'string' && newValue.trim() !== '') {
                        newDecls.push(`${name}: ${newValue}`)
                      }
                    } else {
                      newDecls.push(decl)
                    }
                  })

                  const newStyleContent = newDecls.join('; ')
                  const newAttr = `style=${quoteChar}${newStyleContent}${quoteChar}`
                  result += newAttr
                  lastIndex = matchEnd
                }

                if (lastIndex > 0) {
                  // Append any remaining content after the last style attribute
                  result += workingPatched.slice(lastIndex)
                  workingPatched = result
                }
              }

              // If this change targets a specific element that *previously* had
              // no inline style attribute in the source, we may still need to
              // create style="..." from scratch. We use the live DOM snapshot
              // to get the final inline style string, then inject or replace
              // the style attribute on the matching start tag.
              if (path && typeof newValue === 'string' && newValue.trim() !== '') {
                try {
                  const el = iframeDoc.querySelector(path) as HTMLElement | null
                  if (el) {
                    const liveStyle = (el.getAttribute('style') || '').trim()
                    if (liveStyle) {
                      const tagName = el.tagName.toLowerCase()
                      const id = el.id || ''
                      const classAttr = (el.getAttribute('class') || '').trim()

                      const escapeRegExp = (s: string) =>
                        s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

                      const styleRe = /style\s*=\s*("([^"]*)"|'([^']*)')/i

                      const applyTagUpdate = (start: number, end: number) => {
                        const originalTag = workingPatched.slice(start, end)
                        let newTag = originalTag
                        const sm = styleRe.exec(originalTag)
                        if (sm) {
                          const quoteChar = sm[1].startsWith('"') ? '"' : "'"
                          newTag =
                            originalTag.slice(0, sm.index) +
                            `style=${quoteChar}${liveStyle}${quoteChar}` +
                            originalTag.slice(sm.index + sm[0].length)
                        } else {
                          const gtIndex = originalTag.lastIndexOf('>')
                          if (gtIndex !== -1) {
                            const before = originalTag.slice(0, gtIndex)
                            const after = originalTag.slice(gtIndex)
                            newTag = `${before} style="${liveStyle}"${after}`
                          }
                        }
                        if (newTag !== originalTag) {
                          workingPatched =
                            workingPatched.slice(0, start) +
                            newTag +
                            workingPatched.slice(end)
                          return true
                        }
                        return false
                      }

                      let updated = false

                      // First try: id/class anchored regex on the start tag, if
                      // we have either id or class information.
                      if (id || classAttr) {
                        let pattern = `<\\s*${tagName}`
                        if (id) {
                          // Prefer id-based matching: it should be unique and
                          // stable, and avoids touching other elements.
                          pattern += `[^>]*\\bid\\s*=\\s*["']${escapeRegExp(id)}["']`
                        } else if (classAttr) {
                          // Fallback: anchor by exact class attribute string for
                          // this tag. This will only ever update the *first*
                          // matching tag in the source.
                          pattern += `[^>]*\\bclass\\s*=\\s*["']${escapeRegExp(
                            classAttr
                          )}["']`
                        }
                        pattern += `[^>]*>`

                        const re = new RegExp(pattern, 'i')
                        const m = re.exec(workingPatched)
                        if (m && m.index >= 0) {
                          const start = m.index
                          const end = start + m[0].length
                          updated = applyTagUpdate(start, end)
                        }
                      }

                      // Fallback: use words from the element's text content to
                      // locate the closest preceding <tagName ...> in the
                      // source when id/class matching fails (common when the
                      // source contains PHP or different attribute order).
                      if (!updated) {
                        const text = (el.textContent || '').trim()
                        if (text) {
                          const words = text.split(/\s+/).filter(Boolean).slice(0, 4)
                          if (words.length > 0) {
                            const patternWords = words
                              .map((w) => escapeRegExp(w))
                              .join('[\\s\\S]*?')
                            const textRe = new RegExp(patternWords, 'gi')

                            const matchIndices: number[] = []
                            let m2: RegExpExecArray | null
                            while ((m2 = textRe.exec(workingPatched)) !== null) {
                              matchIndices.push(m2.index)
                              if (matchIndices.length > 2) break
                            }

                            if (matchIndices.length === 1) {
                              const idx = matchIndices[0]
                              const openIdx = workingPatched.lastIndexOf(
                                `<${tagName}`,
                                idx
                              )
                              if (openIdx !== -1) {
                                const gtIndex = workingPatched.indexOf('>', openIdx)
                                if (gtIndex !== -1) {
                                  applyTagUpdate(openIdx, gtIndex + 1)
                                }
                              }
                            } else if (
                              matchIndices.length > 1 &&
                              !reportedAmbiguousInlineMatch
                            ) {
                              reportedAmbiguousInlineMatch = true
                              editorState.setError(
                                'Could not safely save a new inline style because multiple matching elements were found in the source. Please add a unique id or adjust the element text and try again.'
                              )
                            }
                          }
                        }
                      }
                    }
                  }
                } catch {
                  // Best-effort only; if anything fails we leave workingPatched as-is.
                }
              }
            }

            patched = workingPatched
          }

          // Update any open editor tabs for this HTML file
          matchingFiles.forEach((file) => {
            editorState.updateFileContent(file.id, patched)
          })

          // Persist patched HTML both to the local sync folder (for project search)
          // and directly to the FTP server so the remote file stays authoritative.
          const summary = `${textChanges.length} text change(s), ${inlineStyleChanges.length} inline style change(s)`
          const pubRes = await electronAPI.publishFile?.({ remotePath: htmlRemotePath, content: patched, summary })
          if (pubRes && pubRes.success) {
            savedHtml = true
            matchingFiles.forEach((file) => {
              editorState.setFileDirty(file.id, false)
            })
            editorState.setStatusMessage(
              `Saved inspector HTML changes to server and sync folder: ${htmlRemotePath}`
            )
            editorState.setError(null)
          } else {
            const msg = (pubRes && (pubRes as any).error) || 'Failed to publish HTML changes'
            editorState.setError(msg)
            editorState.setStatusMessage(null)
            return
          }
        }
      }

      // 2. Save external stylesheets that were modified via the inspector.
      // We serialize each same-origin stylesheet and write it to the
      // corresponding local sync file. As with HTML, the user is responsible
      // for running a normal Save & Sync in the editor to upload via FTP.
      const styleSheets: (CSSStyleSheet | null)[] = Array.from(
        iframeDoc.styleSheets || []
      ) as (CSSStyleSheet | null)[]

      const seenCssPaths = new Set<string>()

      let savedAnyCss = false
      const failedCssUploads: string[] = []

      for (const sheet of styleSheets) {
        if (!sheet) continue
        const href = (sheet as CSSStyleSheet).href
        if (!href) {
          // Inline <style> blocks are captured in the HTML save above.
          continue
        }

        const remotePath = await mapResourceUrlToRemotePath(href)
        if (!remotePath || seenCssPaths.has(remotePath)) continue
        seenCssPaths.add(remotePath)

        let cssText = ''
        let rules: CSSRuleList | undefined
        try {
          rules = (sheet as CSSStyleSheet).cssRules
        } catch {
          // Accessing cssRules can fail for some stylesheets; skip them.
          continue
        }
        if (!rules) continue

        for (let i = 0; i < rules.length; i++) {
          const rule = rules[i]
          if (rule && typeof (rule as CSSStyleRule).cssText === 'string') {
            cssText += (rule as CSSStyleRule).cssText + '\n'
          }
        }

        const cssPub = await electronAPI.publishFile?.({ remotePath, content: cssText, summary: 'Inspector stylesheet changes' })
        if (!cssPub || !cssPub.success) {
          const msg = (cssPub && (cssPub as any).error) || `Failed to publish stylesheet: ${remotePath}`
          failedCssUploads.push(`${remotePath} (${msg})`)
          continue
        }

        // Update any open editor tabs for this CSS file and mark them clean now
        // that the changes are uploaded to the FTP server.
        const cssFiles = editorState.openFiles.filter(
          (f) => f.kind !== 'preview' && f.path === remotePath
        )
        cssFiles.forEach((file) => {
          editorState.updateFileContent(file.id, cssText)
          editorState.setFileDirty(file.id, false)
        })
        savedAnyCss = true
      }

      if (!savedHtml && savedAnyCss) {
        editorState.setStatusMessage(
          failedCssUploads.length === 0
            ? 'Saved inspector stylesheet changes to server and sync folder'
            : `Saved some inspector stylesheet changes, but failed for: ${failedCssUploads.join(
                '; '
              )}`
        )
        editorState.setError(failedCssUploads.length ? failedCssUploads.join('; ') : null)
      }

      // If we reached this point without saving HTML or any stylesheets, make
      // it explicit so it doesn't look like the Save button did nothing.
      if (!savedHtml && !savedAnyCss) {
        if (failedCssUploads.length) {
          const msg = `Failed to save inspector stylesheet changes: ${failedCssUploads.join(
            '; '
          )}`
          editorState.setError(msg)
          editorState.setStatusMessage(null)
        } else {
          editorState.setStatusMessage(
            'No matching HTML or stylesheets were found to update for this preview'
          )
          // Keep error null here; this is informational rather than a hard failure.
        }
      }
    } catch (err) {
      console.error('Failed to save inspector changes:', err)
      const editorState = useEditorStore.getState()
      const msg = 'Failed to save inspector changes to local files'
      editorState.setError(msg)
      editorState.setStatusMessage(null)
    }
    try {
      const iframe = iframeRef.current
      const win = iframe?.contentWindow
      if (win && typeof win.location.reload === 'function') {
        win.location.reload()
      } else if (iframe) {
        iframe.src = iframe.src
      }
    } catch {}
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
              className="block w-full text-left px-3 py-2 hover:bg-vscode-hover border-b border-vscode-border"
              onClick={() => {
                const path = pendingElement?.path
                setContextMenu(null)
                if (path) {
                  openImagePicker(path)
                }
              }}
            >
              Insert Image
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
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
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
        {imagePicker && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
            <div className="bg-vscode-bg border border-vscode-border rounded shadow-lg w-[1200px] max-w-[95vw] max-h-[90vh] p-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">Insert Image</h2>
                <button className="text-xs px-2 py-1 rounded hover:bg-vscode-hover" onClick={() => setImagePicker(null)}>Close</button>
              </div>
              <div className="mb-2 flex items-center gap-2">
                <input
                  type="text"
                  value={imagePicker.currentDir}
                  onChange={(e) => setImagePicker((prev) => (prev ? { ...prev, currentDir: e.target.value } : prev))}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter') {
                      await navigateImagePicker(imagePicker.currentDir)
                    }
                  }}
                  className="flex-1 px-2 py-1 bg-vscode-sidebar border border-vscode-border rounded text-xs"
                  placeholder="/path/to/images"
                />
                <button
                  className="px-2 py-1 text-xs rounded bg-vscode-sidebar hover:bg-vscode-hover border border-vscode-border"
                  onClick={async () => {
                    const cur = imagePicker.currentDir || '/'
                    const norm = cur.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
                    let parent = '/'
                    if (norm !== '/') {
                      const parts = norm.replace(/^\/+/, '').split('/').filter(Boolean)
                      parts.pop()
                      parent = '/' + parts.join('/')
                      if (parent === '') parent = '/'
                    }
                    await navigateImagePicker(parent)
                  }}
                >Back</button>
                <button
                  className="px-2 py-1 text-xs rounded bg-vscode-sidebar hover:bg-vscode-hover border border-vscode-border"
                  onClick={async () => {
                    await navigateImagePicker(imagePicker.currentDir)
                  }}
                >Go</button>
                <div className="ml-auto flex items-center gap-1 text-xs">
                  <span>View:</span>
                  <button
                    className="px-2 py-1 rounded bg-vscode-sidebar hover:bg-vscode-hover border border-vscode-border"
                    onClick={() => {
                      setImagePicker((prev) => (prev ? { ...prev, view: 'list' } as any : prev))
                    }}
                  >List</button>
                  <button
                    className="px-2 py-1 rounded bg-vscode-sidebar hover:bg-vscode-hover border border-vscode-border"
                    onClick={() => {
                      setImagePicker((prev) => (prev ? { ...prev, view: 'gallery' } as any : prev))
                    }}
                  >Gallery</button>
                </div>
              </div>
              <div className="mb-2 flex items-center gap-2">
                <button className="px-2 py-1 text-xs rounded bg-vscode-sidebar hover:bg-vscode-hover border border-vscode-border" onClick={() => setUploadModal({ file: undefined, convertWebp: false, makeSmall: true, smallWidth: 400, error: null, uploading: false })}>Upload…</button>
              </div>
              <div className="border border-vscode-border rounded h-[520px] overflow-auto vscode-scrollbar">
                {imagePicker.loading ? (
                  <div className="p-3 text-xs text-vscode-text-muted">Loading…</div>
                ) : imagePicker.error ? (
                  <div className="p-3 text-xs text-red-400">{imagePicker.error}</div>
                ) : (
                  <div>
                    {((imagePicker as any).view === 'gallery' ? imagePicker.entries.filter((e) => e.type === 'file' && /\.(png|jpg|jpeg|gif|bmp|svg|webp)$/i.test(e.name)) : imagePicker.entries).map((ent) => (
                      (imagePicker as any).view === 'gallery' && ent.type === 'file' ? (
                        <GalleryItem
                          key={ent.path}
                          ent={{ name: ent.name, path: ent.path }}
                          onPickRemote={async (remotePath) => {
                            setImagePicker((prev) => (prev ? { ...prev, selectionPath: remotePath, altText: '', className: '' } : prev))
                          }}
                        />
                      ) : (
                        <div key={ent.path} className="flex items-center justify-between px-3 py-1 text-xs hover:bg-vscode-hover cursor-pointer"
                          onClick={async () => {
                            if (ent.type === 'directory') {
                              await navigateImagePicker(ent.path)
                            } else {
                              setImagePicker((prev) => (prev ? { ...prev, selectionPath: ent.path, altText: '', className: '' } : prev))
                            }
                          }}
                        >
                          <span>{ent.name}</span>
                          <span className="text-vscode-text-muted">{ent.type === 'directory' ? 'folder' : 'file'}</span>
                        </div>
                      )
                    ))}
                  </div>
                )}
              </div>
              {imagePicker.selectionPath && (
                <div className="mt-3 border-t border-vscode-border pt-3">
                  <div className="mb-2 text-xs">Selected: {imagePicker.selectionPath}</div>
                  <div className="mb-2 flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="alt text"
                      value={imagePicker.altText || ''}
                      onChange={(e) => setImagePicker((prev) => (prev ? { ...prev, altText: e.target.value } : prev))}
                      className="flex-1 px-2 py-1 bg-vscode-sidebar border border-vscode-border rounded text-xs"
                    />
                    <input
                      type="text"
                      placeholder="css class"
                      value={imagePicker.className || ''}
                      onChange={(e) => setImagePicker((prev) => (prev ? { ...prev, className: e.target.value } : prev))}
                      className="flex-1 px-2 py-1 bg-vscode-sidebar border border-vscode-border rounded text-xs"
                    />
                  </div>
                  <div className="flex justify-end gap-2 text-xs">
                    <button className="px-2 py-1 rounded bg-vscode-sidebar hover:bg-vscode-hover border border-vscode-border" onClick={() => setImagePicker((prev) => (prev ? { ...prev, selectionPath: undefined } : prev))}>Back</button>
                    <button className="px-2 py-1 rounded bg-vscode-accent text-white hover:bg-blue-600" onClick={async () => {
                      const remote = imagePicker.selectionPath || ''
                      if (!remote) return
                      if (imagePicker.mode === 'editor') {
                        const tag = await buildImgTagFromRemote(remote, imagePicker.altText || '', imagePicker.className || '')
                        window.dispatchEvent(new CustomEvent('insert-img-into-editor', { detail: { html: tag } }))
                        setImagePicker(null)
                      } else {
                        await insertImageAtPath(imagePicker.targetPath!, remote, imagePicker.altText || '', imagePicker.className || '')
                        setImagePicker(null)
                      }
                    }}>Insert</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        {uploadModal && (
          <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/40">
            <div className="bg-vscode-bg border border-vscode-border rounded shadow-lg w-[560px] max-w-[95vw] p-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">Upload Image</h2>
                <button className="text-xs px-2 py-1 rounded hover:bg-vscode-hover" onClick={() => setUploadModal(null)}>Close</button>
              </div>
              <div className="space-y-2">
                <input type="file" accept="image/*" className="text-xs" onChange={(e) => {
                  const f = e.currentTarget.files && e.currentTarget.files[0]
                  setUploadModal((prev) => (prev ? { ...prev, file: f, error: null } : prev))
                }} />
                <label className="inline-flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={uploadModal.convertWebp} onChange={(e) => setUploadModal((prev) => (prev ? { ...prev, convertWebp: e.target.checked } : prev))} />
                  Convert to WebP
                </label>
                <label className="inline-flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={uploadModal.makeSmall} onChange={(e) => setUploadModal((prev) => (prev ? { ...prev, makeSmall: e.target.checked } : prev))} />
                  Create resized version
                </label>
                <div className="flex items-center gap-2 text-xs">
                  <span>Width</span>
                  <input type="number" value={uploadModal.smallWidth} min={1} className="w-20 px-2 py-1 bg-vscode-sidebar border border-vscode-border rounded" onChange={(e) => setUploadModal((prev) => (prev ? { ...prev, smallWidth: Number(e.target.value) || 400 } : prev))} />
                </div>
              </div>
              {uploadModal.error && <div className="mt-2 text-xs text-red-400">{uploadModal.error}</div>}
              <div className="mt-3 flex justify-end gap-2 text-xs">
                <button className="px-2 py-1 rounded bg-vscode-sidebar hover:bg-vscode-hover border border-vscode-border" onClick={() => setUploadModal(null)}>Cancel</button>
                <button className={`px-2 py-1 rounded ${uploadModal.uploading ? 'bg-vscode-border text-vscode-text-muted' : 'bg-vscode-accent text-white hover:bg-blue-600'}`} disabled={uploadModal.uploading} onClick={async () => {
                  const f = uploadModal.file
                  if (!f) { setUploadModal((prev) => (prev ? { ...prev, error: 'Choose a file' } : prev)); return }
                  try {
                    setUploadModal((prev) => (prev ? { ...prev, uploading: true, error: null } : prev))
                    const { originalDataUrl, smallDataUrl, baseName, finalExt } = await processUploadFile(f, uploadModal.convertWebp, uploadModal.smallWidth)
                    const baseDir = imagePicker?.currentDir || '/'
                    const normalizedDir = baseDir.replace(/\\/g, '/').replace(/\/+$/, '')
                    const originalRemote = `${normalizedDir}/${baseName}.${finalExt}`
                    const smallRemote = `${normalizedDir}/${baseName}_small.${finalExt}`
                    const dirToCreate = normalizedDir || '/'
                    await electronAPI.ftpCreateDirectory?.(dirToCreate)
                    const oRes = await electronAPI.ftpUploadFile(originalDataUrl, originalRemote)
                    let sRes = { success: true }
                    if (uploadModal.makeSmall) {
                      sRes = await electronAPI.ftpUploadFile(smallDataUrl, smallRemote)
                    }
                    if (!oRes.success || !sRes.success) {
                      const errMsg = (oRes && (oRes as any).error) || (sRes && (sRes as any).error) || 'Upload failed'
                      setUploadModal((prev) => (prev ? { ...prev, uploading: false, error: errMsg } : prev))
                    } else {
                      setUploadModal(null)
                      await navigateImagePicker(baseDir)
                      setImagePicker((prev) => (prev ? { ...prev, selectionPath: uploadModal.makeSmall ? smallRemote : originalRemote } : prev))
                    }
                  } catch (err) {
                    console.error('Upload failed:', err)
                    const msg = (err && (err as any).message) ? String((err as any).message) : 'Upload failed'
                    setUploadModal((prev) => (prev ? { ...prev, uploading: false, error: msg } : prev))
                  }
                }}>Upload</button>
              </div>
            </div>
          </div>
        )}
      </div>
      {showInspect && allowInspector && (
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
          onSaveChanges={handleSaveInspectorChanges}
          onRequestInsertImage={(targetPath) => {
            openImagePicker(targetPath)
          }}
        />
      )}
    </div>
  )
}

const EditorArea: React.FC = () => {
  const { activeFile, openFiles } = useEditorStore()
  const currentFile = openFiles.find((f) => f.id === activeFile) || null
  const previewFiles = openFiles.filter((f) => f.kind === 'preview')
  const containerRef = useRef<HTMLDivElement>(null)
  const [splitState, setSplitState] = useState<{ fileId: string | null; leftWidth: number; dragging: boolean } | null>(null)
  const startXRef = useRef<number>(0)
  const startWidthRef = useRef<number>(0)

  useEffect(() => {
    const onSplit = (e: Event) => {
      try {
        const d = (e as CustomEvent).detail as any
        const fid = d && typeof d.fileId === 'string' ? d.fileId : null
        if (!fid) return
        setSplitState({ fileId: fid, leftWidth: Math.max(360, Math.floor((containerRef.current?.clientWidth || 1200) * 0.45)), dragging: false })
      } catch {}
    }
    const onClose = () => setSplitState(null)
    window.addEventListener('split:view', onSplit as any)
    window.addEventListener('split:close', onClose as any)
    return () => {
      window.removeEventListener('split:view', onSplit as any)
      window.removeEventListener('split:close', onClose as any)
    }
  }, [])

  const beginDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    if (!splitState) return
    const container = containerRef.current
    if (!container) return
    startXRef.current = e.clientX
    startWidthRef.current = splitState.leftWidth
    setSplitState((prev) => (prev ? { ...prev, dragging: true } : prev))
    try {
      const iframe = container.querySelector('iframe[data-role="browser-preview-iframe"]') as HTMLIFrameElement | null
      if (iframe) iframe.style.pointerEvents = 'none'
    } catch {}
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startXRef.current
      const newW = Math.min(Math.max(320, startWidthRef.current + dx), (container.clientWidth || 1200) - 320)
      setSplitState((prev) => (prev ? { ...prev, leftWidth: newW } : prev))
    }
    const onUp = () => {
      setSplitState((prev) => (prev ? { ...prev, dragging: false } : prev))
      try {
        const iframe = container.querySelector('iframe[data-role="browser-preview-iframe"]') as HTMLIFrameElement | null
        if (iframe) iframe.style.pointerEvents = ''
      } catch {}
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div className="flex-1 flex flex-col bg-vscode-bg">
      <EditorTabs />
      <div className="flex-1 relative" ref={containerRef}>
        {currentFile ? (
          <>
            {splitState && previewFiles.length > 0 ? (
              <div className="absolute inset-0 flex">
                <div className="relative border-r border-vscode-border" style={{ width: splitState.leftWidth, minWidth: 320 }}>
                  <MonacoEditor fileId={splitState.fileId || undefined} />
                </div>
                <div className="w-1.5 cursor-col-resize bg-vscode-border" onMouseDown={beginDrag} />
                <div className="flex-1 relative min-w-[320px]">
                  {previewFiles.map((file) => (
                    <div key={file.id} className={`${file.id === activeFile && file.previewUrl ? 'block' : 'hidden'} h-full w-full`}>
                      <BrowserPreview
                        url={file.previewUrl || ''}
                        sourcePath={file.path}
                        isActive={true}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div
                  className={`absolute inset-0 ${
                    currentFile.kind === 'preview' ? 'hidden' : 'block'
                  }`}
                >
                  <MonacoEditor />
                </div>
                {previewFiles.map((file) => (
                  <div
                    key={file.id}
                    className={`absolute inset-0 ${
                      file.id === activeFile && file.previewUrl ? 'block' : 'hidden'
                    }`}
                  >
                    <BrowserPreview
                      url={file.previewUrl || ''}
                      sourcePath={file.path}
                      isActive={file.id === activeFile}
                    />
                  </div>
                ))}
              </>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-vscode-text-muted">
            <div className="text-center">
              <h2 className="text-xl mb-2">Web Editor</h2>
              <p>Open a file from the FTP explorer to start editing</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default EditorArea
