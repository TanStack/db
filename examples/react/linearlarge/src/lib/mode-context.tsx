import { createContext, useContext, type ReactNode } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import type { Collection } from '@tanstack/db'
import type { Issue, Comment } from '@/db/schema'
import {
  getIssuesQueryCollection,
  getCommentsQueryCollection,
  getIssuesElectricCollection,
  getCommentsElectricCollection,
} from './collections'

export type SyncMode = 'query' | 'electric'

interface ModeContextValue {
  mode: SyncMode
  setMode: (mode: SyncMode) => void
  issuesCollection: Collection<Issue>
  commentsCollection: Collection<Comment>
}

const ModeContext = createContext<ModeContextValue | null>(null)

export function ModeProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const search = useSearch({ strict: false })

  // Read mode from query param, default to 'query'
  const mode = (search.mode === 'electric' ? 'electric' : 'query') as SyncMode

  const setMode = (newMode: SyncMode) => {
    navigate({
      search: (prev) => ({ ...prev, mode: newMode }),
    })
  }

  const issuesCollection =
    mode === 'query' ? getIssuesQueryCollection() : getIssuesElectricCollection()
  const commentsCollection =
    mode === 'query' ? getCommentsQueryCollection() : getCommentsElectricCollection()

  return (
    <ModeContext.Provider
      value={{ mode, setMode, issuesCollection, commentsCollection }}
    >
      {children}
    </ModeContext.Provider>
  )
}

export function useMode() {
  const context = useContext(ModeContext)
  if (!context) {
    throw new Error('useMode must be used within ModeProvider')
  }
  return context
}
