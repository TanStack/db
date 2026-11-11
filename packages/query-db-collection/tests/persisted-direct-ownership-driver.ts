/** Production receiving path for the primary Query direct-row ownership law.
 * The first physical response is held across one accepted direct write.
 * Receipts identify application; public and durable observations are copied
 * before cleanup. Post-cleanup durability and Query events are diagnostics.
 */
import { QueryClient, hashKey } from '@tanstack/query-core'
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import {
  trackStartupSync,
  untilStartup,
} from '../../db-adapter-conformance/tests/persisted-startup-driver'
import { queryCollectionOptions } from '../src/query'
import type { PersistedCollectionPersistence } from '../../db-sqlite-persistence-core/src'
import type {
  DirectOwnershipHistory,
  DirectOwnershipTrace,
  DirectOwnershipResponse as Response,
  DirectOwnershipRow as Row,
  OwnedDirectRow as SeenRow,
} from './persisted-direct-ownership-oracle'

function owners(metadata: unknown, sourceHash: string): Array<string> {
  if (!metadata || typeof metadata !== 'object') return []
  const query = (metadata as Record<string, unknown>).queryCollection
  if (!query || typeof query !== 'object') return []
  const claims = (query as Record<string, unknown>).owners
  if (!claims || typeof claims !== 'object') return []
  return Object.keys(claims)
    .map((owner) => (owner === sourceHash ? 'source' : owner))
    .sort()
}
function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}
const sortRows = (rows: Array<SeenRow>) =>
  rows.sort((left, right) => left.id.localeCompare(right.id))

