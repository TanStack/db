import { createContext, useContext } from 'react'
import type { DbClient } from '@tanstack/db'
import type { ReactNode } from 'react'

const DbContext = createContext<DbClient | undefined>(undefined)

export type DbProviderProps = {
  client: DbClient
  children?: ReactNode
}

export function DbProvider(props: DbProviderProps) {
  return (
    <DbContext.Provider value={props.client}>
      {props.children}
    </DbContext.Provider>
  )
}

export function useDbClient(): DbClient {
  const client = useContext(DbContext)
  if (!client) {
    throw new Error(`useDbClient must be used within a DbProvider.`)
  }
  return client
}

export function useOptionalDbClient(): DbClient | undefined {
  return useContext(DbContext)
}
