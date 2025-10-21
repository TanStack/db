import { Link } from '@tanstack/react-router'
import { Home, LayoutGrid, Plus, Search } from 'lucide-react'
import { useMode } from '@/lib/mode-context'
import { cn } from '@/lib/utils'

export function LeftMenu() {
  const { mode, setMode } = useMode()

  return (
    <aside className="w-64 bg-gray-50 border-r border-gray-200 flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <h1 className="text-xl font-bold">LinearLite</h1>
        <p className="text-xs text-gray-500 mt-1">
          TanStack Start + TanStack DB
        </p>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        <Link
          to="/issues"
          className={cn(
            `flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors`,
            `hover:bg-gray-200`
          )}
          activeProps={{
            className: `bg-gray-200 text-gray-900`,
          }}
        >
          <Home size={18} />
          All Issues
        </Link>

        <Link
          to="/board"
          className={cn(
            `flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors`,
            `hover:bg-gray-200`
          )}
          activeProps={{
            className: `bg-gray-200 text-gray-900`,
          }}
        >
          <LayoutGrid size={18} />
          Board
        </Link>

        <Link
          to="/issues"
          search={{ q: `` }}
          className={cn(
            `flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors`,
            `hover:bg-gray-200`
          )}
        >
          <Search size={18} />
          Search
        </Link>

        <div className="pt-4">
          <button
            className={cn(
              `w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors`,
              `bg-primary text-white hover:opacity-90`
            )}
          >
            <Plus size={18} />
            New Issue
          </button>
        </div>
      </nav>

      <div className="p-4 border-t border-gray-200">
        <div className="mb-2 text-xs font-medium text-gray-600 uppercase tracking-wide">
          Sync Mode
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setMode(`query`)}
            className={cn(
              `flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors`,
              mode === `query`
                ? `bg-blue-500 text-white`
                : `bg-gray-200 text-gray-700 hover:bg-gray-300`
            )}
          >
            Query
          </button>
          <button
            onClick={() => setMode(`electric`)}
            className={cn(
              `flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors`,
              mode === `electric`
                ? `bg-blue-500 text-white`
                : `bg-gray-200 text-gray-700 hover:bg-gray-300`
            )}
          >
            Electric
          </button>
        </div>
        <div className="mt-2 text-xs text-gray-500">
          {mode === `query` ? `Polling every 3s` : `Real-time sync`}
        </div>
      </div>
    </aside>
  )
}
