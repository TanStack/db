import { useState } from "react"
import {
  Link,
  Outlet,
  createFileRoute,
  useNavigate,
} from "@tanstack/react-router"
import { useLiveQuery } from "@tanstack/react-db"
import { authClient } from "@/lib/auth-client"
import { boardCollection } from "@/lib/collections"

export const Route = createFileRoute(`/_authenticated`)({
  component: AuthenticatedLayout,
  ssr: false,
})

function AuthenticatedLayout() {
  const { data: session, isPending } = authClient.useSession()
  const navigate = useNavigate()
  const [showNewBoardForm, setShowNewBoardForm] = useState(false)
  const [newBoardName, setNewBoardName] = useState(``)
  const [newBoardColor, setNewBoardColor] = useState(`#3b82f6`)

  const { data: boards } = useLiveQuery((q) =>
    q.from({ boardCollection })
  )

  const handleLogout = async () => {
    await authClient.signOut()
    navigate({ to: `/login` })
  }

  const handleCreateBoard = () => {
    if (newBoardName.trim() && session) {
      boardCollection.insert({
        id: Math.floor(Math.random() * 100000),
        name: newBoardName.trim(),
        color: newBoardColor,
        ownerId: session.user.id,
        createdAt: new Date(),
      })
      setNewBoardName(``)
      setNewBoardColor(`#3b82f6`)
      setShowNewBoardForm(false)
    }
  }

  const handleDeleteBoard = (boardId: number) => {
    if (confirm(`Are you sure you want to delete this board?`)) {
      boardCollection.delete(boardId)
    }
  }

  if (isPending) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <p className="text-slate-400">Loading...</p>
      </div>
    )
  }

  if (!session) {
    return null
  }

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-50">
        <div className="container mx-auto px-6">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-8">
              <Link to="/" className="text-2xl font-bold text-white">
                Trellix
              </Link>
              <nav className="flex gap-4 text-sm">
                <a
                  href="https://tanstack.com/db"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-400 hover:text-white transition-colors"
                >
                  Docs
                </a>
                <a
                  href="https://github.com/tanstack/db"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-400 hover:text-white transition-colors"
                >
                  Source
                </a>
              </nav>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-slate-400">
                {session.user.email}
              </span>
              <button
                onClick={handleLogout}
                className="text-sm font-medium text-slate-400 hover:text-white px-3 py-2 rounded-md hover:bg-slate-700 transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        {/* Boards Grid */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-white">Your Boards</h2>
            <button
              onClick={() => setShowNewBoardForm(!showNewBoardForm)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              + New Board
            </button>
          </div>

          {/* New Board Form */}
          {showNewBoardForm && (
            <div className="mb-6 p-4 bg-slate-800 rounded-lg border border-slate-700">
              <div className="flex gap-4 items-end">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Board Name
                  </label>
                  <input
                    type="text"
                    value={newBoardName}
                    onChange={(e) => setNewBoardName(e.target.value)}
                    onKeyDown={(e) => e.key === `Enter` && handleCreateBoard()}
                    placeholder="Enter board name"
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Color
                  </label>
                  <input
                    type="color"
                    value={newBoardColor}
                    onChange={(e) => setNewBoardColor(e.target.value)}
                    className="h-10 w-16 rounded cursor-pointer"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateBoard}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Create
                  </button>
                  <button
                    onClick={() => setShowNewBoardForm(false)}
                    className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-500 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Boards List */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {boards.map((board) => (
              <div key={board.id} className="relative group">
                <Link
                  to="/board/$boardId"
                  params={{ boardId: board.id.toString() }}
                  className="block p-4 bg-slate-800 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors"
                  style={{ borderBottomColor: board.color, borderBottomWidth: '4px' }}
                >
                  <h3 className="font-medium text-white">{board.name}</h3>
                </Link>
                <button
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    handleDeleteBoard(board.id)
                  }}
                  className="absolute top-2 right-2 p-1 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Delete board"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {boards.length === 0 && !showNewBoardForm && (
            <div className="text-center py-12">
              <p className="text-slate-400 mb-4">No boards yet. Create your first board to get started!</p>
              <button
                onClick={() => setShowNewBoardForm(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Create Board
              </button>
            </div>
          )}
        </div>

        <Outlet />
      </main>
    </div>
  )
}
