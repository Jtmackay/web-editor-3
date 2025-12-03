import { create } from 'zustand'

export interface FTPConnection {
  id: string
  name: string
  host: string
  port: number
  username: string
  password: string
  defaultPath: string
  appendedUrl?: string
  isConnected: boolean
}

export interface FTPFile {
  name: string
  path: string
  type: 'file' | 'directory'
  size: number
  modified: Date
  isEditing?: boolean
  editingUsers?: string[]
}

export type FileStatus = 'finished' | 'not_finished' | 'needs_work'

interface FTPState {
  connections: FTPConnection[]
  activeConnection: string | null
  isConnected: boolean
  currentPath: string
  files: FTPFile[]
  /**
   * Per-file status flags keyed by full FTP path.
   * Used for visual cues like "Finished", "Not finished", "Needs work".
   */
  fileStatuses: Record<string, FileStatus | undefined>
  isLoading: boolean
  error: string | null
}

interface FTPActions {
  setConnections: (connections: FTPConnection[]) => void
  setActiveConnection: (connectionId: string | null) => void
  setConnectionStatus: (connected: boolean) => void
  setCurrentPath: (path: string) => void
  setFiles: (files: FTPFile[]) => void
  setFileStatus: (filePath: string, status: FileStatus | undefined) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  addConnection: (connection: FTPConnection) => void
  removeConnection: (connectionId: string) => void
  updateFileStatus: (filePath: string, isEditing: boolean, users: string[]) => void
}

export const useFTPStore = create<FTPState & FTPActions>((set, get) => ({
  // State
  connections: [],
  activeConnection: null,
  isConnected: false,
  currentPath: '/',
  files: [],
  fileStatuses: {},
  isLoading: false,
  error: null,

  // Actions
  setConnections: (connections) => {
    set({ connections })
  },

  setActiveConnection: (connectionId) => {
    set({ activeConnection: connectionId })
  },

  setConnectionStatus: (connected) => {
    set({ isConnected: connected })
  },

  setCurrentPath: (path) => {
    set({ currentPath: path })
  },

  setFiles: (files) => {
    set({ files })
  },

  setLoading: (loading) => {
    set({ isLoading: loading })
  },

  setError: (error) => {
    set({ error })
  },

  setFileStatus: (filePath, status) => {
    set((state) => ({
      fileStatuses: {
        ...state.fileStatuses,
        [filePath]: status
      }
    }))
  },

  addConnection: (connection) => {
    const { connections } = get()
    set({ connections: [...connections, connection] })
  },

  removeConnection: (connectionId) => {
    const { connections, activeConnection } = get()
    const newConnections = connections.filter(c => c.id !== connectionId)
    const newActiveConnection = activeConnection === connectionId ? null : activeConnection
    set({ 
      connections: newConnections, 
      activeConnection: newActiveConnection,
      isConnected: false 
    })
  },

  updateFileStatus: (filePath, isEditing, users) => {
    const { files } = get()
    const newFiles = files.map(file => 
      file.path === filePath 
        ? { ...file, isEditing, editingUsers: users }
        : file
    )
    set({ files: newFiles })
  }
}))
