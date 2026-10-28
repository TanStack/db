/**
 * Shared fixtures and reference helpers for the Query Collection ownership
 * tests. The ownership law and its checks are owned by
 * ownership-lifecycle.oracle.test.ts, which declares them over these fixtures.
 */

import { QueryClient, hashKey } from '@tanstack/query-core'
import { DbClient, IR, collectionOptions, createCollection } from '@tanstack/db'
import { expect, vi } from 'vitest'

import { createDeferred } from '../../db/src/deferred.js'

import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src/index.js'

import { queryCollectionOptions } from '../src/query.js'
import type {
  Collection,
  LoadSubsetOptions,
  SyncMetadataApi,
} from '@tanstack/db'
import type { QueryFunctionContext } from '@tanstack/query-core'
import type {
  PersistedCacheGenerationClaim,
  PersistenceAdapter,
} from '../../db-sqlite-persistence-core/src/index.js'
import type { NonSingleResult } from '../../db/src/types.js'
import type { QueryCollectionUtils } from '../src/query.js'

export type Item = {
  id: string
  category: string
  name: string
}

export type MutationLifecycleSnapshot = {
  server: Array<string>
  cache: Array<string>
  synced: Array<string>
  source: Array<string>
  derived: Array<string>
}

export type MutationPublicationSnapshot = Pick<
  MutationLifecycleSnapshot,
  `source` | `derived`
> & { expected: Array<string> }

export type MetadataRecorder = {
  rows: Map<string | number, unknown>
  writes: Array<{ type: `set` | `delete`; key: string | number }>
}

export type OwnershipFixtureOptions = {
  id: string
  results: Array<Array<Item> | Promise<Array<Item>>>
  getKey?: (item: Item) => string | number
  syncMode?: `eager` | `on-demand`
  customHash?: boolean
  staleTime?: number
  persistedGcTime?: number
  metadataRecorder?: MetadataRecorder
  setupMetadata?: (metadata: SyncMetadataApi<string | number>) => void
  scanPersistedRows?: () => Promise<
    Array<{ key: string | number; value: Item; metadata?: unknown }>
  >
}

export type OwnershipFixture = {
  collection: Collection<
    Item,
    string | number,
    QueryCollectionUtils<Item, string | number, Item, unknown>,
    never,
    Item
  > &
    NonSingleResult
  queryClient: QueryClient
  queryFn: ReturnType<typeof vi.fn<() => Promise<Array<Item>>>>
}

export const shared = { id: `shared`, category: `shared`, name: `Shared` }

export const detailOnly = { id: `detail`, category: `detail`, name: `Detail` }

export const listOnly = { id: `list`, category: `list`, name: `List` }

// The overlap fixtures return rows from both named categories.
// A literal field name passed to eq() would instead become a constant value.
export const categoryIn = (...categories: Array<string>) =>
  new IR.Func(`in`, [new IR.PropRef([`category`]), new IR.Value(categories)])

export const cleanups: Array<() => Promise<void>> = []

export async function runCleanups(): Promise<void> {
  const results = await Promise.allSettled(
    cleanups.splice(0).map((cleanup) => cleanup()),
  )
  const failures = results.flatMap((result) =>
    result.status === `rejected` ? [result.reason] : [],
  )
  if (failures.length > 0) {
    throw new AggregateError(failures, `Ownership oracle cleanup failed`, {
      cause: failures[0],
    })
  }
}

export function createQueryClient(
  customHash = false,
  staleTime = Number.POSITIVE_INFINITY,
): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Number.POSITIVE_INFINITY,
        retry: false,
        staleTime,
        queryKeyHashFn: customHash
          ? (key) => `custom:${hashKey(key)}`
          : undefined,
      },
    },
  })
}

export function recordMetadata(
  metadata: SyncMetadataApi<string | number>,
  recorder: MetadataRecorder,
): SyncMetadataApi<string | number> {
  // These are emitted writes, captured before delegation, not durable commits.
  return {
    ...metadata,
    row: {
      get: (key) => metadata.row.get(key),
      set: (key, value) => {
        recorder.writes.push({ type: `set`, key })
        recorder.rows.set(key, value)
        metadata.row.set(key, value)
      },
      delete: (key) => {
        recorder.writes.push({ type: `delete`, key })
        recorder.rows.delete(key)
        metadata.row.delete(key)
      },
    },
    collection: {
      get: (key) => metadata.collection.get(key),
      set: (key, value) => metadata.collection.set(key, value),
      delete: (key) => metadata.collection.delete(key),
      list: (prefix) => metadata.collection.list(prefix),
    },
  }
}

