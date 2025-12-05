import React, { useState, useEffect, useRef } from 'react'
import { ChevronRight, ChevronDown, X, Search } from 'lucide-react'

// Common enum-style options for CSS properties we want to edit via dropdowns
const ENUM_STYLE_OPTIONS: Record<string, string[]> = {
  display: ['block', 'inline', 'inline-block', 'flex', 'grid', 'none'],
  position: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
  'flex-direction': ['row', 'row-reverse', 'column', 'column-reverse'],
  'justify-content': [
    'flex-start',
    'center',
    'flex-end',
    'space-between',
    'space-around',
    'space-evenly'
  ],
  'align-items': ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'],
  'text-align': ['left', 'center', 'right', 'justify'],
  'font-weight': ['normal', 'bold', 'bolder', 'lighter', '100', '200', '300', '400', '500', '600', '700', '800', '900'],
  overflow: ['visible', 'hidden', 'scroll', 'auto'],
  'flex-wrap': ['nowrap', 'wrap', 'wrap-reverse'],
  'align-content': ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'stretch']
}

// Suggestions for property/value autocomplete in add rows
const CSS_PROPERTY_SUGGESTIONS: string[] = [
  'color',
  'background',
  'background-color',
  'border',
  'border-color',
  'border-radius',
  'border-width',
  'border-style',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'width',
  'height',
  'max-width',
  'max-height',
  'min-width',
  'min-height',
  'font-size',
  'font-family',
  'font-weight',
  'line-height',
  'text-align',
  'z-index',
  'flex',
  'flex-direction',
  'flex-wrap',
  'justify-content',
  'align-items',
  'align-content',
  'gap',
  'row-gap',
  'column-gap',
  'overflow',
  'overflow-x',
  'overflow-y',
  'opacity',
  'box-shadow'
]

const CSS_VALUE_SUGGESTIONS: string[] = [
  'block',
  'inline',
  'inline-block',
  'flex',
  'grid',
  'none',
  'static',
  'relative',
  'absolute',
  'fixed',
  'sticky',
  'center',
  'flex-start',
  'flex-end',
  'space-between',
  'space-around',
  'space-evenly',
  'baseline',
  'bold',
  'normal',
  'bolder',
  'lighter',
  '1',
  '0',
  '1px',
  '2px',
  '4px',
  '8px',
  '16px',
  '50%',
  '100%',
  'auto',
  'hidden',
  'scroll',
  'visible',
  'rgba(0, 0, 0, 0.5)',
  '#000000',
  '#ffffff'
]

// (duplicate CSS_PROPERTY_SUGGESTIONS and CSS_VALUE_SUGGESTIONS removed)

const getEnumOptions = (prop: string): string[] | undefined => {
  return ENUM_STYLE_OPTIONS[prop.toLowerCase()]
}

const isColorProperty = (prop: string): boolean => {
  const p = prop.toLowerCase()
  return (
    p === 'color' ||
    p.endsWith('color') ||
    p.includes('background-color') ||
    p.includes('border-color')
  )
}

// Adjust the first numeric value in a CSS value string by a step using the mouse wheel
const adjustNumericValue = (value: string, direction: 1 | -1): string => {
  if (!value) return value
  const match = value.match(/(-?\d*\.?\d+)([a-z%]*)/i)
  if (!match) return value

  const num = parseFloat(match[1])
  if (Number.isNaN(num)) return value
  const unit = match[2] || ''

  const step = unit === 'px' || unit === '' ? 1 : 0.1
  const newNum = num + direction * step
  if (!Number.isFinite(newNum)) return value

  const formatted =
    step < 1
      ? newNum.toFixed(2).replace(/\.00$/, '')
      : String(Math.round(newNum))

  return `${formatted}${unit}`
}

const clamp01 = (n: number) => {
  if (Number.isNaN(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  let h = hex.trim()
  if (h.startsWith('#')) h = h.slice(1)
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  }
  if (h.length !== 6) return null
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  if ([r, g, b].some((v) => Number.isNaN(v))) return null
  return { r, g, b }
}

const rgbToHex = (r: number, g: number, b: number): string => {
  const toHex = (n: number) => {
    const clamped = Math.max(0, Math.min(255, Math.round(n)))
    return clamped.toString(16).padStart(2, '0')
  }
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

const parseColor = (value: string): { hex: string; alpha: number } => {
  const v = (value || '').trim()
  if (!v) {
    return { hex: '#ffffff', alpha: 1 }
  }

  // Simple hex
  if (v.startsWith('#')) {
    const rgb = hexToRgb(v)
    if (rgb) {
      return { hex: rgbToHex(rgb.r, rgb.g, rgb.b), alpha: 1 }
    }
  }

  // rgb/rgba()
  const m = v.match(
    /rgba?\s*\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)/i
  )
  if (m) {
    const r = parseFloat(m[1])
    const g = parseFloat(m[2])
    const b = parseFloat(m[3])
    const a = m[4] !== undefined ? clamp01(parseFloat(m[4])) : 1
    if ([r, g, b].some((n) => Number.isNaN(n))) {
      return { hex: '#ffffff', alpha: 1 }
    }
    return { hex: rgbToHex(r, g, b), alpha: a }
  }

  // Let the browser parse named colors and other valid CSS color syntaxes.
  // This runs only in the renderer (there is a DOM available).
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    try {
      const el = document.createElement('div')
      el.style.color = v
      // If the browser does not understand the color, computed color will be
      // an empty string or unchanged default.
      document.body.appendChild(el)
      const computed = window.getComputedStyle(el).color || ''
      document.body.removeChild(el)

      const m2 = computed.match(
        /rgba?\s*\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)/i
      )
      if (m2) {
        const r = parseFloat(m2[1])
        const g = parseFloat(m2[2])
        const b = parseFloat(m2[3])
        const a = m2[4] !== undefined ? clamp01(parseFloat(m2[4])) : 1
        if ([r, g, b].some((n) => Number.isNaN(n))) {
          return { hex: '#ffffff', alpha: 1 }
        }
        return { hex: rgbToHex(r, g, b), alpha: a }
      }
    } catch {
      // Ignore and fall through to default
    }
  }

  // Fallback
  return { hex: '#ffffff', alpha: 1 }
}