export async function observePersistedDirectOwnership(
  persistence: PersistedCollectionPersistence,
  h: DirectOwnershipHistory,
  id: string,
  observe?: (checkpoint: string, value: unknown) => void,
): Promise<DirectOwnershipTrace> {
  const trace: DirectOwnershipTrace = []
  const record = (checkpoint: string, value: unknown) => {
    trace.push({ checkpoint, value })
    observe?.(checkpoint, value)
  }

  const queryKey = [id]
  const queryHash = hashKey(queryKey)
  const savedKey = h.overlapsSaved ? 'x' : 'saved'
  const seed = createCollection(
    persistedCollectionOptions<Row, string>({
      id,
      getKey: (row) => row.id,
      persistence,
      sync: {
        sync: ({ begin, write, commit, markReady, metadata }) => {
          begin()
          write({
            type: 'insert',
            value: { id: savedKey, value: h.savedValue },
          })
          metadata!.row.set(savedKey, {
            queryCollection: { owners: { [queryHash]: true } },
          })
          if (h.retained)
            metadata!.collection.set('queryCollection:gc:' + queryHash, {
              queryHash,
              mode: 'until-revalidated',
            })
          commit()
          markReady()
        },
      },
    }),
  )
  await withOracleCleanup(() => seed.preload(), [() => seed.cleanup()])
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
    },
  })
  const response = gate()
  let calls = 0
  let responseReturned = false
  let resultApplied: Promise<void> | undefined
  const events: Array<unknown> = []
  client.getQueryCache().subscribe((event) => {
    if (event.type === 'updated')
      events.push({
        event: 'query-' + event.action.type,
        fetching: event.query.state.fetchStatus,
        data: event.query.state.data,
      })
  })
  const decode = (value: Response): Array<Row> =>
    Array.isArray(value) ? value : value.edges.map(({ node }) => ({ ...node }))
  const options = queryCollectionOptions({
    id,
    queryKey,
    queryClient: client,
    getKey: (row: Row) => row.id,
    select: decode,
    enabled: h.write === 'after-fetch-start',
    persistedGcTime: Infinity,
    queryFn: async (): Promise<Response> => {
      calls++
      await response.promise
      responseReturned = true
      const values = [
        ...(!h.overlapsSaved && h.keepsSaved
          ? [{ id: 'saved', value: h.sourceValue }]
          : []),
        ...(h.includesDirect ? [{ id: 'x', value: h.sourceValue }] : []),
      ]
      return h.shape === 'raw'
        ? values
        : { edges: values.map((node) => ({ node })) }
    },
  })
  const sourceSync = options.sync.sync
  let writes: Array<unknown> = []
  const tracked = trackStartupSync<Row, string>({
    ...options.sync,
    sync: (params) =>
      sourceSync({
        ...params,
        write: (message) => {
          // Observe the actual adapter input before the persistence wrapper or
          // core can normalize it. Undefined remains an observable violation.
          record('sync-write', message.type)
          writes.push(message)
          params.write(message)
          if (
            responseReturned &&
            'value' in message &&
            message.value.id === 'x'
          )
            // A row-bearing write proves the fetched row crossed the boundary.
            // Its operation remains an independent protocol judgment.
            record('reach', 'fetched-row-write')
        },
        commit: (signal) => {
          const receipt = params.commit(signal)
          events.push({ event: 'commit', responseReturned, writes })
          writes = []
          if (responseReturned)
            resultApplied = Promise.resolve(receipt).then(() => undefined)
          return receipt
        },
      }),
  })
  const collection = createCollection(
    persistedCollectionOptions({
      ...options,
      sync: tracked.sync,
      persistence,
    }),
  )
  const durable = async () => {
    if (!persistence.adapter.scanRows)
      throw new Error('Candidate requires persisted row metadata scans')
    return sortRows(
      (
        await persistence.adapter.scanRows({
          kind: 'eager',
          collectionId: id,
        })
      ).map(({ value, metadata }) => ({
        ...(value as Row),
        owners: owners(metadata, queryHash),
      })),
    )
  }
  await withOracleCleanup(async () => {
    const preload = collection.preload()
    void preload.catch(() => {})
    await untilStartup(
      () =>
        collection.has(savedKey) &&
        calls === Number(h.write === 'after-fetch-start'),
    )
    const direct = { id: 'x', value: h.directValue }
    if (h.operation === 'insert') await collection.utils.writeInsert(direct)
    else await collection.utils.writeUpsert(direct)
    const fetched =
      h.write === 'before-fetch'
        ? collection.utils.refetch({ throwOnError: true })
        : undefined
    void fetched?.catch(() => {})
    response.release()
    await untilStartup(() => resultApplied !== undefined)
    await resultApplied
    await tracked.initialResult
    await fetched
    await preload
    record('diagnostics', { events, fetching: client.isFetching() })
    record(
      'first',
      sortRows(
        Array.from(collection.values(), ({ id: key, value }) => ({
          id: key,
          value,
          owners: owners(collection._state.syncedMetadata.get(key), queryHash),
        })),
      ),
    )
    record('firstDurable', await durable())
    for (const state of [
      h.shape,
      h.retained ? 'retained' : 'no-retention',
      h.write,
      h.overlapsSaved
        ? 'overlapping-saved-direct-key'
        : 'distinct-saved-direct-key',
      h.includesDirect ? 'source-includes-direct' : 'source-omits-direct',
      ...(!h.retained && h.write === 'after-fetch-start'
        ? ['no-retention-direct-after-fetch']
        : []),
    ])
      record('reach', state)
    if (
      h.retained &&
      !h.overlapsSaved &&
      h.write === 'before-fetch' &&
      h.includesDirect &&
      h.directValue !== h.sourceValue
    )
      record('reach', 'retained-direct-before-returned-key')
    if (
      h.overlapsSaved &&
      h.retained &&
      h.write === 'before-fetch' &&
      h.includesDirect &&
      h.sourceValue === h.savedValue &&
      h.directValue !== h.savedValue
    )
      record('reach', 'returned-value-equals-saved-after-direct-change')
    await collection.cleanup()
    record('afterCleanupDurableDiagnostic', await durable())
    record('completed', true)
  }, [response.release, () => collection.cleanup(), () => client.clear()])

  return trace
}