/**
 * Diagnosis for a race seen only on CI: the held-cleanup retention witnesses
 * sometimes see no expiry transaction staged. A fixture with a retention
 * time-to-live records each timer that Query DB sets during the test, where
 * it was set, whether it fired, and what cleared it, and each Query fetch. A
 * failed retention wait reports that trace.
 */
type RetentionTrace = {
  started: number
  timers: Array<{
    delay: number
    set: string
    fired?: number
    cleared?: string
  }>
  fetches: Array<string>
}
let retentionTrace: RetentionTrace | undefined

const queryDbCaller = () =>
  (new Error().stack ?? ``)
    .split(`\n`)
    .filter((line) => line.includes(`query-db-collection/src/`))
    .slice(0, 3)
    .map((line) => line.trim().replace(/^at /, ``))
    .join(` < `)

function traceRetentionTimers(): RetentionTrace {
  const trace: RetentionTrace = { started: Date.now(), timers: [], fetches: [] }
  const elapsed = () => `+${Date.now() - trace.started}ms`
  const realSetTimeout = globalThis.setTimeout
  const realClearTimeout = globalThis.clearTimeout
  const traced = new Map<unknown, RetentionTrace[`timers`][number]>()
  const setSpy = vi.spyOn(globalThis, `setTimeout`).mockImplementation(((
    callback: (...args: Array<unknown>) => void,
    delay?: number,
    ...args: Array<unknown>
  ) => {
    const caller = queryDbCaller()
    if (!caller) return realSetTimeout(callback, delay, ...args)
    const timer: RetentionTrace[`timers`][number] = {
      delay: delay ?? 0,
      set: `${elapsed()} ${caller}`,
    }
    trace.timers.push(timer)
    const handle = realSetTimeout(
      (...callbackArgs: Array<unknown>) => {
        timer.fired = Date.now() - trace.started
        callback(...callbackArgs)
      },
      delay,
      ...args,
    )
    traced.set(handle, timer)
    return handle
  }) as typeof setTimeout)
  const clearSpy = vi.spyOn(globalThis, `clearTimeout`).mockImplementation(((
    handle?: Parameters<typeof clearTimeout>[0],
  ) => {
    const timer = traced.get(handle)
    if (timer) timer.cleared = `${elapsed()} ${queryDbCaller()}`
    realClearTimeout(handle)
  }) as typeof clearTimeout)
  retentionTrace = trace
  cleanups.push(() => {
    setSpy.mockRestore()
    clearSpy.mockRestore()
    if (retentionTrace === trace) retentionTrace = undefined
    return Promise.resolve()
  })
  return trace
}

export async function waitForRetention(
  check: () => void,
  options: { timeout: number },
) {
  try {
    await vi.waitFor(check, options)
  } catch (error) {
    const trace = retentionTrace
    const report = trace
      ? [
          `Query DB timers:`,
          ...trace.timers.map((timer) => `  ${JSON.stringify(timer)}`),
          `Query fetches: ${JSON.stringify(trace.fetches)}`,
        ].join(`\n`)
      : `no retention trace`
    if (error instanceof Error) error.message = `${error.message}\n${report}`
    throw error
  }
}

