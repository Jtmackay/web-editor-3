import React, { useState, useEffect, useRef } from 'react'
import {
  ChevronRight,
  ChevronDown,
  File,
  FileCode,
  FileJson,
  FileText,
  Folder,
  RefreshCw,
  Plus,
  Server,
  Download,
  Image as ImageIcon,
  Archive as ArchiveIcon
} from 'lucide-react'
import { useFTPStore, FTPFile, FileStatus } from '../stores/ftpStore'
import { useEditorStore } from '../stores/editorStore'
import { electronAPI } from '../utils/electronAPI'

const DIRECTORY_TOKENS = new Set(['directory', 'dir', 'folder', 'd'])
const FILE_TOKENS = new Set(['file', 'f'])

const normalizeFileType = (rawType: unknown, fallback: 'file' | 'directory' = 'file'): 'file' | 'directory' => {
  if (typeof rawType === 'string') {
    const token = rawType.trim().toLowerCase()
    if (DIRECTORY_TOKENS.has(token)) return 'directory'
    if (FILE_TOKENS.has(token)) return 'file'
  } else if (typeof rawType === 'number') {
    // basic-ftp FileType enum -> 2 === Directory, 1 === File
    if (rawType === 2) return 'directory'
    if (rawType === 1) return 'file'
  } else if (typeof rawType === 'boolean') {
    return rawType ? 'directory' : 'file'
  }
  return fallback
}

const isDirectoryEntry = (type: unknown): boolean => normalizeFileType(type, 'file') === 'directory'

