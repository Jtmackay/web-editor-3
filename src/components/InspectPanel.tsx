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
  // Simple hex
  if (v.startsWith('#')) {
    const rgb = hexToRgb(v)
    if (rgb) {
      return { hex: rgbToHex(rgb.r, rgb.g, rgb.b), alpha: 1 }
    }
  }
  // rgb/rgba()
  const m = v.match(/rgba?\s*\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)/i)
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
}

const InspectPanel: React.FC<InspectPanelProps> = ({
  selectedElement,
  onClose,
  onSelectElement,
  width,
  onWidthChange,
  onUpdateInlineStyle,
  onAddInlineStyle
}) => {
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [isDraggingWidth, setIsDraggingWidth] = useState(false)
  const [isDraggingSplit, setIsDraggingSplit] = useState(false)
  const [stylesHeight, setStylesHeight] = useState(180)
  const [activeTab, setActiveTab] = useState<'elements' | 'computed'>('elements')
  const [changedProps, setChangedProps] = useState<Set<string>>(new Set())
  const panelRef = useRef<HTMLDivElement>(null)
  const selectedElementRef = useRef<HTMLDivElement>(null)
  const domTreeContainerRef = useRef<HTMLDivElement>(null)
  const stylesContainerRef = useRef<HTMLDivElement>(null)
  const widthDragStartRef = useRef<{ startX: number; startWidth: number } | null>(null)

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
      const enumOptions = getEnumOptions(propLower)
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
    const groupedRules: {
      source: string
      sheetIndex: number
      rules: any[]
    }[] = []

    if (stylesheetRules.length > 0) {
      const bySource = new Map<string, { source: string; sheetIndex: number; rules: any[] }>()
      stylesheetRules.forEach((rule: any) => {
        const src = rule.source || '<style>'
        const existing = bySource.get(src)
        const entry =
          existing ||
          {
            source: src,
            sheetIndex: rule.sheetIndex ?? 0,
            rules: []
          }
        entry.rules.push(rule)
        if (!existing) bySource.set(src, entry)
      })

      groupedRules.push(
        ...Array.from(bySource.values()).sort((a, b) => a.sheetIndex - b.sheetIndex)
      )
    }

    return (
      <div className="p-2">
        {Object.keys(inlineStyles).length > 0 && (
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
              {Object.entries(inlineStyles).map(([key, value]) => (
                <div key={key} className="flex items-center gap-2">
                  <span
                    className={`w-32 flex-shrink-0 ${
                      isPropChanged('inline', key) ? 'text-yellow-300' : 'text-[#9cdcfe]'
                    }`}
                  >
                    {key}
                  </span>
                  <span className="text-gray-400">:</span>
                  {renderValueEditor(key, value, (newVal) => {
                    onUpdateInlineStyle(key, newVal)
                    markChanged('inline', key)
                  })}
                  <span className="text-gray-400">;</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add new inline style */}
        <div className="mb-4">
          <div className="bg-[#1e1e1e] rounded p-2 font-mono text-xs flex items-center gap-2">
            <input
              data-role="add-style-prop"
              className="w-40 bg-transparent border-b border-gray-700 focus:border-blue-500 outline-none text-[#9cdcfe] px-1"
              placeholder="property"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const prop = (e.currentTarget as HTMLInputElement).value.trim()
                  const valueInput = (e.currentTarget.nextSibling as HTMLInputElement | null)
                  const val = valueInput?.value.trim() || ''
                    if (prop && val) {
                      onAddInlineStyle(prop, val)
                      markChanged('inline', prop)
                      ;(e.currentTarget as HTMLInputElement).value = ''
                      if (valueInput) valueInput.value = ''
                    }
                }
              }}
            />
            <span className="text-gray-400">:</span>
            <input
              className="flex-1 bg-transparent border-b border-gray-700 focus:border-blue-500 outline-none text-[#ce9178] px-1"
              placeholder="value"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const valueInput = e.currentTarget as HTMLInputElement
                  const propInput = valueInput.previousSibling as HTMLInputElement | null
                  const prop = propInput?.value.trim() || ''
                  const val = valueInput.value.trim()
                  if (prop && val) {
                    onAddInlineStyle(prop, val)
                    markChanged('inline', prop)
                    valueInput.value = ''
                    if (propInput) propInput.value = ''
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
                                  // Editing a rule property applies an inline override on the element
                                  onUpdateInlineStyle(prop as string, newVal)
                                  markChanged('rule', prop as string)
                                })}
                                <span className="text-gray-400">;</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                      {/* Add override property row scoped to this stylesheet (still writes inline) */}
                      <div className="flex items-center gap-2 mt-1">
                        <input
                          data-role="add-rule-prop"
                          className="w-40 bg-transparent border-b border-gray-700 focus:border-blue-500 outline-none text-[#9cdcfe] px-1"
                          placeholder="property"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const prop = (e.currentTarget as HTMLInputElement).value.trim()
                              const valueInput = (e.currentTarget.nextSibling as HTMLInputElement | null)
                              const val = valueInput?.value.trim() || ''
                              if (prop && val) {
                                onAddInlineStyle(prop, val)
                                markChanged('inline', prop)
                                ;(e.currentTarget as HTMLInputElement).value = ''
                                if (valueInput) valueInput.value = ''
                              }
                            }
                          }}
                        />
                        <span className="text-gray-400">: </span>
                        <input
                          className="flex-1 bg-transparent border-b border-gray-700 focus:border-blue-500 outline-none text-[#ce9178] px-1"
                          placeholder="value"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const valueInput = e.currentTarget as HTMLInputElement
                              const propInput = valueInput.previousSibling as HTMLInputElement | null
                              const prop = propInput?.value.trim() || ''
                              const val = valueInput.value.trim()
                              if (prop && val) {
                                onAddInlineStyle(prop, val)
                                markChanged('inline', prop)
                                valueInput.value = ''
                                if (propInput) propInput.value = ''
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

