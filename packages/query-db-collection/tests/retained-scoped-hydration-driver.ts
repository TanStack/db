/**
 * Real Query / persisted-wrapper receiving path. The first instance acquires
 * both scopes and persists retention through cleanup. A fresh QueryClient then
 * acquires only one scope. A response gate supplies the pending observation;
 * fulfillment callbacks capture the public answer before a later load can
 * repair it. Capability counters describe execution and impose no call law.
 */
import { QueryClient } from '@tanstack/query-core'
import { IR, createCollection, getLoadSubsetDemandKey } from '@tanstack/db'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { untilStartup } from '../../db-adapter-conformance/tests/persisted-startup-driver'
import { queryCollectionOptions } from '../src/query'
import {
  otherRetainedScope,
  scopedHydrationPage,
  scopedHydrationRows,
  sortScopedRows,
} from './retained-scoped-hydration-oracle'
import type { LoadSubsetOptions } from '@tanstack/db'
import type { PersistedCollectionPersistence } from '../../db-sqlite-persistence-core/src'
import type {
  CachedPeerClaimHistory,
  CachedPeerClaimObservation,
  RetainedScope,
  ScopedHydrationHistory,
  ScopedHydrationObservation,
  ScopedHydrationRow,
} from './retained-scoped-hydration-oracle'

export const retainedScopeDemand = (
  scope: RetainedScope,
): LoadSubsetOptions => ({
  where: new IR.Func(`eq`, [new IR.PropRef([`scope`]), new IR.Value(scope)]),
})
export function requestedRetainedScope(
  options: LoadSubsetOptions,
): RetainedScope {
  const where = options.where
  if (
    where?.type !== `func` ||
    where.name !== `eq` ||
    where.args[0]?.type !== `ref` ||
    where.args[0].path[0] !== `scope` ||
    where.args[1]?.type !== `val` ||
    (where.args[1].value !== `a` && where.args[1].value !== `b`)
  )
    throw new Error(`Scoped hydration fixture requires one scope equality`)
  return where.args[1].value
}

