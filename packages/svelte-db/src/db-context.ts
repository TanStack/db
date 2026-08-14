import { getContext, setContext } from 'svelte'
import type { DbClient } from '@tanstack/db'

const dbClientContext = Symbol.for(`@tanstack/svelte-db.DbClient`)
type DbClientContext = () => DbClient

export function setDbClientContext(client: DbClientContext): DbClientContext {
  return setContext(dbClientContext, client)
}

export function useDbClient(): DbClient {
  const client = useOptionalDbClient()
  if (!client) {
    throw new Error(`useDbClient must be used within a DbProvider.`)
  }
  return client
}

export function useOptionalDbClient(): DbClient | undefined {
  try {
    return getContext<DbClientContext | undefined>(dbClientContext)?.()
  } catch {
    // Legacy helpers may be called from a rune root rather than a component.
    return undefined
  }
}
