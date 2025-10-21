import { createContext, useContext, useState, type ReactNode } from 'react'
import type { Collection } from '@tanstack/db'
import type { Issue, Comment } from '@/db/schema'
import {
  issuesQueryCollection,
  commentsQueryCollection,
} from './collections/query-mode'
import {
  issuesElectricCollection,
  commentsElectricCollection,
} from './collections/electric-mode'

export type SyncMode = 'query' | 'electric'

interface ModeContextValue {
  mode: SyncMode
  setMode: (mode: SyncMode) => void
  issuesCollection: Collection<Issue>
  commentsCollection: Collection<Comment>
}

const ModeContext = createContext<ModeContextValue | null>(null)

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<SyncMode>('query')

  const issuesCollection =
    mode === 'query' ? issuesQueryCollection : issuesElectricCollection
  const commentsCollection =
    mode === 'query' ? commentsQueryCollection : commentsElectricCollection

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