const hexAndAlphaToRgba = (hex: string, alpha: number): string => {
  const rgb = hexToRgb(hex) || { r: 255, g: 255, b: 255 }
  const a = clamp01(alpha)
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`
}

const getStylesheetLabelAndTitle = (source: string): { label: string; title: string } => {
  if (!source || source === '<style>') {
    return { label: '<inline <style>>', title: source || '<inline <style>>' }
  }

  // Try URL parsing first
  try {
    const url = new URL(source)
    const parts = url.pathname.split('/')
    const filename = parts[parts.length - 1] || source
    // Use the URL path (without protocol/host) as a more "local" looking path
    return { label: filename, title: url.pathname || source }
  } catch {
    // Fallback: split by slashes/backslashes and take the last segment
    const cleaned = source.split(/[\\/]/)
    const filename = cleaned[cleaned.length - 1] || source
    return { label: filename, title: source }
  }
}

interface DOMNode {
  tagName: string
  attributes: Record<string, string>
  textContent: string
  children: DOMNode[]
  path: string
  isExpanded?: boolean
}

interface InspectPanelProps {
  selectedElement: any
  onClose: () => void
  onSelectElement: (path: string) => void
  width: number
  onWidthChange: (width: number) => void
  onUpdateInlineStyle: (property: string, value: string) => void
  onAddInlineStyle: (property: string, value: string) => void
  onRemoveInlineStyle: (property: string) => void
  onReorderInlineStyles: (orderedKeys: string[]) => void
  onUpdateRuleStyle: (
    sheetIndex: number,
    ruleIndex: number,
    property: string,
    value: string
  ) => void
  onToggleTextChange?: (payload: {
    path: string
    oldText: string
    newText: string
    enable: boolean
    kind?: 'text' | 'html'
  }) => void
  latestTextChange?: {
    token: number
    path: string
    oldText: string
    newText: string
    kind?: 'text' | 'html'
  } | null
  resetChangesToken?: number
      /**
       * Invoked when the user clicks the "Save to files" button in the Changes tab.
       * The parent component is responsible for persisting the current DOM/CSS
       * state back to the appropriate remote FTP files (and their local sync copies).
       *
       * - `textChanges` captures innerText / innerHTML edits.
       * - `inlineStyleChanges` captures `element.style` edits so the parent can
       *   patch only the affected elements instead of rewriting the whole page.
       */
  onSaveChanges?: (payload: {
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
  }) => void
}

const InspectPanel: React.FC<InspectPanelProps> = ({
  selectedElement,
  onClose,
  onSelectElement,
  width,
  onWidthChange,
  onUpdateInlineStyle,
  onAddInlineStyle,
  onRemoveInlineStyle,
  onReorderInlineStyles,
  onUpdateRuleStyle,
  onToggleTextChange,
  latestTextChange: externalTextChange,
  resetChangesToken,
  onSaveChanges
}) => {
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [isDraggingWidth, setIsDraggingWidth] = useState(false)
  const [isDraggingSplit, setIsDraggingSplit] = useState(false)
  const [stylesHeight, setStylesHeight] = useState(180)
  const [activeTab, setActiveTab] = useState<'elements' | 'computed' | 'changes'>(
    'elements'
  )
  const [changedProps, setChangedProps] = useState<Set<string>>(new Set())
  const [inlineOrder, setInlineOrder] = useState<string[]>([])
  const [changes, setChanges] = useState<
    {
      id: number
      scope: 'inline' | 'rule' | 'text'
      type: 'set' | 'remove' | 'reorder'
      property?: string
      oldValue?: string | null
      newValue?: string | null
      selector?: string
      source?: string
      inlineOrder?: string[]
      elementPath?: string
      active?: boolean
      contentKind?: 'text' | 'html'
    }[]
  >([])
  const panelRef = useRef<HTMLDivElement>(null)
  const selectedElementRef = useRef<HTMLDivElement>(null)
  const domTreeContainerRef = useRef<HTMLDivElement>(null)
  const stylesContainerRef = useRef<HTMLDivElement>(null)
  const widthDragStartRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const dragInlinePropRef = useRef<string | null>(null)
  const changeIdRef = useRef(0)
  const lastTextChangeTokenRef = useRef<number | null>(null)
  const lastResetTokenRef = useRef<number | null>(null)

  useEffect(() => {
    // Reset changed markers when switching to a different element
    setChangedProps(new Set())
  }, [selectedElement?.path])

  const markChanged = (scope: 'inline' | 'rule', prop: string) => {
    setChangedProps((prev) => {
      const next = new Set(prev)
      next.add(`${scope}:${prop}`)
      return next
    })
  }

  const isPropChanged = (scope: 'inline' | 'rule', prop: string) =>
    changedProps.has(`${scope}:${prop}`)

  const recordChange = (
    entry: {
      scope: 'inline' | 'rule' | 'text'
      type: 'set' | 'remove' | 'reorder'
      property?: string
      oldValue?: string | null
      newValue?: string | null
      selector?: string
      source?: string
      inlineOrder?: string[]
      elementPath?: string
      contentKind?: 'text' | 'html'
    }
  ) => {
    setChanges((prev) => {
      const elementPath = selectedElement?.path
      const last = prev[prev.length - 1]

      // Coalesce consecutive "set" changes for the same property/selector/source/element
      if (
        last &&
        last.type === 'set' &&
        entry.type === 'set' &&
        last.scope === entry.scope &&
        last.property === entry.property &&
        last.selector === entry.selector &&
        last.source === entry.source &&
        last.elementPath === elementPath
      ) {
        const updated = [...prev]
        updated[updated.length - 1] = {
          ...last,
          newValue: entry.newValue
        }
        return updated
      }

      return [
        ...prev,
        {
          ...entry,
          id: ++changeIdRef.current,
          elementPath,
          active: true
        }
      ]
    })
  }

  // Keep a stable display order for inline styles, and allow reordering.
  useEffect(() => {
    const inline = (selectedElement?.styles?.inline || {}) as Record<string, unknown>
    const keys = Object.keys(inline)
    setInlineOrder((prev) => {
      if (prev.length === keys.length && prev.every((k, i) => k === keys[i])) {
        return prev
      }
      return keys
    })
  }, [selectedElement?.styles?.inline, selectedElement?.path])

  // Ingest external text content edits (from the preview "Edit text" dialog)
  useEffect(() => {
    if (!externalTextChange) return
    if (externalTextChange.token === lastTextChangeTokenRef.current) return
    lastTextChangeTokenRef.current = externalTextChange.token

    recordChange({
      scope: 'text',
      type: 'set',
      property: 'text',
      oldValue: externalTextChange.oldText,
      newValue: externalTextChange.newText,
      elementPath: externalTextChange.path,
      contentKind: externalTextChange.kind === 'html' ? 'html' : 'text'
    })
  }, [externalTextChange])

  // Clear all tracked changes when the preview signals a reset (e.g. Refresh)
  useEffect(() => {
    if (resetChangesToken === undefined) return

    // Ignore the first run on mount so we don't immediately wipe out
    // any pending text changes that were made while the panel was closed.
    if (lastResetTokenRef.current === null) {
      lastResetTokenRef.current = resetChangesToken
      return
    }

    // Only react when the token actually changes (e.g. Refresh clicked)
    if (lastResetTokenRef.current === resetChangesToken) return
    lastResetTokenRef.current = resetChangesToken

    setChanges([])
    setChangedProps(new Set())
  }, [resetChangesToken])

  useEffect(() => {
    // Auto-expand and scroll to the selected element (similar to Chrome DevTools)
    if (!selectedElement?.path) return

    const path = selectedElement.path as string
    const pathParts = path.split('>')

    // Always expand the root node (the <body> wrapper) plus all ancestors of the selected node.
    // The DOM tree we build starts at document.body, whose path is an empty string (''),
    // so we need to make sure that node is expanded or nothing underneath will be visible.
    const newExpanded = new Set<string>([''])
    let currentPath = ''

    pathParts.forEach((part: string, index: number) => {
      currentPath += (currentPath ? '>' : '') + part
      // Expand all ancestors so the selected node is visible
      if (index < pathParts.length - 1) {
        newExpanded.add(currentPath)
      }
    })

    setExpandedNodes(newExpanded)

    const scrollToSelected = () => {
      const container = domTreeContainerRef.current
      if (container) {
        // Find the corresponding row inside the DOM tree scroll container
        const target = container.querySelector(
          `[data-dom-path="${path}"]`
        ) as HTMLElement | null

        if (target) {
          const containerRect = container.getBoundingClientRect()
          const targetRect = target.getBoundingClientRect()
          const offset = targetRect.top - containerRect.top

          // Scroll the DOM tree container so the target row is centered,
          // without scrolling the entire app window.
          const desiredScrollTop = container.scrollTop + offset - containerRect.height / 2
          container.scrollTo({
            top: Math.max(desiredScrollTop, 0),
            behavior: 'smooth'
          })
        }
      }

      // Also reset the styles panel scroll to the top for the newly selected element
      if (stylesContainerRef.current) {
        stylesContainerRef.current.scrollTo({ top: 0 })
      }
    }

    const timeoutId = window.setTimeout(scrollToSelected, 120)
    return () => window.clearTimeout(timeoutId)
  }, [selectedElement?.path])

  // Handle width dragging
  useEffect(() => {
    // While dragging the width, disable pointer events on the preview iframe
    // so it can't "steal" mousemove/mouseup events as you cross over it.
    const iframe = document.querySelector('[data-role="browser-preview-iframe"]') as HTMLIFrameElement | null
    if (iframe) {
      iframe.style.pointerEvents = isDraggingWidth ? 'none' : ''
    }

    if (!isDraggingWidth) return

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault()
      if (!widthDragStartRef.current) return

      const { startX, startWidth } = widthDragStartRef.current
      const deltaX = startX - e.clientX
      const minWidth = 260
      const maxWidth = 1200
      const newWidth = Math.min(Math.max(startWidth + deltaX, minWidth), maxWidth)

      onWidthChange(newWidth)
    }

    const handleMouseUp = () => {
      setIsDraggingWidth(false)
      widthDragStartRef.current = null
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDraggingWidth, onWidthChange])

  // Handle split (elements/styles) height dragging
  useEffect(() => {
    if (!isDraggingSplit || !panelRef.current) return

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault()
      const rect = panelRef.current!.getBoundingClientRect()
      const totalHeight = rect.height
      const footerHeight = selectedElement ? 28 : 0

      let newHeight = rect.bottom - e.clientY - footerHeight
      const minHeight = 120
      const maxHeight = Math.max(minHeight, totalHeight - HEADER_HEIGHT - minHeight - footerHeight)

      if (newHeight < minHeight) newHeight = minHeight
      if (newHeight > maxHeight) newHeight = maxHeight
      setStylesHeight(newHeight)
    }

    const handleMouseUp = () => {
      setIsDraggingSplit(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDraggingSplit, selectedElement])

  const toggleNode = (path: string) => {
    const newExpanded = new Set(expandedNodes)
    if (newExpanded.has(path)) {
      newExpanded.delete(path)
    } else {
      newExpanded.add(path)
    }
    setExpandedNodes(newExpanded)
  }

  const renderAttributes = (attributes: Record<string, string>) => {
    return Object.entries(attributes).map(([key, value]) => (
      <span key={key} className="ml-1">
        <span className="text-[#9cdcfe]">{key}</span>
        <span className="text-gray-400">=</span>
        <span className="text-[#ce9178]">"{value}"</span>
      </span>
    ))
  }

  const renderNode = (node: DOMNode, depth: number = 0) => {
    const hasChildren = node.children && node.children.length > 0
    const isExpanded = expandedNodes.has(node.path)
    const isSelected = selectedElement?.path === node.path
    const paddingLeft = depth * 12

    // Filter based on search
    if (searchQuery && !node.tagName.toLowerCase().includes(searchQuery.toLowerCase())) {
      if (!hasChildren) return null
    }

    return (
      <div key={node.path}>
        <div
          ref={isSelected ? selectedElementRef : null}
          data-dom-path={node.path}
          className={`flex items-start py-0.5 px-2 hover:bg-[#2a2d2e] cursor-pointer font-mono text-xs ${
            isSelected ? 'bg-[#37373d]' : ''
          }`}
          style={{ paddingLeft: `${paddingLeft + 8}px` }}
          onClick={() => onSelectElement(node.path)}
        >
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                toggleNode(node.path)
              }}
              className="mr-1 mt-0.5 flex-shrink-0"
            >
              {isExpanded ? (
                <ChevronDown size={12} className="text-gray-400" />
              ) : (
                <ChevronRight size={12} className="text-gray-400" />
              )}
            </button>
          ) : (
            <span className="mr-1 w-3 flex-shrink-0"></span>
          )}
          <div className="flex-1 overflow-hidden">
            <span className="text-[#569cd6]">&lt;{node.tagName.toLowerCase()}</span>
            {renderAttributes(node.attributes)}
            <span className="text-[#569cd6]">&gt;</span>
            
            {!hasChildren && node.textContent && (
              <span className="text-gray-300">{node.textContent.substring(0, 50)}</span>
            )}
            
            {!hasChildren && (
              <span className="text-[#569cd6]">&lt;/{node.tagName.toLowerCase()}&gt;</span>
            )}
          </div>
        </div>
        
        {hasChildren && isExpanded && (
          <>
            {node.children.map((child) => renderNode(child, depth + 1))}
            <div
              className="flex items-start py-0.5 px-2 hover:bg-[#2a2d2e] cursor-pointer font-mono text-xs"
              style={{ paddingLeft: `${paddingLeft + 20}px` }}
            >
              <span className="text-[#569cd6]">&lt;/{node.tagName.toLowerCase()}&gt;</span>
            </div>
          </>
        )}
      </div>
    )
  }

  const renderStyles = () => {
    if (!selectedElement?.styles) {
      return (
        <div className="text-gray-400 text-sm p-4">
          Select an element to view its styles
        </div>
      )
    }

    const inlineStyles = selectedElement.styles.inline || {}
    const stylesheetRules = (selectedElement.styles.rules || []) as any[]

    const renderValueEditor = (
      prop: string,
      value: unknown,
      update: (newValue: string) => void
    ) => {
      const propLower = prop.toLowerCase()
      const stringValue = String(value ?? '')
      const enumOptions: string[] | undefined = getEnumOptions(propLower)
      const colorProp = isColorProperty(propLower)

      const handleWheel: React.WheelEventHandler<HTMLInputElement> = (e) => {
        // Only adjust when this field is actively focused AND Ctrl is held.
        // This matches your preferred "click + Ctrl + scroll" interaction and
        // avoids accidental edits while scrolling the panel.
        if (!e.ctrlKey) return
        if (document.activeElement !== e.currentTarget) return
        if (!e.currentTarget.value && !stringValue) return
        const direction = e.deltaY < 0 ? 1 : -1
        const currentVal = (e.currentTarget as HTMLInputElement).value || stringValue
        const newVal = adjustNumericValue(currentVal, direction)
        if (newVal && newVal !== currentVal) {
          ;(e.currentTarget as HTMLInputElement).value = newVal
          update(newVal)
        }
      }

      if (colorProp) {
        const { hex, alpha } = parseColor(stringValue)
        const handleColorChange = (newHex: string, newAlpha: number = alpha) => {
          const rgba = hexAndAlphaToRgba(newHex, newAlpha)
          update(rgba)
        }

        return (
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={hex}
              className="w-6 h-4 border border-gray-600 rounded cursor-pointer"
              onChange={(e) => {
                handleColorChange(e.target.value)
              }}
            />
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              defaultValue={Math.round(alpha * 100)}
              className="w-20"
              onChange={(e) => {
                const a = clamp01(parseInt(e.target.value, 10) / 100)
                const label = e.currentTarget.nextElementSibling as HTMLElement | null
                if (label) {
                  label.textContent = `${Math.round(a * 100)}%`
                }
                handleColorChange(hex, a)
              }}
            />
            <span className="text-[10px] text-gray-400 w-8 text-right">
              {Math.round(alpha * 100)}%
            </span>
          </div>
        )
      }

      if (enumOptions && enumOptions.length > 0) {
        return (
          <select
            defaultValue={stringValue}
            className="bg-[#1e1e1e] border border-gray-700 text-xs text-gray-200 rounded px-1 py-0.5"
            onChange={(e) => update(e.target.value)}
          >
            {enumOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        )
      }

      return (
        <input
          className="flex-1 bg-transparent border-b border-gray-700 focus:border-blue-500 outline-none text-[#ce9178] text-xs px-1"
          defaultValue={stringValue}
          list="css-value-suggestions"
          onChange={(e) => {
            const newValue = e.target.value
            update(newValue)
          }}
          onWheel={(e) => {
            e.preventDefault()
            e.stopPropagation()
            handleWheel(e)
          }}
        />
      )
    }

    // Group stylesheet rules by source and maintain cascade order using sheetIndex/ruleIndex
    const groupedRules: any[] = []

    if (stylesheetRules.length > 0) {
      const bySource = new Map<string, any>()
      stylesheetRules.forEach((rule: any) => {
        const src = rule.source || '<style>'
        const existing = bySource.get(src)
        const entry =
          existing ||
          {
            source: src,
            sheetIndex: rule.sheetIndex ?? 0,
            rules: [] as any[]
          }
        entry.rules.push(rule)
        if (!existing) bySource.set(src, entry)
      })

      groupedRules.push(
        ...Array.from(bySource.values()).sort(
          (a: any, b: any) => a.sheetIndex - b.sheetIndex
        )
      )
    }

    return (
      <div className="p-2">
        {inlineOrder.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between text-xs font-semibold text-gray-300 mb-2">
              <span>element.style</span>
              <button
                type="button"
                className="w-4 h-4 flex items-center justify-center rounded bg-[#3e3e42] text-gray-100 hover:bg-[#4e4e52]"
                title="Add property"
                onClick={() => {
                  // Focus will move to the first empty input below; existing Add row handles Enter.
                  const container = stylesContainerRef.current
                  if (container) {
                    const input = container.querySelector(
                      '[data-role="add-style-prop"]'
                    ) as HTMLInputElement | null
                    if (input) {
                      input.focus()
                    }
                  }
                }}
              >
                <span className="text-[11px] leading-none">+</span>
              </button>
            </div>
            <div className="bg-[#1e1e1e] rounded p-2 font-mono text-xs space-y-1">
              {inlineOrder.map((key) => {
                const value = inlineStyles[key]
                if (value === undefined || value === null) return null
                return (
                  <div
                    key={key}
                    className="flex items-center gap-2 cursor-move"
                    draggable
                    onDragStart={() => {
                      dragInlinePropRef.current = key
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      const from = dragInlinePropRef.current
                      dragInlinePropRef.current = null
                      if (!from || from === key) return
                      setInlineOrder((prev) => {
                        const current = [...prev]
                        const fromIndex = current.indexOf(from)
                        const toIndex = current.indexOf(key)
                        if (fromIndex === -1 || toIndex === -1) return prev
                        current.splice(fromIndex, 1)
                        current.splice(toIndex, 0, from)
                        onReorderInlineStyles(current)
                        return current
                      })
                    }}
                    title="Drag to reorder (affects cascade)"
                  >
                  <span
                    className={`w-32 flex-shrink-0 ${
                      isPropChanged('inline', key) ? 'text-yellow-300' : 'text-[#9cdcfe]'
                    }`}
                  >
                    {key}
                  </span>
                  <span className="text-gray-400">:</span>
                  {renderValueEditor(key, value, (newVal) => {
                    const oldValue = String(value ?? '')
                    onUpdateInlineStyle(key, newVal)
                    markChanged('inline', key)
                    recordChange({
                      scope: 'inline',
                      type: 'set',
                      property: key,
                      oldValue,
                      newValue: newVal
                    })
                  })}
                  <span className="text-gray-400">;</span>
                  <button
                    type="button"
                    className="ml-1 w-4 h-4 flex items-center justify-center rounded bg-[#3e3e42] text-gray-300 hover:bg-red-600"
                    title="Remove property"
                    onClick={() => {
                      const oldValue = String(inlineStyles[key] ?? '')
                      recordChange({
                        scope: 'inline',
                        type: 'remove',
                        property: key,
                        oldValue,
                        newValue: null
                      })
                      onRemoveInlineStyle(key)
                      setInlineOrder((prev) => prev.filter((k) => k !== key))
                    }}
                  >
                    <span className="text-[11px] leading-none">×</span>
                  </button>
                </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Add new inline style */}
        <div className="mb-4">
          <div
            className="bg-[#1e1e1e] rounded p-2 font-mono text-xs flex items-center gap-2"
            data-role="add-inline-style-row"
          >
            <input
              data-role="add-style-prop"
              list="css-property-suggestions"
              className="w-40 bg-transparent border-b border-gray-700 focus:border-blue-500 outline-none text-[#9cdcfe] px-1"
              placeholder="property"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const row = (e.currentTarget as HTMLElement).closest(
                    '[data-role="add-inline-style-row"]'
                  ) as HTMLElement | null
                  const propInput = row?.querySelector(
                    '[data-role="add-style-prop"]'
                  ) as HTMLInputElement | null
                  const valueInput = row?.querySelector(
                    '[data-role="add-style-value"]'
                  ) as HTMLInputElement | null

                  const prop = propInput?.value.trim() || ''
                  const val = valueInput?.value.trim() || ''

                  if (prop && val) {
                    onAddInlineStyle(prop, val)
                    markChanged('inline', prop)
                    recordChange({
                      scope: 'inline',
                      type: 'set',
                      property: prop,
                      oldValue: null,
                      newValue: val
                    })
                    if (propInput) propInput.value = ''
                    if (valueInput) valueInput.value = ''
                  } else if (!val && valueInput) {
                    // If the user hit Enter after typing only the property,
                    // move focus to the value field like Chrome DevTools.
                    valueInput.focus()
                  }
                }
              }}
            />
            <span className="text-gray-400">:</span>
            <input
              data-role="add-style-value"
              list="css-value-suggestions"
              className="flex-1 bg-transparent border-b border-gray-700 focus:border-blue-500 outline-none text-[#ce9178] px-1"
              placeholder="value"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const row = (e.currentTarget as HTMLElement).closest(
                    '[data-role="add-inline-style-row"]'
                  ) as HTMLElement | null
                  const propInput = row?.querySelector(
                    '[data-role="add-style-prop"]'
                  ) as HTMLInputElement | null
                  const valueInput = row?.querySelector(
                    '[data-role="add-style-value"]'
                  ) as HTMLInputElement | null

                  const prop = propInput?.value.trim() || ''
                  const val = valueInput?.value.trim() || ''

                  if (prop && val) {
                    onAddInlineStyle(prop, val)
                    markChanged('inline', prop)
                    recordChange({
                      scope: 'inline',
                      type: 'set',
                      property: prop,
                      oldValue: null,
                      newValue: val
                    })
                    if (propInput) propInput.value = ''
                    if (valueInput) valueInput.value = ''
                  }
                }
              }}
            />
            <span className="text-gray-400">;</span>
          </div>
        </div>

        {groupedRules.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-gray-300 mb-2">Matched CSS Rules</div>
            <div className="bg-[#1e1e1e] rounded p-2 font-mono text-xs space-y-3">
              {groupedRules.map((group) => {
                const rulesInOrder = [...group.rules].sort(
                  (a, b) => (a.ruleIndex ?? 0) - (b.ruleIndex ?? 0)
                )
                const { label: sourceLabel, title: sourceTitle } = getStylesheetLabelAndTitle(
                  group.source
                )

                return (
                  <div key={group.source} data-rule-group-source={group.source}>
                    <div
                      className="mb-1 text-[11px] font-semibold text-[#ffd700] break-all flex items-center justify-between"
                      title={sourceTitle}
                    >
                      <span className="truncate max-w-[75%]">{sourceLabel}</span>
                      <button
                        type="button"
                        className="ml-2 w-4 h-4 flex items-center justify-center rounded bg-[#3e3e42] text-gray-100 hover:bg-[#4e4e52]"
                        title="Add override property for this stylesheet (element.style override)"
                        onClick={(e) => {
                          const groupEl = (e.currentTarget.closest(
                            '[data-rule-group-source]'
                          ) as HTMLElement | null)!
                          const input = groupEl.querySelector(
                            '[data-role="add-rule-prop"]'
                          ) as HTMLInputElement | null
                          if (input) {
                            input.focus()
                          }
                        }}
                      >
                        <span className="text-[11px] leading-none">+</span>
                      </button>
                    </div>
                    <div className="space-y-2">
                      {rulesInOrder.map((rule: any, index: number) => (
                        <div key={`${group.source}-${index}`}>
                          <div className="flex mb-1">
                            <span className="text-[#c586c0]">{rule.selector}</span>
                          </div>
                          <div className="pl-4 space-y-0.5">
                            {Object.entries(rule.style || {}).map(([prop, value]) => (
                              <div key={prop} className="flex items-center gap-2">
                                <span
                                  className={`w-40 flex-shrink-0 ${
                                    isPropChanged('rule', prop as string)
                                      ? 'text-yellow-300'
                                      : 'text-[#9cdcfe]'
                                  }`}
                                >
                                  {prop}
                                </span>
                                <span className="text-gray-400">: </span>
                                {renderValueEditor(prop as string, value, (newVal) => {
                                  const oldValue = String(value ?? '')
                                  onUpdateRuleStyle(
                                    rule.sheetIndex,
                                    rule.ruleIndex,
                                    prop as string,
                                    newVal
                                  )
                                  markChanged('rule', prop as string)
                                  recordChange({
                                    scope: 'rule',
                                    type: 'set',
                                    property: prop as string,
                                    oldValue,
                                    newValue: newVal,
                                    selector: rule.selector,
                                    source: group.source
                                  })
                                })}
                                <span className="text-gray-400">;</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                      {/* Add override property row scoped to this stylesheet */}
                      <div
                        className="flex items-center gap-2 mt-1"
                        data-role="add-rule-row"
                      >
                        <input
                          data-role="add-rule-prop"
                          list="css-property-suggestions"
                          className="w-40 bg-transparent border-b border-gray-700 focus:border-blue-500 outline-none text-[#9cdcfe] px-1"
                          placeholder="property"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const row = (e.currentTarget as HTMLElement).closest(
                                '[data-role="add-rule-row"]'
                              ) as HTMLElement | null
                              const propInput = row?.querySelector(
                                '[data-role="add-rule-prop"]'
                              ) as HTMLInputElement | null
                              const valueInput = row?.querySelector(
                                '[data-role="add-rule-value"]'
                              ) as HTMLInputElement | null

                              const prop = propInput?.value.trim() || ''
                              const val = valueInput?.value.trim() || ''

                              if (prop && val) {
                                const primaryRule = rulesInOrder[0]
                                if (primaryRule) {
                                  onUpdateRuleStyle(
                                    primaryRule.sheetIndex,
                                    primaryRule.ruleIndex,
                                    prop,
                                    val
                                  )
                                }
                                markChanged('rule', prop)
                                recordChange({
                                  scope: 'rule',
                                  type: 'set',
                                  property: prop,
                                  oldValue: null,
                                  newValue: val,
                                  selector: primaryRule?.selector,
                                  source: group.source
                                })
                                if (propInput) propInput.value = ''
                                if (valueInput) valueInput.value = ''
                              } else if (!val && valueInput) {
                                valueInput.focus()
                              }
                            }
                          }}
                        />
                        <span className="text-gray-400">: </span>
                        <input
                          data-role="add-rule-value"
                          list="css-value-suggestions"
                          className="flex-1 bg-transparent border-b border-gray-700 focus:border-blue-500 outline-none text-[#ce9178] px-1"
                          placeholder="value"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const row = (e.currentTarget as HTMLElement).closest(
                                '[data-role="add-rule-row"]'
                              ) as HTMLElement | null
                              const propInput = row?.querySelector(
                                '[data-role="add-rule-prop"]'
                              ) as HTMLInputElement | null
                              const valueInput = row?.querySelector(
                                '[data-role="add-rule-value"]'
                              ) as HTMLInputElement | null

                              const prop = propInput?.value.trim() || ''
                              const val = valueInput?.value.trim() || ''

                              if (prop && val) {
                                const primaryRule = rulesInOrder[0]
                                if (primaryRule) {
                                  onUpdateRuleStyle(
                                    primaryRule.sheetIndex,
                                    primaryRule.ruleIndex,
                                    prop,
                                    val
                                  )
                                }
                                markChanged('rule', prop)
                                recordChange({
                                  scope: 'rule',
                                  type: 'set',
                                  property: prop,
                                  oldValue: null,
                                  newValue: val,
                                  selector: primaryRule?.selector,
                                  source: group.source
                                })
                                if (propInput) propInput.value = ''
                                if (valueInput) valueInput.value = ''
                              }
                            }
                          }}
                        />
                        <span className="text-gray-400">;</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  }

  const renderComputedStyles = () => {
    if (!selectedElement?.styles) {
      return (
        <div className="text-gray-400 text-sm p-4">
          Select an element to view its computed styles
        </div>
      )
    }

    const computedStyles = selectedElement.styles.computed || {}

    return (
      <div className="p-2 h-full flex flex-col">
        <div className="mb-2">
          <input
            type="text"
            placeholder="Filter computed styles"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#1e1e1e] border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 outline-none"
          />
        </div>
        <div className="bg-[#1e1e1e] rounded p-2 font-mono text-xs overflow-auto flex-1">
          {Object.entries(computedStyles)
            .filter(([key]) =>
              !searchQuery ? true : key.toLowerCase().includes(searchQuery.toLowerCase())
            )
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([key, value]) => (
              <div key={key} className="mb-1 flex">
                <span className="text-[#9cdcfe] w-48 flex-shrink-0">{key}</span>
                <span className="text-gray-400">: </span>
                <span className="text-[#ce9178] break-all ml-1">{String(value)}</span>
              </div>
            ))}
        </div>
      </div>
    )
  }

  const renderChanges = () => {
    if (changes.length === 0) {
      return (
        <div className="text-gray-400 text-sm p-4">
          No changes yet. Edit styles or text to see them here.
        </div>
      )
    }

    return (
      <div className="p-2 h-full flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-300">
            {changes.length} change{changes.length !== 1 ? 's' : ''}
          </span>
          {onSaveChanges && (
            <button
              type="button"
              className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-default"
              onClick={() => {
                if (!onSaveChanges) return
                const textByPath = new Map<
                  string,
                  { path: string; oldText: string; newText: string; kind?: 'text' | 'html' }
                >()
                const inlineByPathProp = new Map<
                  string,
                  {
                    path: string
                    property: string
                    oldValue: string | null
                    newValue: string | null
                  }
                >()

                changes.forEach((change) => {
                  if (change.active === false) return

                  // Aggregate text content edits (innerText / innerHTML)
                  if (change.scope === 'text' && change.type === 'set' && change.elementPath) {
                    if (typeof change.newValue === 'string') {
                      const path = change.elementPath
                      const oldText =
                        typeof change.oldValue === 'string' ? change.oldValue : ''
                      const newText = change.newValue || ''
                      textByPath.set(path, {
                        path,
                        oldText,
                        newText,
                        kind: change.contentKind
                      })
                    }
                    return
                  }

                  // Aggregate element.style inline edits
                  if (
                    change.scope === 'inline' &&
                    change.elementPath &&
                    typeof change.property === 'string'
                  ) {
                    const key = `${change.elementPath}::${change.property}`
                    const oldValue =
                      typeof change.oldValue === 'string' ? change.oldValue : null
                    const newValue =
                      typeof change.newValue === 'string' ? change.newValue : null

                    inlineByPathProp.set(key, {
                      path: change.elementPath,
                      property: change.property,
                      oldValue,
                      newValue
                    })
                  }
                })

                onSaveChanges({
                  textChanges: Array.from(textByPath.values()),
                  inlineStyleChanges: Array.from(inlineByPathProp.values())
                })
              }}
              disabled={changes.length === 0}
            >
              Save to files
            </button>
          )}
        </div>
        <div className="bg-[#1e1e1e] rounded p-2 font-mono text-xs overflow-auto flex-1 space-y-1">
          {changes.map((change) => {
            const locationLabel =
              change.scope === 'inline'
                ? 'element.style'
                : change.scope === 'rule'
                ? change.selector || 'rule'
                : 'text content'

            const sourceLabel =
              change.source !== undefined && change.source !== null
                ? getStylesheetLabelAndTitle(change.source).label
                : undefined

            let summary = ''
            if (change.type === 'set') {
              if (change.scope === 'text') {
                const label = 'text'
                const oldVal = change.oldValue ?? ''
                const newVal = change.newValue ?? ''
                if (oldVal === '') {
                  summary = `${label}: ${JSON.stringify(newVal)}`
                } else {
                  summary = `${label}: ${JSON.stringify(oldVal)} → ${JSON.stringify(
                    newVal
                  )}`
                }
              } else {
                if (change.oldValue == null || change.oldValue === '') {
                  summary = `${change.property}: ${change.newValue}`
                } else {
                  summary = `${change.property}: ${change.oldValue} → ${change.newValue}`
                }
              }
            } else if (change.type === 'remove') {
              summary = `${change.property} removed (was ${change.oldValue})`
            } else if (change.type === 'reorder') {
              summary = 'Reordered inline properties'
            }

            const canToggle =
              (change.scope === 'text' &&
                !!onToggleTextChange &&
                typeof change.newValue === 'string') ||
              (change.scope !== 'text' &&
                !!change.property &&
                (change.type === 'set' || change.type === 'remove'))
            const isDisabled = change.active === false

            return (
              <div
                key={change.id}
                className="flex flex-col border-b border-gray-800 pb-1 last:border-0"
              >
                <div className="flex justify-between items-center">
                  <span className="text-[#9cdcfe] mr-2 truncate max-w-[55%]">
                    {locationLabel}
                  </span>
                  <div className="flex items-center gap-1 max-w-[40%] justify-end">
                    {sourceLabel && (
                      <span className="text-[10px] text-gray-500 truncate">
                        {sourceLabel}
                      </span>
                    )}
                    {canToggle && (
                      <button
                        type="button"
                        className={`ml-1 w-4 h-4 flex items-center justify-center rounded flex-shrink-0 ${
                          isDisabled
                            ? 'bg-[#3e3e42] text-gray-200 hover:bg-green-600'
                            : 'bg-[#3e3e42] text-gray-300 hover:bg-red-600'
                        }`}
                        title={
                          isDisabled ? 'Undo delete (re-apply this change)' : 'Temporarily disable this change'
                        }
                        onClick={() => {
                          const currentlyActive = change.active !== false
                          const willBeActive = !currentlyActive

                          // Update active flag for this change entry
                          setChanges((prev) =>
                            prev.map((entry) =>
                              entry.id === change.id ? { ...entry, active: willBeActive } : entry
                            )
                          )

                          if (change.scope === 'text') {
                            if (!onToggleTextChange) return
                            const path = change.elementPath || ''
                            if (!path) return
                            const oldText = (change.oldValue ?? '') as string
                            const newText = (change.newValue ?? '') as string
                            onToggleTextChange({
                              path,
                              oldText,
                              newText,
                              enable: willBeActive,
                              kind: change.contentKind
                            })
                          } else if (change.scope === 'inline') {
                            if (!change.property) return
                            if (change.type === 'set') {
                              if (currentlyActive) {
                                // Disable: revert to old value
                                if (!change.oldValue) {
                                  onRemoveInlineStyle(change.property)
                                } else {
                                  onUpdateInlineStyle(change.property, change.oldValue)
                                  markChanged('inline', change.property)
                                }
                              } else {
                                // Re-enable: apply new value again
                                if (!change.newValue) {
                                  onRemoveInlineStyle(change.property)
                                } else {
                                  onUpdateInlineStyle(change.property, change.newValue)
                                  markChanged('inline', change.property)
                                }
                              }
                            } else if (change.type === 'remove') {
                              if (currentlyActive) {
                                // Disable deletion: restore old value
                                if (change.oldValue) {
                                  onUpdateInlineStyle(change.property, change.oldValue)
                                  markChanged('inline', change.property)
                                }
                              } else {
                                // Re-enable deletion: remove again
                                onRemoveInlineStyle(change.property)
                              }
                            }
                          } else if (change.scope === 'rule') {
                            if (!change.selector || !change.source) return
                            const stylesheetRules = (selectedElement?.styles?.rules ||
                              []) as any[]
                            const targetRule = stylesheetRules.find(
                              (r) =>
                                r.selector === change.selector &&
                                r.source === change.source
                            )
                            if (!targetRule) return

                            const sheetIndex = targetRule.sheetIndex
                            const ruleIndex = targetRule.ruleIndex
                            if (
                              typeof sheetIndex !== 'number' ||
                              typeof ruleIndex !== 'number'
                            ) {
                              return
                            }

                            if (change.type === 'set') {
                              // For rules we treat disable as reverting to old value (or clearing if none),
                              // and re-enable as applying the new value again.
                              if (currentlyActive) {
                                const revertVal =
                                  change.oldValue !== undefined && change.oldValue !== null
                                    ? change.oldValue
                                    : ''
                                onUpdateRuleStyle(
                                  sheetIndex,
                                  ruleIndex,
                                  change.property || '',
                                  revertVal
                                )
                                if (change.oldValue) {
                                  markChanged('rule', change.property || '')
                                }
                              } else if (change.newValue !== undefined && change.newValue !== null) {
                                onUpdateRuleStyle(
                                  sheetIndex,
                                  ruleIndex,
                                  change.property || '',
                                  change.newValue
                                )
                                markChanged('rule', change.property || '')
                              }
                            }
                          }
                        }}
                      >
                        <span className="text-[11px] leading-none">
                          {isDisabled ? '↺' : '×'}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
                <div
                  className={`text-[11px] break-all ${
                    isDisabled ? 'text-gray-500' : 'text-[#ce9178]'
                  }`}
                >
                  {summary}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // Fixed heights (in pixels) for layout calculations.
  const HEADER_HEIGHT = 32
  const FOOTER_HEIGHT = selectedElement ? 28 : 0

  return (
    <div 
      ref={panelRef}
      className="h-full bg-[#252526] text-gray-300 border-l border-gray-700 relative"
      style={{
        width: `${width}px`,
        userSelect: isDraggingWidth ? 'none' : 'auto',
        overflow: 'hidden'
      }}
    >
      {/* Width resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-blue-500 z-50"
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          widthDragStartRef.current = { startX: e.clientX, startWidth: width }
          setIsDraggingWidth(true)
        }}
      />

      {/* Header (fixed at top) */}
      <div
        className="absolute left-0 right-0 flex items-center justify-between bg-[#2d2d30] px-3 border-b border-gray-700"
        style={{ top: 0, height: HEADER_HEIGHT }}
      >
        <div className="flex items-center gap-3">
          <div className="flex text-xs rounded overflow-hidden border border-gray-700">
            <button
              className={`px-2 py-1 ${
                activeTab === 'elements'
                  ? 'bg-[#3e3e42] text-white'
                  : 'bg-transparent text-gray-300 hover:bg-[#3e3e42]/60'
              }`}
              onClick={() => setActiveTab('elements')}
            >
              Elements
            </button>
            <button
              className={`px-2 py-1 border-l border-gray-700 ${
                activeTab === 'computed'
                  ? 'bg-[#3e3e42] text-white'
                  : 'bg-transparent text-gray-300 hover:bg-[#3e3e42]/60'
              }`}
              onClick={() => setActiveTab('computed')}
            >
              Computed
            </button>
            <button
              className={`px-2 py-1 border-l border-gray-700 ${
                activeTab === 'changes'
                  ? 'bg-[#3e3e42] text-white'
                  : 'bg-transparent text-gray-300 hover:bg-[#3e3e42]/60'
              }`}
              onClick={() => setActiveTab('changes')}
            >
              Changes
            </button>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-600 rounded"
          title="Close DevTools"
        >
          <X size={14} />
        </button>
      </div>

      {activeTab === 'elements' && (
        <>
          {/* Elements section: positioned between header and styles/footer, scrolls internally */}
          <div
            className="absolute left-0 right-0 border-b border-gray-700 bg-[#252526] flex flex-col"
            style={{
              top: HEADER_HEIGHT,
              bottom: stylesHeight + FOOTER_HEIGHT
            }}
          >
            {/* Search bar */}
            <div className="p-2 border-b border-gray-700">
              <div className="flex items-center bg-[#1e1e1e] rounded px-2 py-1">
                <Search size={12} className="text-gray-400 mr-2" />
                <input
                  type="text"
                  placeholder="Find by string, selector, or XPath"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-transparent text-xs outline-none flex-1 text-gray-300"
                />
              </div>
            </div>

            {/* DOM Tree scroll area */}
            <div
              ref={domTreeContainerRef}
              className="overflow-auto"
              style={{ flex: 1, minHeight: 0 }}
            >
              {selectedElement?.domTree ? (
                renderNode(selectedElement.domTree)
              ) : (
                <div className="text-gray-400 text-sm p-4">
                  Right-click on an element in the preview to inspect it
                </div>
              )}
            </div>
          </div>

          {/* Styles section: adjustable band above footer, scrolls independently */}
          <div
            className="absolute left-0 right-0 bg-[#252526] border-t border-gray-700 flex flex-col"
            style={{
              height: stylesHeight,
              bottom: FOOTER_HEIGHT
            }}
          >
            <div
              className="flex items-center justify-between px-3 py-1 border-b border-gray-700 bg-[#2d2d30] cursor-ns-resize"
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setIsDraggingSplit(true)
              }}
            >
              <span className="text-xs font-semibold text-gray-200">Styles</span>
            </div>
            <div
              ref={stylesContainerRef}
              className="overflow-auto"
              style={{ flex: 1, minHeight: 0 }}
            >
              {renderStyles()}
            </div>
          </div>
        </>
      )}

      {activeTab === 'computed' && (
        <div
          className="absolute left-0 right-0 bg-[#252526] border-t border-gray-700 flex flex-col"
          style={{
            top: HEADER_HEIGHT,
            bottom: FOOTER_HEIGHT
          }}
        >
          {renderComputedStyles()}
        </div>
      )}

      {activeTab === 'changes' && (
        <div
          className="absolute left-0 right-0 bg-[#252526] border-t border-gray-700 flex flex-col"
          style={{
            top: HEADER_HEIGHT,
            bottom: FOOTER_HEIGHT
          }}
        >
          {renderChanges()}
        </div>
      )}

      {/* Global datalists for autocomplete suggestions */}
      <datalist id="css-property-suggestions">
        {CSS_PROPERTY_SUGGESTIONS.map((prop) => (
          <option key={prop} value={prop} />
        ))}
      </datalist>
      <datalist id="css-value-suggestions">
        {CSS_VALUE_SUGGESTIONS.map((val) => (
          <option key={val} value={val} />
        ))}
      </datalist>

      {/* Selected element info footer: fixed at bottom */}
      {selectedElement && (
        <div
          className="absolute left-0 right-0 bg-[#2d2d30] border-t border-gray-700 px-3 py-1"
          style={{ bottom: 0, height: FOOTER_HEIGHT }}
        >
          <div className="text-xs font-mono">
            <span className="text-[#569cd6]">&lt;{selectedElement.tagName?.toLowerCase() || 'unknown'}&gt;</span>
            {selectedElement.id && <span className="text-[#9cdcfe]">#{selectedElement.id}</span>}
            {selectedElement.className && <span className="text-[#9cdcfe]">.{selectedElement.className.split(' ').join('.')}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

export default InspectPanel

