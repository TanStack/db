// Real Query + persisted-wrapper receiver. Gates delay collaborator completion,
// never manufacture expected rows. Public/durable comparisons live in the owner.
import { QueryClient, hashKey } from '@tanstack/query-core'
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import {
  trackStartupSync,
  untilStartup,
} from '../../db-adapter-conformance/tests/persisted-startup-driver'
import { queryCollectionOptions } from '../src/query'
import {
  precedenceFetched,
  precedenceLater,
  precedenceSaved,
  precedenceWrites,
} from './persisted-precedence-oracle'
import type {
  PersistedCollectionPersistence,
  PersistenceAdapter,
} from '../../db-sqlite-persistence-core/src'
import type { MergeRow } from './direct-write-precedence-oracle'
import type {
  PrecedenceHistory,
  PrecedenceObservation,
} from './persisted-precedence-oracle'
import type { HeldCall } from '../../db-sqlite-persistence-core/tests/reload-class-oracle'

type Row = MergeRow<number>
type Response = Array<Row> | { edges: Array<{ node: Row }>; token: string }
function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}
const snapshot = (rows: Iterable<Row>) =>
  Array.from(rows, (row) => ({ ...row })).sort((a, b) =>
    a.id.localeCompare(b.id),
  )
export async function observePersistedPrecedence(
  persistence: PersistedCollectionPersistence,
  h: PrecedenceHistory,
  id: string,
  holdBaseline?: (id: string) => HeldCall,
): Promise<PrecedenceObservation> {
  const queryHash = hashKey([id])
  const seed = createCollection(
    persistedCollectionOptions<Row, string>({
      id,
      getKey: (row) => row.id,
      persistence,
      sync: {
        sync: ({ begin, write, commit, markReady, metadata }) => {
          begin()
          for (const row of precedenceSaved) {
            write({ type: `insert`, value: { ...row } })
            metadata!.row.set(row.id, {
              queryCollection: { owners: { [queryHash]: true } },
            })
          }
          metadata!.collection.set(`queryCollection:gc:${queryHash}`, {
            queryHash,
            mode: `until-revalidated`,
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
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  })
  const resultGate = gate()
  const scanGate = gate()
  const restoreGate = gate()
  const hostRestoreHold =
    h.phase === `before-restore` ? holdBaseline?.(id) : undefined
  let heldRestore = false
  const wrapRestore = (adapter: PersistenceAdapter): PersistenceAdapter =>
    new Proxy(adapter, {
      get(target, property) {
        if (property === `loadResumeSnapshot`)
          return async (
            ...args: Parameters<PersistenceAdapter[`loadResumeSnapshot`]>
          ) => {
            if (
              h.phase === `before-restore` &&
              args[1]?.includeRows !== false &&
              !heldRestore
            ) {
              heldRestore = true
              await restoreGate.promise
            }
            return target.loadResumeSnapshot(...args)
          }
        if (property === `runInHydrationScope` && target.runInHydrationScope)
          return <T>(task: (scoped: PersistenceAdapter) => Promise<T>) =>
            target.runInHydrationScope!((scoped) => task(wrapRestore(scoped)))
        const value: unknown = Reflect.get(target, property)
        return typeof value === `function` ? value.bind(target) : value
      },
    })
  let responseAvailable = false
  let scans = 0
  let heldScan = false
  let fetches = 0
  const encode = (rows: Array<Row>): Response =>
    h.shape === `raw`
      ? rows.map((row) => ({ ...row }))
      : {
          edges: rows.map((row) => ({ node: { ...row } })),
          token: `preserved-envelope`,
        }
  const decode = (response: Response) =>
    Array.isArray(response)
      ? response
      : response.edges.map((edge) => ({ ...edge.node }))
  const options = queryCollectionOptions({
    id,
    queryKey: [id],
    queryClient: client,
    queryFn: async () => {
      fetches++
      if (fetches === 1 && h.origin !== `cache`) await resultGate.promise
      responseAvailable = true
      return encode(
        fetches === 1 && h.origin !== `cache`
          ? precedenceFetched
          : precedenceLater,
      )
    },
    select: decode,
    getKey: (row: Row) => row.id,
    persistedGcTime: Infinity,
    enabled: h.phase !== `before-fetch` && h.origin !== `cache`,
  })
  const original = options.sync.sync
  const tracked = trackStartupSync<Row, string>({
    ...options.sync,
    sync: (params) => {
      const capability = params.metadata!.persistence!
      return original({
        ...params,
        metadata: {
          ...params.metadata!,
          persistence: {
            ...capability,
            scanPersistedRows: async (...args) => {
              scans++
              if (
                h.phase === `during-baseline` &&
                responseAvailable &&
                !heldScan
              ) {
                // Capture first in the after-read case: a newer direct write must not
                // depend on a conveniently fresh storage read to survive the fetch.
                const rows =
                  h.scanCut === `after-read`
                    ? await capability.scanPersistedRows(...args)
                    : undefined
                heldScan = true
                await scanGate.promise
                if (rows) return rows
              }
              return capability.scanPersistedRows(...args)
            },
          },
        },
      })
    },
  })
  const collection = createCollection(
    persistedCollectionOptions({
      ...options,
      sync: tracked.sync,
      persistence: {
        ...persistence,
        adapter: hostRestoreHold
          ? persistence.adapter
          : wrapRestore(persistence.adapter),
      },
    }),
  )
  const durable = async () => {
    if (!persistence.adapter.scanRows)
      throw new Error(`Persisted precedence requires row scans`)
    return snapshot(
      (
        await persistence.adapter.scanRows({ kind: `eager`, collectionId: id })
      ).map((row) => row.value as Row),
    )
  }
  return withOracleCleanup(async () => {
    const preload = collection.preload()
    void preload.catch(() => {})
    await untilStartup(
      () =>
        (h.origin === `cache` || h.phase === `before-fetch` || fetches === 1) &&
        (h.phase === `before-restore`
          ? (hostRestoreHold?.isHeld() ?? heldRestore)
          : collection.has(`k`)),
    )
    if (hostRestoreHold?.isHeld()) heldRestore = true
    if (h.origin === `cache`) {
      responseAvailable = true
      client.setQueryData([id], encode(precedenceFetched))
    }
    if (h.phase === `during-baseline`) {
      resultGate.release()
      await untilStartup(() => heldScan)
    }
    const applyWrites = async () => {
      for (const write of precedenceWrites(h)) {
        if (`deleted` in write) await collection.utils.writeDelete(write.id)
        else if (h.op === `insert`) await collection.utils.writeInsert(write)
        else if (h.op === `update`) await collection.utils.writeUpdate(write)
        else await collection.utils.writeUpsert(write)
      }
    }
    const written = applyWrites()
    if (h.phase === `before-restore`) {
      resultGate.release()
      await untilStartup(() => responseAvailable)
      restoreGate.release()
      hostRestoreHold?.release()
    }
    await written
    const afterWrite =
      h.phase === `before-restore` ? undefined : snapshot(collection.values())
    const firstFetch =
      h.phase === `before-fetch`
        ? collection.utils.refetch({ throwOnError: true })
        : undefined
    void firstFetch?.catch(() => {})
    resultGate.release()
    scanGate.release()
    await tracked.initialResult
    await firstFetch
    await preload
    const first = snapshot(collection.values())
    const firstDurable = await durable()
    const firstCache = snapshot(decode(client.getQueryData<Response>([id])!))
    let later: Array<Row> | undefined
    let laterDurable: Array<Row> | undefined
    if (h.laterFetch) {
      later = await collection.utils
        .refetch({ throwOnError: true })
        .then(() => snapshot(collection.values()))
      laterDurable = await durable()
    }
    return {
      afterWrite,
      first,
      firstDurable,
      firstCache,
      later,
      laterDurable,
      scans,
      heldScan,
      heldRestore,
      fetches,
    }
  }, [
    resultGate.release,
    scanGate.release,
    restoreGate.release,
    () => hostRestoreHold?.uninstall(),
    () => collection.cleanup(),
    () => client.clear(),
  ])
}
