/** Observe the documented immediate nonpersisted startup publication.
 * createCollection({startSync:true}) returns before this driver first awaits.
 * The copied observation therefore cannot be repaired by a later microtask.
 */
import { QueryClient } from '@tanstack/query-core'
import { createCollection } from '@tanstack/db'
import { queryCollectionOptions } from '../src/query'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import type {
  ImmediateMaterializationHistory,
  ImmediateMaterializationTrace,
  MaterializationResponse as Response,
  MaterializedRow as Row,
} from './immediate-eager-materialization-oracle'

const ordered = (rows: Array<Row>) =>
  rows
    .map(({ id, value }) => ({ id, value }))
    .sort((a, b) => a.id.localeCompare(b.id))
export async function observeImmediateEagerMaterialization(
  h: ImmediateMaterializationHistory,
  id: string,
  observe?: (checkpoint: string, value: unknown) => void,
): Promise<ImmediateMaterializationTrace> {
  const trace: ImmediateMaterializationTrace = []
  const record = (checkpoint: string, value: unknown) => {
    trace.push({ checkpoint, value })
    observe?.(checkpoint, value)
  }
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
    },
  })
  const encode = (rows: Array<Row>): Response =>
    h.shape === 'raw'
      ? rows.map((r) => ({ ...r }))
      : { edges: rows.map((node) => ({ node: { ...node } })) }
  const decode = (response: Response) =>
    Array.isArray(response)
      ? response
      : response.edges.map(({ node }) => ({ ...node }))
  const queryKey = [id]
  if (h.origin === 'cache') client.setQueryData(queryKey, encode(h.rows))
  let initializerCalls = 0,
    sourceCalls = 0
  const initial = encode(
    h.origin === 'initialData'
      ? h.rows
      : [{ id: 'initializer-only', value: 99 }],
  )
  const collection = createCollection(
    queryCollectionOptions({
      id,
      queryKey,
      queryClient: client,
      getKey: (row: Row) => row.id,
      startSync: true,
      enabled: false,
      staleTime: Infinity,
      select: decode,
      initialData:
        h.initializer === 'literal'
          ? initial
          : () => {
              initializerCalls++
              return initial
            },
      queryFn: () => {
        sourceCalls++
        return Promise.resolve(encode([]))
      },
    }),
  )
  // Capture before the first await. Cleanup cannot erase this publication cut.
  record('creation-return', {
    rows: ordered(Array.from(collection.values())),
    status: collection.status,
    sourceCalls,
    initializerCalls,
  })
  for (const state of [
    h.origin,
    h.shape,
    h.rows.length ? 'nonempty' : 'empty',
    ...(h.initializer === 'function' ? ['function-initializer'] : []),
    ...(h.origin === 'cache' ? ['cache-precedence'] : []),
  ])
    record('reach', state)
  await withOracleCleanup(
    () => undefined,
    [() => collection.cleanup(), () => client.clear()],
  )
  record('completed', true)
  return trace
}
