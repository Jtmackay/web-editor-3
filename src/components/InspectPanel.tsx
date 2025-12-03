import React, { useState, useEffect, useRef } from 'react'
import { ChevronRight, ChevronDown, X, Search } from 'lucide-react'

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
}

const InspectPanel: React.FC<InspectPanelProps> = ({ selectedElement, onClose, onSelectElement, width, onWidthChange }) => {
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [splitPosition, setSplitPosition] = useState(60) // percentage
  const [isDraggingWidth, setIsDraggingWidth] = useState(false)
  const [isDraggingSplit, setIsDraggingSplit] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const selectedElementRef = useRef<HTMLDivElement>(null)
  const widthDragStartRef = useRef<{ startX: number; startWidth: number } | null>(null)

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
      if (!panelRef.current) return

      // Prefer querying by data attribute so we always find the right row,
      // even if the ref isn't attached yet for some reason.
      const target = panelRef.current.querySelector(
        `[data-dom-path="${path}"]`
      ) as HTMLElement | null

      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } else if (selectedElementRef.current) {
        selectedElementRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
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

  // Handle split position dragging
  useEffect(() => {
    if (!isDraggingSplit || !panelRef.current) return

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault()
      const rect = panelRef.current!.getBoundingClientRect()
      const y = e.clientY - rect.top
      const percentage = (y / rect.height) * 100
      if (percentage >= 20 && percentage <= 80) {
        setSplitPosition(percentage)
      }
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
  }, [isDraggingSplit])

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

    const computedStyles = selectedElement.styles.computed || {}
    const inlineStyles = selectedElement.styles.inline || {}

    return (
      <div className="p-2 overflow-auto h-full">
        {Object.keys(inlineStyles).length > 0 && (
          <div className="mb-4">
            <div className="text-xs font-semibold text-gray-300 mb-2">element.style</div>
            <div className="bg-[#1e1e1e] rounded p-2 font-mono text-xs">
              {Object.entries(inlineStyles).map(([key, value]) => (
                <div key={key} className="mb-1">
                  <span className="text-[#9cdcfe]">{key}</span>
                  <span className="text-gray-400">: </span>
                  <span className="text-[#ce9178]">{String(value)}</span>
                  <span className="text-gray-400">;</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="text-xs font-semibold text-gray-300 mb-2">Computed Styles</div>
          <div className="bg-[#1e1e1e] rounded p-2 font-mono text-xs">
            {Object.entries(computedStyles)
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([key, value]) => (
                <div key={key} className="mb-1 flex">
                  <span className="text-[#9cdcfe] w-48 flex-shrink-0">{key}</span>
                  <span className="text-gray-400">: </span>
                  <span className="text-[#ce9178] break-all">{String(value)}</span>
                </div>
              ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div 
      ref={panelRef}
      className="flex flex-col h-full bg-[#252526] text-gray-300 border-l border-gray-700 relative"
      style={{ width: `${width}px`, userSelect: isDraggingWidth || isDraggingSplit ? 'none' : 'auto' }}
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

      {/* Header */}
      <div className="flex items-center justify-between bg-[#2d2d30] px-3 py-2 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Elements</span>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-600 rounded"
            title="Close DevTools"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Elements section */}
      <div className="overflow-auto" style={{ height: `${splitPosition}%` }}>
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

        {/* DOM Tree */}
        <div className="overflow-auto">
          {selectedElement?.domTree ? (
            renderNode(selectedElement.domTree)
          ) : (
            <div className="text-gray-400 text-sm p-4">
              Right-click on an element in the preview to inspect it
            </div>
          )}
        </div>
      </div>

      {/* Split handle */}
      <div
        className="h-1 bg-[#2d2d30] cursor-ns-resize hover:bg-blue-500 flex items-center justify-center"
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setIsDraggingSplit(true)
        }}
      >
        <div className="w-12 h-0.5 bg-gray-600 rounded"></div>
      </div>

      {/* Styles section */}
      <div className="flex-1 overflow-auto">
        {renderStyles()}
      </div>

      {/* Selected element info footer */}
      {selectedElement && (
        <div className="bg-[#2d2d30] border-t border-gray-700 px-3 py-1">
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

