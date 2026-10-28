import type { Collection } from '@tanstack/db'

/**
 * Builds a source Collection that fails during startup, from the adapter's
 * own `createCollection`, so every driver faces the same failure.
 *
 * - `fail`: the sync adapter calls `fail()` before its first ready, a failed
 *   first load (`status: 'error'`). Startup returns normally.
 * - `crash`: the sync function throws, a programming error that crashes the
 *   Collection (`status: 'crashed'`). Startup rethrows the error.
 */
export function makeErrorSource(
  createCollection: (options: any) => Collection<any, any, any>,
  id: string,
  kind: `fail` | `crash`,
): {
  collection: Collection<any, any, any>
  expectedError: Error
  startup: { returned: true } | { returned: false; error: unknown }
} {
  const expectedError = new Error(`conformance: sync ${kind}`)
  let startup: { returned: true } | { returned: false; error: unknown } = {
    returned: true,
  }
  const collection = createCollection({
    id,
    getKey: (row: { id: string }) => row.id,
    startSync: false,
    sync: {
      sync: (params: { fail: (error: unknown) => void }) => {
        if (kind === `crash`) throw expectedError
        params.fail(expectedError)
      },
    },
  })
  try {
    collection.startSyncImmediate()
  } catch (error) {
    startup = { returned: false, error }
  }
  return { collection, expectedError, startup }
}