export function createOwnershipFixture({
  id,
  results,
  getKey = (item) => item.id,
  syncMode = `on-demand`,
  metadataRecorder,
  setupMetadata,
  scanPersistedRows,
  customHash,
  staleTime,
  persistedGcTime,
}: OwnershipFixtureOptions): OwnershipFixture {
  const queryClient = createQueryClient(customHash, staleTime)
  const trace =
    persistedGcTime === undefined ? undefined : traceRetentionTimers()
  const queryFn = vi.fn<() => Promise<Array<Item>>>()
  results.forEach((result, index) =>
    queryFn.mockImplementationOnce(() => {
      trace?.fetches.push(`+${Date.now() - trace.started}ms result ${index}`)
      return Promise.resolve(result)
    }),
  )
  queryFn.mockImplementation(() => {
    trace?.fetches.push(`+${Date.now() - trace.started}ms unexpected`)
    return Promise.reject(new Error(`Unexpected ownership refetch`))
  })
  const baseOptions = queryCollectionOptions<Item>({
    id,
    queryClient,
    queryKey: [id],
    queryFn,
    getKey,
    syncMode,
    startSync: true,
    persistedGcTime,
  })
  const originalSync = baseOptions.sync
  let pendingSetup = setupMetadata
  const collection = createCollection(
    metadataRecorder || setupMetadata || scanPersistedRows
      ? {
          ...baseOptions,
          sync: {
            sync: (params: Parameters<typeof originalSync.sync>[0]) => {
              if (!params.metadata) {
                throw new Error(`Sync metadata API is unavailable`)
              }
              const observedMetadata = metadataRecorder
                ? recordMetadata(params.metadata, metadataRecorder)
                : params.metadata
              const metadataWithPersistedScan: SyncMetadataApi<
                string | number
              > = scanPersistedRows
                ? {
                    ...observedMetadata,
                    persistence: {
                      protocol: `@tanstack/db/sync-persistence`,
                      version: 1,
                      hydrateBaseline: async () => {},
                      reserveCommitTurn: () => {},
                      scanPersistedRows,
                      resumeSnapshot: {
                        certify: async () => {},
                        getKeySetEvidence: () => ({ status: `consistent` }),
                        expectCurrentCommit: () => {},
                      },
                    },
                  }
                : observedMetadata
              if (pendingSetup) {
                params.begin()
                pendingSetup(metadataWithPersistedScan)
                params.commit()
                pendingSetup = undefined
              }
              return originalSync.sync({
                ...params,
                metadata: metadataWithPersistedScan,
              })
            },
          },
        }
      : baseOptions,
  )
  cleanups.push(async () => {
    await collection.cleanup()
    queryClient.clear()
  })
  return { collection, queryClient, queryFn }
}

export function rows(collection: {
  keys: () => Iterable<string | number>
}): Array<string> {
  return Array.from(collection.keys()).map(String).sort()
}

export function itemIds(items: Iterable<Item>): Array<string> {
  return Array.from(items, ({ id }) => id).sort()
}

export function expectMutationLifecycleSnapshot(
  snapshot: MutationLifecycleSnapshot,
  authoritative: ReadonlyArray<string>,
  visible: ReadonlyArray<string>,
  ordered: boolean,
): void {
  expect(snapshot).toEqual({
    server: [...authoritative].sort(),
    cache: [...authoritative].sort(),
    synced: [...authoritative].sort(),
    source: [...visible].sort(),
    derived: ordered ? [...visible] : [...visible].sort(),
  })
}

export function expectMutationPublicationIntegrity(
  publications: ReadonlyArray<MutationPublicationSnapshot>,
): void {
  for (const publication of publications) {
    expect(publication).toEqual({
      source: publication.expected,
      derived: publication.expected,
      expected: publication.expected,
    })
  }
}

export function persistedOwners(
  metadata: ReadonlyMap<string | number, unknown>,
  rowId: string,
): Array<string> {
  const rowMetadata = metadata.get(rowId)
  if (!rowMetadata || typeof rowMetadata !== `object`) return []
  const queryCollection = (rowMetadata as Record<string, unknown>)
    .queryCollection
  if (!queryCollection || typeof queryCollection !== `object`) return []
  const owners = (queryCollection as Record<string, unknown>).owners
  return owners && typeof owners === `object` ? Object.keys(owners).sort() : []
}

// Reads a row's published metadata through the public dehydrate boundary of a
// DbClient. Owner keys are opaque, so owners are counted, not named. The seed's
// non-owner field `user` is read by name, and absence is `undefined`.
export function publishedRowMetadata(
  client: DbClient,
  rowId: string,
): { user: unknown; owners: number } {
  const metadata = client
    .dehydrate({ shouldDehydrateCollection: () => true })
    .collections.flatMap((chunk) => chunk.rows)
    .find((row) => row.key === rowId)?.metadata
  return {
    user: (metadata as Record<string, unknown> | undefined)?.user,
    owners: persistedOwners(new Map([[rowId, metadata]]), rowId).length,
  }
}

