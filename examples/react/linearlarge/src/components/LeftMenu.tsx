import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import {
  BsPencilSquare as AddIcon,
  BsSearch as SearchIcon,
  BsCollectionFill as IssuesIcon,
  BsFillCaretDownFill,
  BsFillCaretRightFill,
} from 'react-icons/bs'
import { MdKeyboardArrowDown as ExpandMore } from 'react-icons/md'
import { useMode } from '@/lib/mode-context'
import { IssueModal } from './IssueModal'

function ItemGroup({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  const [showItems, setShowItems] = useState(true)
  const Icon = showItems ? BsFillCaretDownFill : BsFillCaretRightFill

  return (
    <div className="flex flex-col w-full text-sm">
      <button
        type="button"
        className="px-2 relative w-full mt-0.5 h-7 flex items-center rounded hover:bg-gray-100 cursor-pointer"
        onClick={() => setShowItems(!showItems)}
      >
        <Icon className="w-3 h-3 mr-2 -ml-1" />
        {title}
      </button>
      {showItems && children}
    </div>
  )
}

export function LeftMenu() {
  const { mode, setMode } = useMode()
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [showIssueModal, setShowIssueModal] = useState(false)

  return (
    <>
      <IssueModal isOpen={showIssueModal} onOpenChange={setShowIssueModal} />
      <div className="flex flex-col flex-shrink-0 w-56 bg-white border-r border-gray-100">
      {/* Top menu */}
      <div className="flex flex-col flex-grow-0 flex-shrink-0 px-5 py-3">
        <div className="flex items-center justify-between">
          {/* Project selection */}
          <Link
            to="/"
            search={(prev) => prev}
            className="flex items-center p-2 pr-3 rounded cursor-pointer hover:bg-gray-100"
          >
            <img
              src="/tanstack-logo.svg"
              className="w-4.5 h-4.5 mr-2.5 rounded-sm"
              alt="TanStack"
            />
            <span className="flex text-sm font-medium">linearlarge</span>
          </Link>

          {/* User avatar */}
          <div className="relative">
            <button
              type="button"
              className="flex items-center justify-center p-2 rounded cursor-pointer hover:bg-gray-100"
              onClick={() => setShowProfileMenu(!showProfileMenu)}
            >
              <div className="w-5 h-5 rounded-full bg-yellow-500 flex items-center justify-center text-white text-xs font-medium">
                L
              </div>
              <ExpandMore size={13} className="ml-2" />
            </button>

            {/* Profile dropdown menu */}
            {showProfileMenu && (
              <div className="absolute left-0 mt-2 w-48 bg-white rounded-md shadow-lg border border-gray-200 z-50">
                <div className="py-1">
                  <a
                    href="https://tanstack.com/db"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    About
                  </a>
                  <a
                    href="https://tanstack.com/db"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    Visit TanStack DB
                  </a>
                  <a
                    href="https://tanstack.com/db/latest/docs"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    Documentation
                  </a>
                  <a
                    href="https://github.com/TanStack/db"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    GitHub
                  </a>
                  <div className="border-t border-gray-200 my-1"></div>
                  <div className="px-4 py-2 text-sm text-gray-500 flex items-center justify-between">
                    <span>Disconnected</span>
                    <div className="w-8 h-4 bg-gray-300 rounded-full"></div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Create issue btn */}
        <div className="flex">
          <button
            type="button"
            className="inline-flex w-full items-center px-2 py-2 mt-3 bg-white border border-gray-300 rounded hover:bg-gray-100 h-7"
            onClick={() => setShowIssueModal(true)}
          >
            <AddIcon className="mr-2.5 w-3.5 h-3.5" /> New Issue
          </button>
          <Link
            to="/"
            search={(prev) => ({ ...prev, q: '' })}
            className="inline-flex ms-2 items-center px-2 py-2 mt-3 bg-white border border-gray-300 rounded hover:bg-gray-100 h-7"
          >
            <SearchIcon className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      <div className="flex flex-col flex-shrink flex-grow overflow-y-auto mb-0.5 px-2">
        <ItemGroup title="Your Issues">
          <Link
            to="/"
            search={(prev) => prev}
            className="flex items-center pl-6 rounded cursor-pointer group h-7 hover:bg-gray-100"
          >
            <IssuesIcon className="w-3.5 h-3.5 mr-2" />
            <span>All Issues</span>
          </Link>
          <Link
            to="/"
            search={(prev) => ({ ...prev, status: 'todo,in_progress' })}
            className="flex items-center pl-6 rounded cursor-pointer h-7 hover:bg-gray-100"
          >
            <span className="w-3.5 h-6 mr-2 inline-block">
              <span className="block w-2 h-full border-r"></span>
            </span>
            <span>Active</span>
          </Link>
          <Link
            to="/"
            search={(prev) => ({ ...prev, status: 'backlog' })}
            className="flex items-center pl-6 rounded cursor-pointer h-7 hover:bg-gray-100"
          >
            <svg
              className="w-3.5 h-3.5 mr-2"
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <circle cx="8" cy="8" r="2" />
              <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" />
            </svg>
            <span>Backlog</span>
          </Link>
        </ItemGroup>

        {/* extra space */}
        <div className="flex flex-col flex-grow flex-shrink" />

        {/* Mode switcher at bottom */}
        <div className="flex flex-col px-2 pb-2 text-gray-500 mt-7">
          <div className="text-xs font-medium mb-2">Sync Mode</div>
          <div className="flex gap-1">
            <button
              onClick={() => setMode('query')}
              className={`flex-1 px-2 py-1 text-xs rounded ${
                mode === 'query'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 hover:bg-gray-200'
              }`}
            >
              Query
            </button>
            <button
              onClick={() => setMode('electric')}
              className={`flex-1 px-2 py-1 text-xs rounded ${
                mode === 'electric'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 hover:bg-gray-200'
              }`}
            >
              Electric
            </button>
          </div>
        </div>
      </div>
      </div>
    </>
  )
}
