import React, { useState, useEffect } from 'react'
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
}

const InspectPanel: React.FC<InspectPanelProps> = ({ selectedElement, onClose, onSelectElement }) => {
  const [activeTab, setActiveTab] = useState<'elements' | 'styles'>('elements')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())

  useEffect(() => {
    // Auto-expand path to selected element
    if (selectedElement?.path) {
      const pathParts = selectedElement.path.split('>')
      const newExpanded = new Set(expandedNodes)
      let currentPath = ''
      pathParts.forEach((part: string, index: number) => {
        if (index < pathParts.length - 1) {
          currentPath += (currentPath ? '>' : '') + part
          newExpanded.add(currentPath)
        }
      })
      setExpandedNodes(newExpanded)
    }
  }, [selectedElement?.path])

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
    <div className="flex flex-col h-full bg-[#252526] text-gray-300 border-l border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between bg-[#2d2d30] px-3 py-2 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">DevTools</span>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-600 rounded"
            title="Close DevTools"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-[#2d2d30] border-b border-gray-700">
        <button
          className={`px-4 py-2 text-xs font-medium ${
            activeTab === 'elements'
              ? 'text-white border-b-2 border-blue-500'
              : 'text-gray-400 hover:text-white'
          }`}
          onClick={() => setActiveTab('elements')}
        >
          Elements
        </button>
        <button
          className={`px-4 py-2 text-xs font-medium ${
            activeTab === 'styles'
              ? 'text-white border-b-2 border-blue-500'
              : 'text-gray-400 hover:text-white'
          }`}
          onClick={() => setActiveTab('styles')}
        >
          Styles
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'elements' ? (
          <div className="h-full flex flex-col">
            {/* Search bar */}
            <div className="p-2 border-b border-gray-700">
              <div className="flex items-center bg-[#1e1e1e] rounded px-2 py-1">
                <Search size={12} className="text-gray-400 mr-2" />
                <input
                  type="text"
                  placeholder="Search elements..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-transparent text-xs outline-none flex-1 text-gray-300"
                />
              </div>
            </div>

            {/* DOM Tree */}
            <div className="flex-1 overflow-auto">
              {selectedElement?.domTree ? (
                renderNode(selectedElement.domTree)
              ) : (
                <div className="text-gray-400 text-sm p-4">
                  Right-click on an element in the preview to inspect it
                </div>
              )}
            </div>
          </div>
        ) : (
          renderStyles()
        )}
      </div>

      {/* Selected element info */}
      {selectedElement && (
        <div className="bg-[#2d2d30] border-t border-gray-700 p-2">
          <div className="text-xs">
            <div className="text-gray-400">Selected:</div>
            <div className="font-mono text-[#569cd6] mt-1">
              &lt;{selectedElement.tagName?.toLowerCase() || 'unknown'}&gt;
            </div>
            {selectedElement.id && (
              <div className="text-gray-300 mt-1">
                id: <span className="text-[#ce9178]">"{selectedElement.id}"</span>
              </div>
            )}
            {selectedElement.className && (
              <div className="text-gray-300 mt-1">
                class: <span className="text-[#ce9178]">"{selectedElement.className}"</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default InspectPanel

