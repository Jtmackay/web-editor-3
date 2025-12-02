import { create } from 'zustand'

export interface EditorFile {
  id: string
  path: string
  name: string
  content: string
  language: string
  isDirty: boolean
  lastModified: Date
}

interface EditorState {
  openFiles: EditorFile[]
  activeFile: string | null
  isLoading: boolean
  error: string | null
  currentUserId: number | null
}

interface EditorActions {
  openFile: (file: EditorFile) => void
  closeFile: (fileId: string) => void
  setActiveFile: (fileId: string | null) => void
  updateFileContent: (fileId: string, content: string) => void
  setFileDirty: (fileId: string, isDirty: boolean) => void
  renameFile: (fileId: string, newPath: string, newName: string) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setCurrentUserId: (id: number) => void
}

export const useEditorStore = create<EditorState & EditorActions>((set, get) => ({
  // State
  openFiles: [],
  activeFile: null,
  isLoading: false,
  error: null,
  currentUserId: null,

  // Actions
  openFile: (file) => {
    const { openFiles } = get()
    const existingFile = openFiles.find(f => f.id === file.id)
    
    if (!existingFile) {
      set({
        openFiles: [...openFiles, file],
        activeFile: file.id,
        error: null
      })
    } else {
      set({ activeFile: file.id, error: null })
    }
  },

  closeFile: (fileId) => {
    const { openFiles, activeFile } = get()
    const newFiles = openFiles.filter(f => f.id !== fileId)
    
    let newActiveFile = activeFile
    if (activeFile === fileId) {
      const currentIndex = openFiles.findIndex(f => f.id === fileId)
      if (newFiles.length > 0) {
        newActiveFile = newFiles[Math.max(0, currentIndex - 1)].id
      } else {
        newActiveFile = null
      }
    }
    
    set({ openFiles: newFiles, activeFile: newActiveFile })
  },

  setActiveFile: (fileId) => {
    set({ activeFile: fileId })
  },

  updateFileContent: (fileId, content) => {
    const { openFiles } = get()
    const newFiles = openFiles.map(file => 
      file.id === fileId 
        ? { ...file, content, isDirty: true, lastModified: new Date() }
        : file
    )
    set({ openFiles: newFiles })
  },

  setFileDirty: (fileId, isDirty) => {
    const { openFiles } = get()
    const newFiles = openFiles.map(file => 
      file.id === fileId 
        ? { ...file, isDirty }
        : file
    )
    set({ openFiles: newFiles })
  },

  renameFile: (fileId, newPath, newName) => {
    const { openFiles, activeFile } = get()
    const newFiles = openFiles.map(file =>
      file.id === fileId
        ? { ...file, id: newPath, path: newPath, name: newName }
        : file
    )
    const newActive = activeFile === fileId ? newPath : activeFile
    set({ openFiles: newFiles, activeFile: newActive })
  },

  setLoading: (loading) => {
    set({ isLoading: loading })
  },

  setError: (error) => {
    set({ error })
  }
  ,
  setCurrentUserId: (id) => {
    set({ currentUserId: id })
  }
}))
