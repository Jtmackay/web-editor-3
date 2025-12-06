import React, { useState, useEffect } from 'react'
import { User, Circle } from 'lucide-react'
import { electronAPI } from '../utils/electronAPI'

const UserPresence: React.FC = () => {
  const [users, setUsers] = useState<any[]>([])
  const [activeFiles, setActiveFiles] = useState<any[]>([])

  useEffect(() => {
    const load = async () => {
      const u = await electronAPI.dbGetUsers()
      if (u.success && u.users) setUsers(u.users)
      const af = await electronAPI.dbGetActiveFiles()
      if (af.success && af.files) setActiveFiles(af.files)
    }
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [])

  const getUserStatusColor = (status: string) => {
    if (status === 'online') return 'bg-green-500'
    if (status === 'away') return 'bg-yellow-500'
    return 'bg-gray-500'
  }

  const getUserActiveFile = (userId: number) => {
    const f = activeFiles.find((x) => x.user_id === userId)
    return f ? f.file_path : null
  }

  return (
    <div className="flex-1 p-4 space-y-3">
      {users.map((user) => (
        <div key={user.id} className="flex items-center gap-3 p-2 rounded hover:bg-vscode-hover transition-colors">
          <div className="relative">
            <div className="w-8 h-8 bg-vscode-border rounded-full flex items-center justify-center">
              <User size={16} className="text-vscode-text-muted" />
            </div>
            <div className={`absolute -bottom-1 -right-1 w-3 h-3 ${getUserStatusColor(user.status)} rounded-full border-2 border-vscode-sidebar`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium truncate">{user.username}</h4>
              <Circle size={8} className={getUserStatusColor(user.status)} fill="currentColor" />
            </div>
            {getUserActiveFile(user.id) && user.status === 'online' && (
              <p className="text-xs text-vscode-text-muted truncate">Editing: {getUserActiveFile(user.id)}</p>
            )}
          </div>
        </div>
      ))}
      {users.length === 0 && (
        <div className="text-center text-vscode-text-muted py-8">
          <User size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">No team members</p>
        </div>
      )}
    </div>
  )
}

export default UserPresence
