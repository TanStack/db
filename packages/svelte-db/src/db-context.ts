import { getContext, setContext } from 'svelte'
import type { DbClient } from '@tanstack/db'

const dbClientContext = Symbol.for(`@tanstack/svelte-db.DbClient`)
type DbClientContext = () => DbClient
type ScopedDbContext = { client: DbClient; hydrating: boolean | undefined }

export function setDbClientContext(
  client: DbClientContext,
  hydrating?: () => boolean,
): DbClientContext {
  setContext(dbClientContext, () => ({
    client: client(),
    hydrating: hydrating?.(),
  }))
  return client
}

export function useDbClient(): DbClient {
  const client = useOptionalDbClient()
  if (!client) {
    throw new Error(`useDbClient must be used within a DbProvider.`)
  }
  return client
}

export function useOptionalDbClient(): DbClient | undefined {
  return useDbContext()?.client
}

// Client ownership and initial host intent belong to the same provider scope.
// Reading both together avoids another context key or a second context lookup.
export function useDbContext(): ScopedDbContext | undefined {
  try {
    return getContext<(() => ScopedDbContext) | undefined>(dbClientContext)?.()
  } catch {
    // Legacy helpers may be called from a rune root rather than a component.
    return undefined
  }
}