// A DbClient over one on-demand Query collection whose every fetch returns
// `shared`. A hydration check builds a server and a browser client from it, so
// a browser release reads only the owners that the dehydrated state recorded.
export function createSharedRowClient(id: string, persistedGcTime?: number) {
  const queryClient = createQueryClient()
  const descriptor = collectionOptions(
    queryCollectionOptions<Item>({
      id,
      queryClient,
      queryKey: [id],
      queryFn: () => Promise.resolve([shared]),
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      persistedGcTime,
      startSync: true,
    }),
  )
  return { client: new DbClient({ queryClient }), queryClient, descriptor }
}

export type StoredOwnership = {
  rows: Map<string | number, Item>
  rowMetadata: Map<string | number, unknown>
  collectionMetadata: Map<string, unknown>
}

export function categorySubset(
  category: `detail` | `list` | `peer`,
): LoadSubsetOptions {
  return {
    where: new IR.Func(`in`, [
      new IR.PropRef([`category`]),
      new IR.Value([`shared`, category]),
    ]),
  }
}

export function selectOwnershipRows(
  items: Iterable<Item>,
  options: LoadSubsetOptions,
): Array<Item> {
  if (
    options.orderBy !== undefined ||
    options.limit !== undefined ||
    options.offset !== undefined ||
    options.cursor !== undefined
  ) {
    throw new Error(`Ownership fixture does not support ordering or windows`)
  }
  const { where } = options
  if (!where) return Array.from(items, (item) => structuredClone(item))
  if (
    where.type !== `func` ||
    where.name !== `in` ||
    where.args.length !== 2 ||
    where.args[0]?.type !== `ref` ||
    where.args[0].path.length !== 1 ||
    where.args[0].path[0] !== `category` ||
    where.args[1]?.type !== `val` ||
    !Array.isArray(where.args[1].value) ||
    !where.args[1].value.every((value: unknown) => typeof value === `string`)
  ) {
    throw new Error(`Ownership fixture supports only category membership`)
  }
  const categories = new Set<string>(where.args[1].value)
  return Array.from(items)
    .filter((item) => categories.has(item.category))
    .map((item) => structuredClone(item))
}

export function createOwnershipStorage(
  seed?: StoredOwnership,
  gatedCommit?: number,
) {
  const state: StoredOwnership = structuredClone(
    seed ?? {
      rows: new Map(),
      rowMetadata: new Map(),
      collectionMetadata: new Map(),
    },
  )
  const entered = createDeferred<void>()
  const released = createDeferred<void>()
  let commitCount = 0
  let latestTerm = 0
  let latestSeq = 0
  let latestRowVersion = 0
  const adapter: PersistenceAdapter = {
    loadSubset: (_id, options) =>
      Promise.resolve(
        selectOwnershipRows(state.rows.values(), options).map((value) => ({
          key: value.id,
          value,
          metadata: structuredClone(state.rowMetadata.get(value.id)),
        })),
      ),
    loadResumeSnapshot: (_id, options) =>
      Promise.resolve({
        rows:
          options?.includeRows === false
            ? []
            : Array.from(state.rows, ([key, value]) => ({
                key,
                value: structuredClone(value),
                metadata: structuredClone(state.rowMetadata.get(key)),
              })),
        keySet: { status: `consistent` },
        collectionMetadata: Array.from(
          state.collectionMetadata,
          ([key, value]) => ({ key, value: structuredClone(value) }),
        ),
        latestTerm,
        latestSeq,
        latestRowVersion,
        resetEpoch: 0,
      }),
    loadCollectionMetadata: () =>
      Promise.resolve(
        Array.from(state.collectionMetadata, ([key, value]) => ({
          key,
          value: structuredClone(value),
        })),
      ),
    scanRows: () =>
      Promise.resolve(
        Array.from(state.rows, ([key, value]) => ({
          key,
          value: structuredClone(value),
          metadata: structuredClone(state.rowMetadata.get(key)),
        })),
      ),
    ensureIndex: () => Promise.resolve(),
    applyCommittedTx: async (_id, transaction) => {
      const tx = structuredClone(transaction)
      commitCount++
      if (commitCount === gatedCommit) {
        entered.resolve()
        await released.promise
      }
      if (tx.truncate) {
        state.rows.clear()
        state.rowMetadata.clear()
      }
      for (const mutation of tx.mutations) {
        if (mutation.type === `delete`) {
          state.rows.delete(mutation.key)
          state.rowMetadata.delete(mutation.key)
        } else {
          const { id, category, name } = mutation.value
          if (
            typeof id !== `string` ||
            typeof category !== `string` ||
            typeof name !== `string`
          ) {
            throw new Error(`Ownership fixture received an invalid row`)
          }
          state.rows.set(mutation.key, { id, category, name })
          if (mutation.metadataChanged) {
            state.rowMetadata.set(
              mutation.key,
              structuredClone(mutation.metadata),
            )
          }
        }
      }
      for (const mutation of tx.rowMetadataMutations ?? []) {
        if (mutation.type === `delete`) state.rowMetadata.delete(mutation.key)
        else
          state.rowMetadata.set(mutation.key, structuredClone(mutation.value))
      }
      for (const mutation of tx.collectionMetadataMutations ?? []) {
        if (mutation.type === `delete`)
          state.collectionMetadata.delete(mutation.key)
        else
          state.collectionMetadata.set(
            mutation.key,
            structuredClone(mutation.value),
          )
      }
      latestTerm = tx.term
      latestSeq = tx.seq
      latestRowVersion = tx.rowVersion
    },
  }
  return {
    adapter,
    entered: entered.promise,
    release: () => released.resolve(),
    snapshot: (): StoredOwnership => structuredClone(state),
  }
}

