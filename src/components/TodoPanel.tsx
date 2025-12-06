import React, { useMemo, useState, useCallback } from 'react'
import { Filter, Folder, ListTree, List, File, FileCode, FileJson, FileText, Image as ImageIcon, Archive as ArchiveIcon } from 'lucide-react'
import { useFTPStore, FileStatus } from '../stores/ftpStore'
import { useEditorStore } from '../stores/editorStore'
import { electronAPI } from '../utils/electronAPI'

type StatusFilter = 'all' | FileStatus
type ViewMode = 'nested' | 'flat'

interface TodoItem {
  path: string
  name: string
  status: FileStatus
}

interface TodoNode {
  name: string
  path: string
  isDirectory: boolean
  status?: FileStatus
  children?: TodoNode[]
}

const getStatusTextClass = (status?: FileStatus): string => {
  if (!status) return 'text-vscode-text'
  switch (status) {
    case 'finished':
      return 'text-green-400'
    case 'needs_work':
      return 'text-yellow-300'
    case 'not_finished':
      return 'text-red-400'
    default:
      return 'text-vscode-text'
  }
}

const getStatusDotClass = (status: FileStatus): string => {
  switch (status) {
    case 'finished':
      return 'bg-green-400'
    case 'needs_work':
      return 'bg-yellow-300'
    case 'not_finished':
      return 'bg-red-400'
    default:
      return 'bg-vscode-text-muted'
  }
}

const getFileIcon = (name: string) => {
  const ext = name.split('.').pop()?.toLowerCase()

  switch (ext) {
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
      return <FileCode size={14} className="text-amber-300" />
    case 'html':
    case 'htm':
      return <FileCode size={14} className="text-green-400" />
    case 'css':
    case 'scss':
    case 'sass':
      return <FileCode size={14} className="text-sky-300" />
    case 'json':
      return <FileJson size={14} className="text-emerald-300" />
    case 'md':
    case 'markdown':
      return <FileText size={14} className="text-slate-200" />
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'bmp':
    case 'svg':
    case 'webp':
      return <ImageIcon size={14} className="text-pink-300" />
    case 'zip':
    case 'gz':
    case 'tar':
    case 'rar':
    case '7z':
      return <ArchiveIcon size={14} className="text-yellow-500" />
    default:
      return <File size={14} className="text-gray-400" />
  }
}

const getLanguageFromExtension = (filename: string): string => {
  const ext = filename.split('.').pop()?.toLowerCase()
  const languageMap: Record<string, string> = {
    js: 'javascript',
    ts: 'typescript',
    jsx: 'javascript',
    tsx: 'typescript',
    py: 'python',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    htm: 'html',
    html: 'html',
    css: 'css',
    json: 'json',
    md: 'markdown',
    xml: 'xml',
    yml: 'yaml',
    yaml: 'yaml'
  }
  return (ext && languageMap[ext]) || 'plaintext'
}

const buildNestedTree = (items: TodoItem[]): TodoNode[] => {
  const rootMap = new Map<string, TodoNode>()

  items.forEach((item) => {
    const normalized = String(item.path || '').replace(/\\/g, '/')
    const parts = normalized.split('/').filter(Boolean)
    let currentMap = rootMap
    let currentPath = ''

    parts.forEach((part, index) => {
      const isLast = index === parts.length - 1
      currentPath = `${currentPath}/${part}`

      const existing = currentMap.get(part)
      if (!existing) {
        const node: TodoNode = {
          name: part,
          path: currentPath,
          isDirectory: !isLast,
          children: !isLast ? [] : undefined
        }
        if (isLast) {
          node.status = item.status
        }
        currentMap.set(part, node)
        if (!isLast) {
          currentMap = new Map()
          node.children = []
        }
      } else {
        if (isLast) {
          existing.isDirectory = false
          existing.status = item.status
        }
        if (existing.children && !isLast) {
          currentMap = new Map()
        }
      }
    })
  })

  const toArray = (map: Map<string, TodoNode>): TodoNode[] => {
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
  }

  return toArray(rootMap)
}