const FTPExplorer: React.FC = () => {
  const { files, isConnected, currentPath, setFiles, setLoading, setError, error, fileStatuses, setFileStatus } =
    useFTPStore()
  const { openFile: openEditorFile } = useEditorStore()
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [folderChildren, setFolderChildren] = useState<Record<string, FTPFile[]>>({})
  const [loadingChildren, setLoadingChildren] = useState<Record<string, boolean>>({})
  const [showConnectionDialog, setShowConnectionDialog] = useState(false)
  const [savedConnections, setSavedConnections] = useState<any[]>([])
  const inFlightRef = useRef<Set<string>>(new Set())
  const queueRef = useRef<Promise<void>>(Promise.resolve())
  const blockedRef = useRef<Set<string>>(new Set())
  const [syncing, setSyncing] = useState(false)
  const [syncCount, setSyncCount] = useState<number | null>(null)
  const [syncIgnorePatterns, setSyncIgnorePatterns] = useState<string[]>([])
  const [hideIgnoredInExplorer, setHideIgnoredInExplorer] = useState(false)
  const [hiddenIgnorePatterns, setHiddenIgnorePatterns] = useState<string[]>([])
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: FTPFile } | null>(null)

  const getStatusForPath = (path: string): FileStatus | undefined => {
    return fileStatuses[path]
  }

  const getStatusTextClass = (status: FileStatus | undefined): string => {
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

  const getFileIcon = (file: FTPFile) => {
    if (isDirectoryEntry(file.type)) {
      return <Folder size={14} className="text-blue-400" />
    }

    const ext = file.name.split('.').pop()?.toLowerCase()

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

  const buildPreviewUrl = async (file: FTPFile): Promise<string | null> => {
    const rawPath = String(file.path || '')
    const normalizedPath = rawPath.replace(/\\/g, '/')

    const [baseRes, startAfterRes] = await Promise.all([
      electronAPI.settingsGetPreviewBaseUrl(),
      electronAPI.settingsGetPreviewStartAfter()
    ])

    if (!baseRes.success) {
      setError(baseRes.error || 'Failed to load preview base URL from settings')
      return null
    }

    const baseRaw = (baseRes.baseUrl || '').trim()
    if (!baseRaw) {
      setError('Base URL is not configured. Set it in the Settings tab.')
      return null
    }

    const hasProtocol = /^https?:\/\//i.test(baseRaw)
    const base = (hasProtocol ? baseRaw : `https://${baseRaw}`).replace(/\/+$/, '')

    let urlPath = normalizedPath
    const startAfterRaw = (startAfterRes.success && startAfterRes.startAfter) ? startAfterRes.startAfter : ''
    const startAfter = startAfterRaw.replace(/\\/g, '/').replace(/^\/+/, '')

    if (startAfter) {
      const relative = normalizedPath.replace(/^\/+/, '')
      const lowerRelative = relative.toLowerCase()
      const lowerStart = startAfter.toLowerCase()
      if (lowerRelative.startsWith(lowerStart + '/') || lowerRelative === lowerStart) {
        let trimmed = relative.slice(startAfter.length)
        trimmed = trimmed.replace(/^\/+/, '')
        urlPath = '/' + trimmed
      } else {
        urlPath = normalizedPath.startsWith('/') ? normalizedPath : '/' + normalizedPath
      }
    } else {
      urlPath = normalizedPath.startsWith('/') ? normalizedPath : '/' + normalizedPath
    }

    const url = encodeURI(`${base}${urlPath}`)
    return url
  }

  const openPreviewInTab = async (file: FTPFile) => {
    try {
      const url = await buildPreviewUrl(file)
      if (!url) return

      const editor = useEditorStore.getState()
      const previewId = `preview:${url}`
      const existing = editor.openFiles.find((f) => f.id === previewId)
      const now = new Date()

      if (existing) {
        editor.setActiveFile(previewId)
        return
      }

      editor.openFile({
        id: previewId,
        path: String(file.path || ''),
        name: `${file.name} (Preview)`,
        content: '',
        language: 'plaintext',
        isDirty: false,
        lastModified: now,
        kind: 'preview',
        previewUrl: url
      })
      editor.setActiveFile(previewId)
    } catch (err) {
      console.error('Failed to open preview in tab', err)
      setError('Failed to open preview in tab')
    }
  }

  function runQueued<T>(fn: () => Promise<T>): Promise<T> {
    const next = queueRef.current.then(fn)
    queueRef.current = next.then(() => undefined).catch(() => undefined)
    return next
  }

  const preloadAll = async (rootPath: string) => {
    setError(null)
    try {
      const res = await runQueued(() => electronAPI.ftpListAll(rootPath))
      if (res.success && res.tree) {
        const toFile = (n: any): FTPFile => {
          const hasChildren = (Array.isArray(n.children) && n.children.length > 0) || (Array.isArray(n.items) && n.items.length > 0)
          return {
            name: n.name,
            path: n.path,
            type: normalizeFileType(n.type, hasChildren ? 'directory' : 'file'),
            size: Number(n.size ?? 0) || 0,
            modified: n.modified ? new Date(n.modified) : (n.modifiedAt ? new Date(n.modifiedAt) : new Date())
          }
        }
        const top = (res.tree as any[]).map(toFile)
        setFiles(top)
        const childrenMap: Record<string, FTPFile[]> = {}
        const walk = (nodes: any[]) => {
          nodes.forEach((n: any) => {
            const kids = n.children || n.items || []
            if (kids && kids.length) {
              childrenMap[n.path] = kids.map(toFile)
              walk(kids)
            }
          })
        }
        walk(res.tree as any[])
        setFolderChildren(childrenMap)
      } else {
        const rootRes = await runQueued(() => electronAPI.ftpListFiles(rootPath))
        if (!rootRes.success || !rootRes.files) {
          setError(res.error || 'Failed to load all files')
          return
        }
        const toFile = (item: any): FTPFile => {
          const fallbackType: 'file' | 'directory' = item && (item.isDirectory === true || (Array.isArray(item.children) && item.children.length > 0))
            ? 'directory'
            : 'file'
          return {
            name: item.name,
            path: item.path,
            type: normalizeFileType(item.type, fallbackType),
            size: Number(item.size ?? 0) || 0,
            modified: item.modified ? new Date(item.modified) : (item.modifiedAt ? new Date(item.modifiedAt) : new Date())
          }
        }
        const top = rootRes.files.map(toFile)
        setFiles(top)
        const childrenMap: Record<string, FTPFile[]> = {}
        const dirs: string[] = top.filter(f => isDirectoryEntry(f.type)).map(f => f.path)
        for (const d of dirs) {
          const subRes = await runQueued(() => electronAPI.ftpListFiles(d))
          if (subRes.success && subRes.files) {
            const kids = subRes.files.map(toFile)
            childrenMap[d] = kids
          }
        }
        setFolderChildren(childrenMap)
      }
    } catch (err) {
      setError('Failed to load all files')
    }
  }

  useEffect(() => {
    if (isConnected) {
      preloadAll(currentPath || '/')
    }
  }, [isConnected])

  

  useEffect(() => {
    const interval = setInterval(async () => {
      const active = await electronAPI.dbGetActiveFiles()
      if (active.success && active.files) {
        active.files.forEach((af: any) => {
          useFTPStore.getState().updateFileStatus(af.file_path, true, [af.username])
        })
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const off = electronAPI.onSyncProgress?.((_event, payload) => {
      if (payload && typeof payload.count === 'number') {
        setSyncCount(payload.count)
      }
    })
    return () => {
      if (off) off()
    }
  }, [])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const res = await electronAPI.settingsGetSyncIgnore()
        if (!mounted || !res.success) return
        if (Array.isArray(res.patterns)) {
          setSyncIgnorePatterns(res.patterns)
        }
        if (typeof res.hideInExplorer === 'boolean') {
          setHideIgnoredInExplorer(res.hideInExplorer)
        }
        if (Array.isArray(res.hiddenPaths)) {
          setHiddenIgnorePatterns(res.hiddenPaths)
        }
      } catch {
        // ignore
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!contextMenu) return
    const handleGlobalClick = () => setContextMenu(null)
    window.addEventListener('click', handleGlobalClick)
    return () => {
      window.removeEventListener('click', handleGlobalClick)
    }
  }, [contextMenu])

  const normalizeRemotePath = (p: string | undefined | null): string => {
    if (!p) return '/'
    let out = String(p).replace(/\\/g, '/')
    if (!out.startsWith('/')) out = '/' + out
    if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1)
    return out
  }

  const matchesIgnorePattern = (file: FTPFile): boolean => {
    const p = normalizeRemotePath(file.path)
    const name = file.name || ''

    return syncIgnorePatterns.some((patternRaw) => {
      if (!patternRaw) return false
      const pattern = String(patternRaw)
      if (pattern.includes('/') || pattern.startsWith('/')) {
        const normPattern = normalizeRemotePath(pattern)
        return p === normPattern || p.startsWith(normPattern + '/')
      }
      return name.startsWith(pattern) || name.endsWith(pattern)
    })
  }

  const isIgnoredForSync = (file: FTPFile) => matchesIgnorePattern(file)

  const isIgnoredByPathOnly = (file: FTPFile) => syncIgnorePatterns.includes(file.path)

  const matchesHiddenPattern = (file: FTPFile): boolean => {
    const p = normalizeRemotePath(file.path)
    const name = file.name || ''

    return hiddenIgnorePatterns.some((patternRaw) => {
      if (!patternRaw) return false
      const pattern = String(patternRaw)
      if (pattern.includes('/') || pattern.startsWith('/')) {
        const normPattern = normalizeRemotePath(pattern)
        return p === normPattern || p.startsWith(normPattern + '/')
      }
      return name.startsWith(pattern) || name.endsWith(pattern)
    })
  }

  const isHiddenInExplorer = (file: FTPFile) => matchesHiddenPattern(file)

  const handleSyncClick = async () => {
    if (!isConnected || syncing) return
    setError(null)
    setSyncCount(0)
    setSyncing(true)
    try {
      const folderRes = await electronAPI.settingsGetSyncFolder()
      if (!folderRes.success || !folderRes.path) {
        setError('No sync folder configured. Set it in the Settings tab.')
        setSyncing(false)
        return
      }
      const ignoreRes = await electronAPI.settingsGetSyncIgnore()
      const ignore = ignoreRes.success && ignoreRes.patterns ? ignoreRes.patterns : []
      // Use the FTP root as the sync source; the service will walk using the same
      // paths that power the explorer and the ignore list.
      const syncRes = await electronAPI.ftpSyncToLocal('/', folderRes.path, ignore)
      if (!syncRes.success) {
        setError(syncRes.error || 'Failed to sync files')
      }
    } catch (err) {
      console.error('FTPExplorer sync error', err)
      setError('Failed to sync files')
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showConnectionDialog) {
        setShowConnectionDialog(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showConnectionDialog])

  useEffect(() => {
    const loadConnections = async () => {
      const hasElectron = typeof (window as any).electronAPI !== 'undefined'
      if (hasElectron) {
        const res = await electronAPI.settingsGetFTPConnections()
        if (res.success && res.connections) {
          setSavedConnections(res.connections)
        }
      }
    }
    loadConnections()
  }, [showConnectionDialog])

  const openFile = async (file: FTPFile) => {
    console.log('FTPExplorer openFile click', { file })
    if (isDirectoryEntry(file.type)) {
      await toggleFolder(file)
      return
    }

    try {
      // Serialize downloads with other FTP operations to avoid basic-ftp
      // "User launched a task while another one is still running" errors.
      const dl = await runQueued(() => electronAPI.ftpDownloadFile(file.path, undefined as any))
      if (!dl.success) {
        console.error('FTPExplorer download failed', dl.error)
        setError(dl.error || 'Failed to download file')
        return
      }
      const content = dl.content || ''
      console.log('FTPExplorer download success', { bytes: content.length })
      
      const editorFile = {
        id: file.path,
        path: file.path,
        name: file.name,
        content,
        language: getLanguageFromExtension(file.name),
        isDirty: false,
        lastModified: file.modified
      }
      
      openEditorFile(editorFile)
      const uid = useEditorStore.getState().currentUserId
      if (uid) {
        await electronAPI.dbSetActiveFile(String(uid), file.path)
      }
    } catch (error) {
      console.error('FTPExplorer openFile error', error)
      setError('Failed to open file')
    }
  }

  const getLanguageFromExtension = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase()
    const languageMap: Record<string, string> = {
      'js': 'javascript',
      'ts': 'typescript',
      'jsx': 'javascript',
      'tsx': 'typescript',
      'py': 'python',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'htm': 'html',
      'html': 'html',
      'css': 'css',
      'json': 'json',
      'md': 'markdown',
      'xml': 'xml',
      'yml': 'yaml',
      'yaml': 'yaml'
    }
    return languageMap[ext || ''] || 'plaintext'
  }

  const toggleFolder = async (file: FTPFile) => {
    if (inFlightRef.current.has(file.path)) return
    const next = new Set(expandedFolders)
    if (next.has(file.path)) {
      next.delete(file.path)
      setExpandedFolders(next)
      console.log('FTPExplorer folder collapse', { path: file.path })
    } else {
      next.add(file.path)
      setExpandedFolders(next)
      console.log('FTPExplorer folder expand', { path: file.path })
      if (!folderChildren[file.path]) {
        if (loadingChildren[file.path]) return
        inFlightRef.current.add(file.path)
        setLoadingChildren((prev) => ({ ...prev, [file.path]: true }))
        try {
          console.log('FTPExplorer loadChildren start', { path: file.path })
          const res = await runQueued(() => electronAPI.ftpListFiles(file.path))
          if (res.success && res.files) {
            const mapped: FTPFile[] = res.files.map((item: any) => {
              const fallbackType: 'file' | 'directory' = item && item.isDirectory === true ? 'directory' : 'file'
              return {
                name: item.name,
                path: item.path,
                type: normalizeFileType(item.type, fallbackType),
                size: Number(item.size ?? 0) || 0,
                modified: item.modified ? new Date(item.modified) : (item.modifiedAt ? new Date(item.modifiedAt) : new Date())
              }
            })
            setFolderChildren((prev) => ({ ...prev, [file.path]: mapped }))
            console.log('FTPExplorer loadChildren success', { path: file.path, count: mapped.length })
          } else {
            console.error('FTPExplorer loadChildren failed', res.error)
            setError(res.error || 'Failed to load folder')
          }
        } catch (err) {
          console.error('FTPExplorer loadChildren error', err)
          setError('Failed to load folder')
        } finally {
          setLoadingChildren((prev) => ({ ...prev, [file.path]: false }))
          inFlightRef.current.delete(file.path)
        }
      }
    }
  }

  const renderFileTree = (files: FTPFile[]) => {
    const visible = files.filter((file) => {
      if (isHiddenInExplorer(file)) return false
      if (hideIgnoredInExplorer && isIgnoredForSync(file)) return false
      return true
    })
    const sorted = [...visible].sort((a, b) => {
      const aIsDir = isDirectoryEntry(a.type)
      const bIsDir = isDirectoryEntry(b.type)
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    })
    return sorted.map((file) => {
      const isDirectory = isDirectoryEntry(file.type)
      const status = getStatusForPath(file.path)
      const statusTextClass = getStatusTextClass(status)
      return (
        <div key={file.path} className="select-none">
          <div
            className={`flex items-center gap-2 px-3 py-1 hover:bg-vscode-hover cursor-pointer transition-colors ${
              isIgnoredForSync(file) ? 'opacity-60' : ''
            }`}
            onClick={async () => {
              // Simple, reliable behaviour:
              // - Single click on a folder toggles expand/collapse
              // - Single click on a file opens it
              if (isDirectory) {
                await toggleFolder(file)
              } else {
                await openFile(file)
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              setContextMenu({ x: e.clientX, y: e.clientY, file })
            }}
            onDoubleClick={(e) => {
              // Prevent double-click from firing any extra actions
              e.stopPropagation()
            }}
          >
            {isDirectory ? (
              <span
                onClick={async (e) => {
                  e.stopPropagation()
                  if (blockedRef.current.has(file.path)) return
                  blockedRef.current.add(file.path)
                  setTimeout(() => blockedRef.current.delete(file.path), 300)
                  const next = new Set(expandedFolders)
                  if (next.has(file.path)) {
                    next.delete(file.path)
                    setExpandedFolders(next)
                    console.log('FTPExplorer folder collapse (chevron)', { path: file.path })
                  } else {
                    next.add(file.path)
                    setExpandedFolders(next)
                    console.log('FTPExplorer folder expand (chevron)', { path: file.path })
                    if (!folderChildren[file.path]) {
                      if (loadingChildren[file.path]) return
                      if (inFlightRef.current.has(file.path)) return
                      inFlightRef.current.add(file.path)
                      setLoadingChildren((prev) => ({ ...prev, [file.path]: true }))
                      try {
                        console.log('FTPExplorer loadChildren start (chevron)', { path: file.path })
                        const res = await runQueued(() => electronAPI.ftpListFiles(file.path))
                        if (res.success && res.files) {
                          const mapped: FTPFile[] = res.files.map((item: any) => {
                            const fallbackType: 'file' | 'directory' = item && item.isDirectory === true ? 'directory' : 'file'
                            return {
                              name: item.name,
                              path: item.path,
                              type: normalizeFileType(item.type, fallbackType),
                              size: Number(item.size ?? 0) || 0,
                              modified: item.modified ? new Date(item.modified) : (item.modifiedAt ? new Date(item.modifiedAt) : new Date())
                            }
                          })
                          setFolderChildren((prev) => ({ ...prev, [file.path]: mapped }))
                          console.log('FTPExplorer loadChildren success (chevron)', { path: file.path, count: mapped.length })
                        } else {
                          console.error('FTPExplorer loadChildren failed (chevron)', res.error)
                          setError(res.error || 'Failed to load folder')
                        }
                      } catch (err) {
                        console.error('FTPExplorer loadChildren error (chevron)', err)
                        setError('Failed to load folder')
                      } finally {
                        setLoadingChildren((prev) => ({ ...prev, [file.path]: false }))
                        inFlightRef.current.delete(file.path)
                      }
                    }
                  }
                }}
                className="inline-flex"
              >
                {expandedFolders.has(file.path) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
            ) : (
              <div className="w-3" />
            )}
            
            {getFileIcon(file)}
            
            <span className={`text-sm flex-1 ${statusTextClass}`}>{file.name}</span>
            {isIgnoredForSync(file) && (
              <span className="ml-2 text-[10px] px-1 py-0.5 rounded bg-vscode-border text-vscode-text-muted">
                Ignored
              </span>
            )}
            
            {file.isEditing && (
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-orange-500 rounded-full" />
                <span className="text-xs text-orange-400">{file.editingUsers?.[0]}</span>
              </div>
            )}
          </div>
          {isDirectory && expandedFolders.has(file.path) && folderChildren[file.path] && folderChildren[file.path].length > 0 && (
            <div className="ml-4">
              {renderFileTree(folderChildren[file.path])}
            </div>
          )}
        </div>
      )
    })
  }

  return (
    <div className="flex flex-col h-full vscode-scrollbar overflow-y-auto">
      {!isConnected ? (
        <div className="flex flex-col items-center justify-center h-full p-4 text-center">
          <Server size={48} className="text-vscode-text-muted mb-4" />
          <h3 className="text-lg font-semibold mb-2">No FTP Connection</h3>
          <p className="text-vscode-text-muted mb-4">
            Connect to an FTP server to browse and edit files
          </p>
          <button
            onClick={() => setShowConnectionDialog(true)}
            className="px-4 py-2 bg-vscode-accent text-white rounded hover:bg-blue-600 transition-colors flex items-center gap-2"
          >
            <Plus size={16} />
            Connect to FTP
          </button>
          {savedConnections.length > 0 && (
            <div className="mt-4 w-full max-w-sm text-left">
              <div className="text-sm mb-2">Saved Connections</div>
              <div className="space-y-2">
                {savedConnections.map((c) => (
                  <button key={c.id} onClick={async () => {
                    const p = await electronAPI.settingsGetFTPPassword(c.id)
                    if (p.success && p.password) {
                      setLoading(true)
                      const res = await electronAPI.ftpConnect({ host: c.host, port: c.port, username: c.username, password: p.password, defaultPath: c.default_path || c.defaultPath || '/' })
                      if (res.success) {
                        const { setConnectionStatus, setActiveConnection, addConnection, setCurrentPath } = useFTPStore.getState()
                        addConnection({ id: String(c.id), name: c.name, host: c.host, port: c.port, username: c.username, password: '', defaultPath: c.default_path || c.defaultPath || '/', appendedUrl: c.appendedUrl || '', isConnected: true })
                        setActiveConnection(String(c.id))
                        setConnectionStatus(true)
                        setCurrentPath(c.default_path || c.defaultPath || '/')
                        await preloadAll(c.default_path || c.defaultPath || '/')
                        setLoading(false)
                        setError(null)
                      } else {
                        setLoading(false)
                        setError(res.error || 'Failed to connect')
                      }
                    }
                  }} className="w-full px-3 py-2 bg-vscode-hover rounded border border-vscode-border text-sm text-left hover:bg-vscode-border transition-colors">{c.name} ({c.host})</button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="p-2 border-b border-vscode-border flex items-center gap-2">
            <button
              onClick={() => preloadAll(currentPath || '/')}
              className="p-2 hover:bg-vscode-hover rounded transition-colors"
              title="Refresh"
            >
              <RefreshCw size={14} />
            </button>
            <button
              onClick={handleSyncClick}
              className={`p-2 hover:bg-vscode-hover rounded transition-colors ${syncing ? 'opacity-50 cursor-default' : ''}`}
              title="Sync from FTP to local folder"
              disabled={syncing}
            >
              <Download size={14} />
            </button>
            {syncing && (
              <span className="text-xs text-vscode-text-muted ml-1">
                Syncing… {typeof syncCount === 'number' ? `${syncCount} files` : ''}
              </span>
            )}
            {error && (
              <div className="ml-auto flex-1 text-xs text-red-400 truncate" title={error}>
                {error}
              </div>
            )}
          </div>
          <div className="flex-1">
            {renderFileTree(files)}
          </div>
        </>
      )}

      {showConnectionDialog && (
        <FTPConnectionDialog onClose={() => setShowConnectionDialog(false)} />
      )}
      {contextMenu && (
        <div
          className="fixed z-50 bg-vscode-sidebar border border-vscode-border rounded shadow-lg text-sm"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => {
            e.stopPropagation()
          }}
        >
          {!isDirectoryEntry(contextMenu.file.type) && (
            <>
              <button
                className="block w-full text-left px-3 py-1 hover:bg-vscode-hover"
                onClick={async (e) => {
                  e.stopPropagation()
                  try {
                    const url = await buildPreviewUrl(contextMenu.file)
                    if (url) {
                      await electronAPI.openExternalUrl(url)
                    }
                  } catch (err) {
                    console.error('Failed to open preview in browser', err)
                    setError('Failed to open preview in browser')
                  } finally {
                    setContextMenu(null)
                  }
                }}
              >
                View in browser
              </button>
              <button
                className="block w-full text-left px-3 py-1 hover:bg-vscode-hover"
                onClick={async (e) => {
                  e.stopPropagation()
                  await openPreviewInTab(contextMenu.file)
                  setContextMenu(null)
                }}
              >
                View in tab
              </button>
            </>
          )}
          <div className="border-t border-vscode-border/60 my-1" />
          <button
            className="block w-full text-left px-3 py-1 hover:bg-vscode-hover"
            onClick={(e) => {
              e.stopPropagation()
              setFileStatus(contextMenu.file.path, 'finished')
              setContextMenu(null)
            }}
          >
            <span className="inline-flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              <span>Mark as Finished</span>
            </span>
          </button>
          <button
            className="block w-full text-left px-3 py-1 hover:bg-vscode-hover"
            onClick={(e) => {
              e.stopPropagation()
              setFileStatus(contextMenu.file.path, 'needs_work')
              setContextMenu(null)
            }}
          >
            <span className="inline-flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-yellow-300" />
              <span>Mark as Needs work</span>
            </span>
          </button>
          <button
            className="block w-full text-left px-3 py-1 hover:bg-vscode-hover"
            onClick={(e) => {
              e.stopPropagation()
              setFileStatus(contextMenu.file.path, 'not_finished')
              setContextMenu(null)
            }}
          >
            <span className="inline-flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-400" />
              <span>Mark as Not finished</span>
            </span>
          </button>
          <button
            className="block w-full text-left px-3 py-1 hover:bg-vscode-hover"
            onClick={(e) => {
              e.stopPropagation()
              setFileStatus(contextMenu.file.path, undefined)
              setContextMenu(null)
            }}
          >
            Clear status
          </button>
          <button
            className="block w-full text-left px-3 py-1 hover:bg-vscode-hover"
            onClick={async (e) => {
              e.stopPropagation()
              const file = contextMenu.file
              const currentlyIgnored = isIgnoredByPathOnly(file)
              try {
                const next = currentlyIgnored
                  ? syncIgnorePatterns.filter((p) => p !== file.path)
                  : [...syncIgnorePatterns, file.path]
                setSyncIgnorePatterns(next)
                await electronAPI.settingsSetSyncIgnore(next, hideIgnoredInExplorer, hiddenIgnorePatterns)
              } catch (err) {
                console.error('Failed to update sync ignore list', err)
                setError('Failed to update sync ignore list')
              } finally {
                setContextMenu(null)
              }
            }}
          >
            {isIgnoredByPathOnly(contextMenu.file) ? 'Remove from sync ignore' : 'Ignore in sync'}
          </button>
          {isIgnoredForSync(contextMenu.file) && (
            <button
              className="block w-full text-left px-3 py-1 hover:bg-vscode-hover"
              onClick={async (e) => {
                e.stopPropagation()
                const file = contextMenu.file
                const isHidden = isHiddenInExplorer(file)
                try {
                  const token = file.path
                  const nextHidden = isHidden
                    ? hiddenIgnorePatterns.filter((p) => p !== token)
                    : [...hiddenIgnorePatterns, token]
                  setHiddenIgnorePatterns(nextHidden)
                  await electronAPI.settingsSetSyncIgnore(syncIgnorePatterns, hideIgnoredInExplorer, nextHidden)
                } catch (err) {
                  console.error('Failed to update hidden ignore paths', err)
                  setError('Failed to update hidden ignore paths')
                } finally {
                  setContextMenu(null)
                }
              }}
            >
              {isHiddenInExplorer(contextMenu.file) ? 'Show ignored file in explorer' : 'Hide this ignored file in explorer'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

interface FTPConnectionDialogProps {
  onClose: () => void
}

const FTPConnectionDialog: React.FC<FTPConnectionDialogProps> = ({ onClose }) => {
  const [formData, setFormData] = useState({
    name: '',
    host: '',
    port: 21,
    username: '',
    password: '',
    defaultPath: '/',
    appendedUrl: '',
    saveToDB: true
  })
  const [connectError, setConnectError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const hasElectron = typeof (window as any).electronAPI !== 'undefined'
  const [, setLoadingSaved] = useState(false)
  const [saved, setSaved] = useState<any[]>([])

  useEffect(() => {
    const loadSaved = async () => {
      setLoadingSaved(true)
      const uid = useEditorStore.getState().currentUserId
      if (uid && hasElectron) {
        const res = await electronAPI.dbGetFTPConnections(uid)
        if (res.success && res.connections) {
          setSaved(res.connections)
          if (res.connections.length > 0) {
            const c = res.connections[0]
            setFormData({
              name: c.name || '',
              host: c.host || '',
              port: c.port || 21,
              username: c.username || '',
              password: '',
              defaultPath: c.default_path || '/',
              appendedUrl: c.appended_url || c.appendedUrl || '',
              saveToDB: true
            })
          }
        }
      }
      setLoadingSaved(false)
    }
    loadSaved()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setConnectError(null)
    setConnecting(true)
    if (!hasElectron) {
      setConnecting(false)
      setConnectError('Electron API not available. Start the Electron app to connect.')
      return
    }
      const res = await electronAPI.ftpConnect({
        host: formData.host,
        port: formData.port,
        username: formData.username,
        password: formData.password,
        defaultPath: formData.defaultPath
      })
    if (res.success) {
      const { setConnectionStatus, setActiveConnection, addConnection, setCurrentPath } = useFTPStore.getState()
      const connection = {
        id: Date.now().toString(),
        ...formData,
        isConnected: true
      }
      addConnection(connection)
      setActiveConnection(connection.id)
      setConnectionStatus(true)
      setCurrentPath(formData.defaultPath)
      if (formData.saveToDB) {
        await electronAPI.settingsAddFTPConnection({ name: formData.name, host: formData.host, port: formData.port, username: formData.username, password: formData.password, defaultPath: formData.defaultPath, appendedUrl: formData.appendedUrl })
      }
      setConnecting(false)
      onClose()
    } else {
      setConnecting(false)
      setConnectError(res.error || 'Unable to connect. Please check settings and try again.')
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-vscode-sidebar p-6 rounded-lg w-96 border border-vscode-border" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4">Connect to FTP Server</h2>
        {!hasElectron && (
          <div className="text-sm text-yellow-300 border border-yellow-700 bg-yellow-900 bg-opacity-20 rounded p-2 mb-3">
            Electron API not available. In development, run <code>NODE_ENV=development npm run electron</code> in another terminal.
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          {saved.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-1">Use Saved</label>
              <select
                value={formData.name}
                onChange={(e) => {
                  const c = saved.find((x) => x.name === e.target.value)
                  if (c) {
                    setFormData({
                      name: c.name || '',
                      host: c.host || '',
                      port: c.port || 21,
                      username: c.username || '',
                      password: '',
                      defaultPath: c.default_path || '/',
                      appendedUrl: c.appended_url || c.appendedUrl || '',
                      saveToDB: true
                    })
                    ;(async () => {
                      const p = await electronAPI.dbGetFTPPassword(c.id)
                      if (p.success && p.password) {
                        setFormData((prev) => ({ ...prev, password: p.password || '' }))
                      }
                    })()
                  }
                }}
                className="w-full px-3 py-2 bg-vscode-bg border border-vscode-border rounded text-sm focus:outline-none focus:border-vscode-accent"
              >
                <option value="">Select saved connection</option>
                {saved.map((c) => (
                  <option key={c.id} value={c.name}>{c.name} ({c.host})</option>
                ))}
              </select>
            </div>
          )}
          {connectError && (
            <div className="text-sm text-red-400 border border-red-700 bg-red-900 bg-opacity-20 rounded p-2">
              {connectError}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Connection Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 bg-vscode-bg border border-vscode-border rounded text-sm focus:outline-none focus:border-vscode-accent"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Host</label>
            <input
              type="text"
              value={formData.host}
              onChange={(e) => setFormData({ ...formData, host: e.target.value })}
              className="w-full px-3 py-2 bg-vscode-bg border border-vscode-border rounded text-sm focus:outline-none focus:border-vscode-accent"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Port</label>
              <input
                type="number"
                value={formData.port}
                onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) })}
                className="w-full px-3 py-2 bg-vscode-bg border border-vscode-border rounded text-sm focus:outline-none focus:border-vscode-accent"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Default Path</label>
              <input
                type="text"
                value={formData.defaultPath}
                onChange={(e) => setFormData({ ...formData, defaultPath: e.target.value })}
                className="w-full px-3 py-2 bg-vscode-bg border border-vscode-border rounded text-sm focus:outline-none focus:border-vscode-accent"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Appended URL</label>
            <input
              type="text"
              placeholder="example.com"
              value={formData.appendedUrl}
              onChange={(e) => setFormData({ ...formData, appendedUrl: e.target.value })}
              className="w-full px-3 py-2 bg-vscode-bg border border-vscode-border rounded text-sm focus:outline-none focus:border-vscode-accent"
            />
            <div className="text-xs text-vscode-text-muted mt-1">Used by Go To Page to build the website URL</div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Username</label>
            <input
              type="text"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              className="w-full px-3 py-2 bg-vscode-bg border border-vscode-border rounded text-sm focus:outline-none focus:border-vscode-accent"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="w-full px-3 py-2 bg-vscode-bg border border-vscode-border rounded text-sm focus:outline-none focus:border-vscode-accent"
              required
            />
          </div>
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-vscode-hover text-vscode-text rounded hover:bg-vscode-border transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={connecting || !hasElectron}
              className={`flex-1 px-4 py-2 ${connecting ? 'bg-vscode-border text-vscode-text-muted' : 'bg-vscode-accent text-white hover:bg-blue-600'} rounded transition-colors`}
            >
              {connecting ? 'Connecting…' : 'Connect'}
            </button>
          </div>
          <div className="pt-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={formData.saveToDB} onChange={(e) => setFormData({ ...formData, saveToDB: e.target.checked })} />
              Save connection and password
            </label>
          </div>
        </form>
      </div>
    </div>
  )
}

export default FTPExplorer
  