export function createPersistedOwnershipFixture(
  id: string,
  storage: ReturnType<typeof createOwnershipStorage>,
  serverRows: Array<Item>,
  syncMode: `eager` | `on-demand` = `on-demand`,
) {
  const queryClient = createQueryClient()
  const providerRows = structuredClone(serverRows)
  const queryFn = vi.fn((context: QueryFunctionContext) =>
    Promise.resolve(
      selectOwnershipRows(providerRows, context.meta?.loadSubsetOptions ?? {}),
    ),
  )
  const collection = createCollection(
    persistedCollectionOptions<
      Item,
      string | number,
      never,
      QueryCollectionUtils<Item, string | number, Item, unknown>
    >({
      ...queryCollectionOptions<Item>({
        id,
        queryClient,
        queryKey: [id],
        queryFn,
        getKey: (item) => item.id,
        syncMode,
        persistedGcTime: Number.POSITIVE_INFINITY,
        startSync: true,
      }),
      persistence: { adapter: storage.adapter },
    }),
  )
  cleanups.push(async () => {
    storage.release()
    try {
      await collection.cleanup()
    } finally {
      queryClient.clear()
    }
  })
  return { collection, queryClient, queryFn }
}

export function storedItems(
  storage: ReturnType<typeof createOwnershipStorage>,
): Array<Item> {
  return [...storage.snapshot().rows.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  )
}

// The direct-write receipt follows the applied commit, regardless of whether
// the Query Collection already exposes the new row in memory.
export function expectedDirectWriteReceipt(applied: boolean) {
  return {
    receipt: applied ? `fulfilled` : `pending`,
    storedName: applied ? `Updated` : shared.name,
  }
}

// A direct write can apply only in the current sync run. Cleanup start closes
// that admission; restart creates a new current run.
export function expectedDirectWriteAdmission(
  syncRun: `current` | `invalidated`,
) {
  return syncRun === `current` ? `fulfilled` : `rejected`
}

export type ColdOwnershipObservation = {
  stored: Array<Item>
  visible: Array<Item>
}