/** Overlapping Query claims receive one continuously owned keyed row. */
export async function observeCachedPeerClaim(
  persistence: PersistedCollectionPersistence,
  h: CachedPeerClaimHistory,
  id: string,
  sourceFactory = queryCollectionOptions,
  record?: (checkpoint: string, value: unknown) => void,
): Promise<CachedPeerClaimObservation> {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
    },
  })
  const broad = retainedScopeDemand(`a`)
  const narrow = { ...broad, limit: 1 }
  const narrowKey = [id, getLoadSubsetDemandKey(narrow)]
  let calls = 0
  let durableValue!: () => Promise<number | undefined>
  const row = (value: number): ScopedHydrationRow => ({
    id: `shared`,
    scope: `a`,
    value,
  })
  const options = sourceFactory({
    id,
    queryKey: [id],
    queryClient: client,
    syncMode: `on-demand`,
    startSync: true,
    getKey: (value: ScopedHydrationRow) => value.id,
    queryFn: () => Promise.resolve([row(++calls === 1 ? h.current : h.later)]),
  })
  const collection = createCollection(
    persistedCollectionOptions({
      ...options,
      persistence,
      sync: {
        ...options.sync,
        sync: (params) => {
          durableValue = async () => {
            const saved = (
              await params.metadata!.persistence!.scanPersistedRows()
            ).find((entry) => entry.key === `shared`)?.value as
              ScopedHydrationRow | undefined
            return saved?.value
          }
          return options.sync.sync(params)
        },
      },
    }),
  )
  return withOracleCleanup(async () => {
    await collection.preload()
    if (h.cache === `older-fetch`)
      await client.fetchQuery({
        queryKey: narrowKey,
        queryFn: () => Promise.resolve([row(h.cached)]),
      })
    await collection._sync.loadSubset(broad)
    const before = collection.get(`shared`)?.value
    record?.(`before`, before)
    if (h.cache === `manual`) client.setQueryData(narrowKey, [row(h.cached)])
    const claimed = await Promise.resolve(
      collection._sync.loadSubset(narrow),
    ).then(() => {
      const value = collection.get(`shared`)?.value
      record?.(`claimed`, value)
      return value
    })
    const claimedDurable = await durableValue()
    record?.(`claimedDurable`, claimedDurable)
    const callsBeforeRefetch = calls
    const refetched = await Promise.resolve(
      collection._sync.loadSubset({ ...narrow, refetch: true }),
    ).then(() => {
      const value = collection.get(`shared`)?.value
      record?.(`refetched`, value)
      return value
    })
    const refetchedDurable = await durableValue()
    record?.(`refetchedDurable`, refetchedDurable)
    const observed = {
      before,
      claimed,
      claimedDurable,
      refetched,
      refetchedDurable,
      callsBeforeRefetch,
      calls,
    }
    record?.(`completed`, observed)
    return observed
  }, [() => collection.cleanup(), () => client.clear()])
}
export async function observeRetainedScopedHydration(
  persistence: PersistedCollectionPersistence,
  h: ScopedHydrationHistory,
  id: string,
  sourceFactory = queryCollectionOptions,
  record?: (checkpoint: string, value: unknown) => void,
): Promise<ScopedHydrationObservation> {
  const makeClient = () =>
    new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      },
    })
  const other = otherRetainedScope(h.first)
  const seedFirstDemand = retainedScopeDemand(h.first)
  const firstDemand =
    h.window === `all`
      ? seedFirstDemand
      : {
          ...seedFirstDemand,
          orderBy: [
            {
              expression: new IR.PropRef([`id`]),
              compareOptions: {
                direction: `desc` as const,
                nulls: `last` as const,
                stringSort: `lexical` as const,
              },
            },
          ],
          limit: 1,
        }
  const otherDemand = retainedScopeDemand(other)
  const seedClient = makeClient()
  const seedReceipts: Array<true | Promise<void>> = []
  const seedOptions = queryCollectionOptions({
    id,
    queryKey: [id],
    queryClient: seedClient,
    syncMode: `on-demand`,
    startSync: true,
    persistedGcTime: Infinity,
    getKey: (row: ScopedHydrationRow) => row.id,
    queryFn: (context) => {
      const scope = requestedRetainedScope(
        context.meta?.loadSubsetOptions ?? {},
      )
      return Promise.resolve(
        scopedHydrationRows(
          scope,
          scope === h.first ? h.previous : h.otherPrevious,
          1,
        ),
      )
    },
  })
  const seed = createCollection(
    persistedCollectionOptions({
      ...seedOptions,
      sync: {
        ...seedOptions.sync,
        sync: (params) =>
          seedOptions.sync.sync({
            ...params,
            commit: (...args) => {
              const receipt = params.commit(...args)
              seedReceipts.push(receipt)
              return receipt
            },
          }),
      },
      persistence,
    }),
  )
  await withOracleCleanup(async () => {
    await seed._sync.loadSubset(seedFirstDemand)
    await seed._sync.loadSubset(otherDemand)
    if (h.ownerless !== `none`)
      await seed.utils.writeInsert({
        id: `saved-direct`,
        scope: h.ownerless === `first` ? h.first : other,
        value: 1,
      })
    seed._sync.unloadSubset(seedFirstDemand)
    seed._sync.unloadSubset(otherDemand)
    await Promise.all(seedReceipts)
  }, [() => seed.cleanup(), () => seedClient.clear()])

  const client = makeClient()
  let release!: () => void
  const responseGate = new Promise<void>((resolve) => {
    release = resolve
  })
  let fetches = 0
  let retainedScopes = 0
  let hydrateCalls = 0
  let scanCalls = 0
  let durableRows: (() => Promise<Array<ScopedHydrationRow>>) | undefined
  const options = sourceFactory({
    id,
    queryKey: [id],
    queryClient: client,
    syncMode: `on-demand`,
    startSync: true,
    persistedGcTime: Infinity,
    getKey: (row: ScopedHydrationRow) => row.id,
    queryFn: async (context) => {
      const scope = requestedRetainedScope(
        context.meta?.loadSubsetOptions ?? {},
      )
      fetches++
      if (fetches === 1) await responseGate
      return scopedHydrationPage(
        scopedHydrationRows(
          scope,
          scope === h.first ? h.next : h.otherNext,
          h.value,
        ),
        scope === h.first ? h.window : `all`,
      )
    },
  })
  const original = options.sync.sync
  const collection = createCollection(
    persistedCollectionOptions({
      ...options,
      persistence,
      sync: {
        ...options.sync,
        sync: (params) => {
          retainedScopes =
            params.metadata!.collection.list(`queryCollection:gc:`).length
          const capability = params.metadata!.persistence!
          // The capability resolves the managed generation that this run claimed.
          // Diagnostic reads bypass the counter for source reconciliation calls.
          durableRows = async () =>
            sortScopedRows(
              (await capability.scanPersistedRows()).map(
                (row) => row.value as ScopedHydrationRow,
              ),
            )
          return original({
            ...params,
            metadata: {
              ...params.metadata!,
              persistence: {
                ...capability,
                hydrateBaseline: () => {
                  hydrateCalls++
                  return capability.hydrateBaseline()
                },
                scanPersistedRows: (...args) => {
                  scanCalls++
                  return capability.scanPersistedRows(...args)
                },
              },
            },
          })
        },
      },
    }),
  )
  return withOracleCleanup(async () => {
    const firstLoad = Promise.resolve(
      collection._sync.loadSubset(firstDemand),
    ).then(() => {
      const rows = sortScopedRows(collection.values())
      record?.(`first`, rows)
      return rows
    })
    void firstLoad.catch(() => {})
    await untilStartup(() => fetches === 1)
    const pending = sortScopedRows(collection.values())
    record?.(`pending`, pending)
    release()
    const first = await firstLoad
    const firstDurable = await durableRows!()
    record?.(`firstDurable`, firstDurable)
    const second = await Promise.resolve(
      collection._sync.loadSubset(otherDemand),
    ).then(() => {
      const rows = sortScopedRows(collection.values())
      record?.(`second`, rows)
      return rows
    })
    const secondDurable = await durableRows!()
    record?.(`secondDurable`, secondDurable)
    const observed = {
      pending,
      first,
      firstDurable,
      second,
      secondDurable,
      retainedScopes,
      fetches,
      hydrateCalls,
      scanCalls,
    }
    record?.(`completed`, observed)
    return observed
  }, [release, () => collection.cleanup(), () => client.clear()])
}
