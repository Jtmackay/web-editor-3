import React, { useCallback, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useEditorStore } from '../stores/editorStore'
import { electronAPI } from '../utils/electronAPI'

interface SearchMatch {
  fileId: string
  filePath: string
  fileName: string
  line: number
  column: number
  matchText: string
  lineText: string
}

interface FileSearchResult {
  fileId: string
  filePath: string
  fileName: string
  matches: SearchMatch[]
}

type SearchScope = 'open' | 'project'

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const SearchPanel: React.FC = () => {
  const { openFiles, setActiveFile, updateFileContent, openFile } = useEditorStore()

  const [query, setQuery] = useState('')
  const [replace, setReplace] = useState('')
  const [useRegex, setUseRegex] = useState(true)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [results, setResults] = useState<FileSearchResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<SearchScope>('open')
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())

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

  const openResultFile = useCallback(
    async (file: { fileId: string; filePath: string; fileName: string }) => {
      const existing = openFiles.find((f) => f.id === file.fileId)
      if (existing) {
        setActiveFile(existing.id)
        return
      }

      const remotePath = file.filePath
      if (!remotePath) {
        setError('Cannot open file (missing path)')
        return
      }

      try {
        const dl = await electronAPI.ftpDownloadFile(remotePath, undefined as any)
        if (!dl.success || typeof (dl as any).content !== 'string') {
          setError((dl as any).error || 'Failed to open file from FTP')
          return
        }
        const content = (dl as any).content as string
        const editorFile = {
          id: remotePath,
          path: remotePath,
          name: file.fileName,
          content,
          language: getLanguageFromExtension(file.fileName),
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

  const buildPattern = useCallback(() => {
    if (!query) return null
    const source = useRegex ? query : escapeRegExp(query)
    const flags = caseSensitive ? 'g' : 'gi'
    try {
      return new RegExp(source, flags)
    } catch (e) {
      setError('Invalid regular expression')
      return null
    }
  }, [caseSensitive, query, useRegex])

  const runSearch = useCallback(async () => {
    if (!query.trim()) {
      setResults([])
      setError(null)
      return
    }

    setError(null)
    const pattern = buildPattern()
    if (!pattern) {
      if (useRegex) {
        return
      }
      // For plain text mode, buildPattern should never fail
    }

    const fileResults: FileSearchResult[] = []

    if (scope === 'open') {
      openFiles.forEach(file => {
        const content = file.content || ''
        if (!content) return

        const matches: SearchMatch[] = []
        const regex = pattern ? new RegExp(pattern.source, pattern.flags) : null

        if (!regex) return

        let match: RegExpExecArray | null
        while ((match = regex.exec(content)) !== null) {
          const index = match.index
          const before = content.slice(0, index)
          const lineNumber = before.split('\n').length
          const lineStart = before.lastIndexOf('\n') + 1
          const lineEndIndex = content.indexOf('\n', index)
          const lineEnd = lineEndIndex === -1 ? content.length : lineEndIndex
          const lineText = content.slice(lineStart, lineEnd)
          const column = index - lineStart + 1

          matches.push({
            fileId: file.id,
            filePath: file.path,
            fileName: file.name,
            line: lineNumber,
            column,
            matchText: match[0],
            lineText
          })

          if (match[0].length === 0) {
            regex.lastIndex += 1
          }
        }

        if (matches.length > 0) {
          fileResults.push({
            fileId: file.id,
            filePath: file.path,
            fileName: file.name,
            matches
          })
        }
      })
    } else {
      try {
        const res = await electronAPI.projectSearch({
          query,
          useRegex,
          caseSensitive
        })

        if (!res.success) {
          setError(res.error || 'Project search failed')
          setResults([])
          return
        }

        const files = res.files || []
        files.forEach((f) => {
          const rel = f.relativePath || f.path
          if (!rel) return
          const remotePath = '/' + String(rel).replace(/\\/g, '/')
          const fileId = remotePath
          const fileName = f.name || rel
          const filePath = remotePath

          const matches: SearchMatch[] = (f.matches || []).map((m) => ({
            fileId,
            filePath,
            fileName,
            line: m.line,
            column: m.column,
            matchText: m.matchText,
            lineText: m.lineText
          }))

          if (matches.length > 0) {
            fileResults.push({
              fileId,
              filePath,
              fileName,
              matches
            })
          }
        })
      } catch (err) {
        setError('Project search failed')
        setResults([])
        return
      }
    }

    setResults(fileResults)
    setExpandedFiles(new Set())
  }, [buildPattern, caseSensitive, openFiles, query, scope, useRegex])

  const handleReplaceAll = () => {
    if (!query.trim()) return

    const pattern = buildPattern()
    if (!pattern) {
      if (useRegex) return
    }
    const regex = pattern ? new RegExp(pattern.source, pattern.flags) : null
    if (!regex) return

    openFiles.forEach(file => {
      const content = file.content || ''
      if (!content) return

      const updated = content.replace(regex, replace)
      if (updated !== content) {
        updateFileContent(file.id, updated)
      }
    })

    runSearch()
  }

  const totalMatches = results.reduce((sum, file) => sum + file.matches.length, 0)

  return (
    <div className="flex-1 flex flex-col text-sm text-vscode-text vscode-scrollbar overflow-y-auto">
      <div className="p-3 space-y-2 border-b border-vscode-border">
        <div className="flex items-center gap-1 text-[11px]">
          <button
            type="button"
            className={`px-2 py-0.5 rounded-l border ${
              scope === 'open'
                ? 'bg-vscode-selection text-white border-vscode-selection'
                : 'bg-vscode-bg text-vscode-text-muted border-vscode-border hover:bg-vscode-hover'
            }`}
            onClick={() => setScope('open')}
          >
            Open Files
          </button>
          <button
            type="button"
            className={`px-2 py-0.5 rounded-r border ${
              scope === 'project'
                ? 'bg-vscode-selection text-white border-vscode-selection'
                : 'bg-vscode-bg text-vscode-text-muted border-vscode-border hover:bg-vscode-hover'
            }`}
            onClick={() => setScope('project')}
          >
            Project
          </button>
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              runSearch()
            }
          }}
          placeholder="Search (supports regex)"
          className="w-full px-2 py-1 bg-vscode-bg border border-vscode-border rounded text-xs focus:outline-none focus:border-vscode-accent"
        />
        <input
          type="text"
          value={replace}
          onChange={(e) => setReplace(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleReplaceAll()
            }
          }}
          placeholder="Replace"
          className="w-full px-2 py-1 bg-vscode-bg border border-vscode-border rounded text-xs focus:outline-none focus:border-vscode-accent"
        />
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={`px-2 py-0.5 rounded text-[11px] border ${
                caseSensitive
                  ? 'bg-vscode-selection text-white border-vscode-selection'
                  : 'bg-vscode-bg text-vscode-text-muted border-vscode-border hover:bg-vscode-hover'
              }`}
              onClick={() => setCaseSensitive(!caseSensitive)}
              title="Match Case"
            >
              Aa
            </button>
            <button
              type="button"
              className={`px-2 py-0.5 rounded text-[11px] border ${
                useRegex
                  ? 'bg-vscode-selection text-white border-vscode-selection'
                  : 'bg-vscode-bg text-vscode-text-muted border-vscode-border hover:bg-vscode-hover'
              }`}
              onClick={() => setUseRegex(!useRegex)}
              title="Use Regular Expression"
            >
              .*
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={runSearch}
              className="px-2 py-0.5 rounded text-[11px] bg-vscode-hover border border-vscode-border hover:bg-vscode-border"
            >
              Search
            </button>
            <button
              type="button"
              onClick={handleReplaceAll}
              className="px-2 py-0.5 rounded text-[11px] bg-vscode-accent text-white border border-vscode-border hover:bg-blue-600"
            >
              Replace All
            </button>
          </div>
        </div>
        {error && (
          <div className="text-xs text-red-400 pt-1">
            {error}
          </div>
        )}
        {!error && query.trim() && (
          <div className="text-xs text-vscode-text-muted pt-1">
            {totalMatches} {totalMatches === 1 ? 'result' : 'results'} in {results.length}{' '}
            {results.length === 1 ? 'file' : 'files'}
          </div>
        )}
        {!query.trim() && (
          <div className="text-xs text-vscode-text-muted pt-1">
            {scope === 'open'
              ? 'Search across all open files. Use regex for advanced patterns.'
              : 'Search across the latest synced project snapshot. Sync before searching.'}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto vscode-scrollbar">
        {results.map((file) => {
          const isExpanded = expandedFiles.has(file.fileId)
          return (
            <div key={file.fileId} className="border-b border-vscode-border/60">
              <div className="flex items-center px-1 py-1.5 hover:bg-vscode-hover/60 text-xs">
                <button
                  type="button"
                  className="p-1 rounded hover:bg-vscode-hover mr-1"
                  onClick={(e) => {
                    e.stopPropagation()
                    setExpandedFiles((prev) => {
                      const next = new Set(prev)
                      if (next.has(file.fileId)) {
                        next.delete(file.fileId)
                      } else {
                        next.add(file.fileId)
                      }
                      return next
                    })
                  }}
                >
                  {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
                <button
                  type="button"
                  className="flex-1 flex items-center gap-2 text-left"
                  onClick={() => openResultFile(file)}
                >
                  <span className="truncate">{file.fileName}</span>
                  <span className="truncate text-[10px] text-vscode-text-muted">
                    {file.filePath}
                  </span>
                  <span className="ml-auto text-[10px] text-vscode-text-muted">
                    {file.matches.length} {file.matches.length === 1 ? 'match' : 'matches'}
                  </span>
                </button>
              </div>
              {isExpanded && (
                <div className="pl-6 pr-2 pb-1 space-y-0.5">
                  {file.matches.map((m, idx) => {
                    const before = m.lineText.slice(0, m.column - 1)
                    const highlight = m.lineText.slice(m.column - 1, m.column - 1 + m.matchText.length)
                    const after = m.lineText.slice(m.column - 1 + m.matchText.length)

                    return (
                      <button
                        key={`${m.fileId}-${m.line}-${m.column}-${idx}`}
                        type="button"
                        className="w-full text-left px-2 py-0.5 rounded hover:bg-vscode-hover text-xs"
                        onClick={() => openResultFile(m)}
                      >
                        <span className="truncate">
                          <span className="text-vscode-text-muted">{before}</span>
                          <span className="bg-vscode-selection text-white px-0.5 rounded">
                            {highlight}
                          </span>
                          <span className="text-vscode-text-muted">{after}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {!results.length && query.trim() && !error && (
          <div className="p-3 text-xs text-vscode-text-muted">
            {scope === 'open' ? 'No results found in open files.' : 'No results found in project files.'}
          </div>
        )}
      </div>
    </div>
  )
}

export default SearchPanel