export async function observeColdOwnerRevalidation(
  dropMetadata = false,
): Promise<Array<ColdOwnershipObservation>> {
  const hotStorage = createOwnershipStorage(undefined, 1)
  const hot = createPersistedOwnershipFixture(
    `cold-owner-revalidation`,
    hotStorage,
    [shared, detailOnly, listOnly],
  )
  const detail = categorySubset(`detail`)
  const list = categorySubset(`list`)
  const firstLoad = Promise.resolve(hot.collection._sync.loadSubset(detail))
  // Observe rejection before any gate assertion can abort the test.
  void firstLoad.catch(() => undefined)
  try {
    await hotStorage.entered
    expect(hotStorage.snapshot().rows.size).toBe(0)
    expect(hotStorage.snapshot().rowMetadata.size).toBe(0)
    hotStorage.release()
    await firstLoad
    await hot.collection._sync.loadSubset(list)
    await vi.waitFor(() =>
      expect(storedItems(hotStorage)).toEqual([detailOnly, listOnly, shared]),
    )
    hot.collection._sync.unloadSubset(detail)
    hot.collection._sync.unloadSubset(list)
    // Both retention markers must commit before making a separate cold store.
    // Their private hash encoding is not the expected ownership authority.
    await vi.waitFor(() =>
      expect(hotStorage.snapshot().collectionMetadata.size).toBe(2),
    )
    const coldSeed = hotStorage.snapshot()
    if (dropMetadata) coldSeed.rowMetadata.clear()
    const coldStorage = createOwnershipStorage(coldSeed)
    const cold = createPersistedOwnershipFixture(
      `cold-owner-revalidation`,
      coldStorage,
      [],
    )
    expect(cold.queryFn).not.toHaveBeenCalled()
    const capture = (): ColdOwnershipObservation => ({
      stored: storedItems(coldStorage),
      visible: cold.collection.toArray
        .map(({ id, category, name }) => ({ id, category, name }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    })
    const observations = [capture()]
    await cold.collection._sync.loadSubset(detail)
    await vi.waitFor(() =>
      expect(coldStorage.snapshot().collectionMetadata.size).toBe(1),
    )
    observations.push(capture())
    await cold.collection._sync.loadSubset(list)
    await vi.waitFor(() =>
      expect(coldStorage.snapshot().collectionMetadata.size).toBe(0),
    )
    observations.push(capture())
    expect(cold.queryFn).toHaveBeenCalledTimes(2)
    return observations
  } finally {
    hotStorage.release()
  }
}

export function expectColdOwnerRevalidation(
  observations: Array<ColdOwnershipObservation>,
): void {
  expect(observations).toEqual([
    { stored: [detailOnly, listOnly, shared], visible: [] },
    { stored: [listOnly, shared], visible: [shared] },
    { stored: [], visible: [] },
  ])
}

// The recorder follows the tested sync run's persisted cache claim across
// rotation. An expired run may own a new retired generation while another run
// still claims the active head, so claiming the logical ID here would inspect
// the wrong cache. The durable comparison reads the physical ID in this run's
// latest claim, without releasing its authority.
export function recordRunCacheClaim(
  adapter: PersistenceAdapter,
): () => PersistedCacheGenerationClaim {
  const claimCacheGeneration = adapter.claimCacheGeneration?.bind(adapter)
  const rotateCacheGeneration = adapter.rotateCacheGeneration?.bind(adapter)
  if (!claimCacheGeneration || !rotateCacheGeneration) {
    throw new Error(`Expected managed SQLite cache generations`)
  }
  let current: PersistedCacheGenerationClaim | undefined
  adapter.claimCacheGeneration = async (...args) => {
    current = await claimCacheGeneration(...args)
    return current
  }
  adapter.rotateCacheGeneration = async (...args) => {
    current = await rotateCacheGeneration(...args)
    return current
  }
  return () => {
    if (!current) throw new Error(`Expected a claimed cache generation`)
    return current
  }
}

export async function readClaimedCacheRows(
  adapter: PersistenceAdapter,
  claim: PersistedCacheGenerationClaim,
): Promise<Array<{ key: string | number; name: unknown }>> {
  const persistedRows = await adapter.loadSubset(
    {
      kind: `managed`,
      storageCollectionId: claim.storageCollectionId,
      claimId: claim.claimId,
    },
    {},
    {
      cacheGenerationClaimId: claim.claimId,
    },
  )
  return persistedRows
    .map((row) => ({ key: row.key, name: row.value.name }))
    .sort((a, b) => String(a.key).localeCompare(String(b.key)))
}

/**
 * The Query failure a Collection reports: its failed first load while it is
 * in `error`, or the cause of its failure reason after readiness.
 */
export function reportedError(collection: {
  status: string
  health: {
    failureReason: { cause: unknown } | null
    error: { cause: unknown } | null
  }
  _lifecycle: { getSyncError: () => unknown }
}): unknown {
  return collection.status === `error`
    ? collection._lifecycle.getSyncError()
    : (collection.health.failureReason ?? collection.health.error)?.cause
}