const TodoPanel: React.FC = () => {
  const { fileStatuses } = useFTPStore()
  const { openFiles, setActiveFile, openFile } = useEditorStore()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('flat')
  const [error, setError] = useState<string | null>(null)

  const items: TodoItem[] = useMemo(() => {
    return Object.entries(fileStatuses || {})
      .filter(([_, status]): status is FileStatus => !!status)
      .map(([path, status]) => {
        const normalized = String(path || '').replace(/\\/g, '/')
        const parts = normalized.split('/').filter(Boolean)
        const name = parts[parts.length - 1] || normalized || path
        return { path, name, status }
      })
  }, [fileStatuses])

  const filteredItems = useMemo(() => {
    if (statusFilter === 'all') return items
    return items.filter((item) => item.status === statusFilter)
  }, [items, statusFilter])

  const nestedTree = useMemo(() => {
    if (viewMode !== 'nested') return []
    return buildNestedTree(filteredItems)
  }, [filteredItems, viewMode])

  const handleOpenFile = useCallback(
    async (item: { path: string; name: string }) => {
      setError(null)
      const existing = openFiles.find((f) => f.id === item.path)
      if (existing) {
        setActiveFile(existing.id)
        return
      }

      try {
        const dl = await electronAPI.ftpDownloadFile(item.path, undefined as any)
        if (!dl.success || typeof dl.content !== 'string') {
          setError(dl.error || 'Failed to open file from FTP')
          return
        }
        const content = dl.content
        const editorFile = {
          id: item.path,
          path: item.path,
          name: item.name,
          content,
          language: getLanguageFromExtension(item.name),
          isDirty: false,
          lastModified: new Date()
        }
        openFile(editorFile)
        setActiveFile(editorFile.id)
      } catch {
        setError('Failed to open file from FTP')
      }
    },
    [openFiles, openFile, setActiveFile]
  )

  const renderFlat = () => {
    if (!filteredItems.length) {
      return (
        <div className="p-3 text-xs text-vscode-text-muted">
          No files have a To Do status yet. Right-click files in the FTP Explorer to mark them.
        </div>
      )
    }

    const sorted = [...filteredItems].sort((a, b) => a.path.localeCompare(b.path))

    return (
      <div className="divide-y divide-vscode-border/60">
        {sorted.map((item) => (
          <button
            key={item.path}
            type="button"
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-vscode-hover text-left"
            onClick={() => handleOpenFile(item)}
          >
            <span className={`w-2 h-2 rounded-full ${getStatusDotClass(item.status)}`} />
            {getFileIcon(item.name)}
            <span className={`flex-1 truncate ${getStatusTextClass(item.status)}`}>{item.name}</span>
            <span className="text-[11px] text-vscode-text-muted truncate max-w-xs">
              {String(item.path || '').replace(/\\/g, '/')}
            </span>
          </button>
        ))}
      </div>
    )
  }

  const renderNestedNodes = (nodes: TodoNode[], depth = 0): JSX.Element[] => {
    const elements: JSX.Element[] = []

    nodes.forEach((node) => {
      const indentStyle = { paddingLeft: `${12 + depth * 12}px` }
      if (node.isDirectory) {
        elements.push(
          <div
            key={`dir-${node.path}`}
            className="flex items-center gap-2 px-3 py-1 text-xs text-vscode-text-muted"
            style={indentStyle}
          >
            <Folder size={13} className="text-blue-400" />
            <span className="truncate">{node.name}</span>
          </div>
        )
        if (node.children && node.children.length > 0) {
          elements.push(...renderNestedNodes(node.children, depth + 1))
        }
      } else {
        const status = node.status as FileStatus | undefined
        if (!status) return
        const name = node.name
        elements.push(
          <button
            key={`file-${node.path}`}
            type="button"
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-vscode-hover text-left"
            style={indentStyle}
            onClick={() => handleOpenFile({ path: node.path, name })}
          >
            <span className={`w-2 h-2 rounded-full ${getStatusDotClass(status)}`} />
            {getFileIcon(name)}
            <span className={`flex-1 truncate ${getStatusTextClass(status)}`}>{name}</span>
          </button>
        )
      }
    })

    return elements
  }

  const renderNested = () => {
    if (!filteredItems.length) {
      return (
        <div className="p-3 text-xs text-vscode-text-muted">
          No files have a To Do status yet. Right-click files in the FTP Explorer to mark them.
        </div>
      )
    }

    return <div className="space-y-0.5">{renderNestedNodes(nestedTree)}</div>
  }

  return (
    <div className="flex-1 flex flex-col text-sm text-vscode-text vscode-scrollbar overflow-y-auto">
      <div className="p-3 border-b border-vscode-border flex items-center gap-3">
        <div className="flex items-center gap-1">
          <Filter size={14} className="text-vscode-text-muted" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="bg-vscode-bg border border-vscode-border text-xs px-2 py-1 rounded focus:outline-none focus:border-vscode-accent"
          >
            <option value="all">All statuses</option>
            <option value="finished">Finished (green)</option>
            <option value="needs_work">Needs work (yellow)</option>
            <option value="not_finished">Not finished (red)</option>
          </select>
        </div>
        <div className="ml-auto flex items-center gap-1 text-[11px]">
          <button
            type="button"
            className={`px-2 py-0.5 rounded-l border ${
              viewMode === 'flat'
                ? 'bg-vscode-selection text-white border-vscode-selection'
                : 'bg-vscode-bg text-vscode-text-muted border-vscode-border hover:bg-vscode-hover'
            }`}
            onClick={() => setViewMode('flat')}
            title="Flat list"
          >
            <List size={12} />
          </button>
          <button
            type="button"
            className={`px-2 py-0.5 rounded-r border ${
              viewMode === 'nested'
                ? 'bg-vscode-selection text-white border-vscode-selection'
                : 'bg-vscode-bg text-vscode-text-muted border-vscode-border hover:bg-vscode-hover'
            }`}
            onClick={() => setViewMode('nested')}
            title="Nested by folders"
          >
            <ListTree size={12} />
          </button>
        </div>
      </div>

      {error && (
        <div className="px-3 py-1.5 text-xs text-red-400 border-b border-vscode-border">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto vscode-scrollbar">
        {viewMode === 'flat' ? renderFlat() : renderNested()}
      </div>
    </div>
  )
}

export default TodoPanel


