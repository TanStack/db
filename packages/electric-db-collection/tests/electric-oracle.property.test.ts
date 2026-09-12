import { isDeepStrictEqual } from 'node:util'
import { fc, test as fcTest } from '@fast-check/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IR, createCollection, createTransaction } from '@tanstack/db'
import { ShapeStream } from '@electric-sql/client'
import { QueryClient } from '@tanstack/query-core'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { queryCollectionOptions } from '../../query-db-collection/src/query'
import { electricCollectionOptions } from '../src/electric'
import { oraclePropertyOptions, oracleRuns } from '../../db/tests/oracle-config'
import type { Collection, SyncMetadataApi } from '@tanstack/db'
import type { ChangeMessage, Message, Offset, Row } from '@electric-sql/client'
import type {
  PersistedTx,
  PersistenceAdapter,
} from '../../db-sqlite-persistence-core/src'
import type { ElectricCollectionUtils, ElectricSyncMode } from '../src/electric'

type OracleRow = Row & {
  id: number
  name: string
  stable: string
}

const mockSubscribe = vi.fn()
const shapeId = `{"params":{"table":"test_table"},"url":"http://test-url"}`
const mockStream = {
  subscribe: mockSubscribe,
  requestSnapshot: vi.fn().mockResolvedValue(undefined),
  fetchSnapshot: vi.fn().mockResolvedValue({ metadata: {}, data: [] }),
  forceDisconnectAndRefresh: vi.fn().mockResolvedValue(undefined),
  isUpToDate: false,
  shapeHandle: undefined as string | undefined,
  lastOffset: `-1` as string,
}

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

vi.mock(`@electric-sql/client`, async () => {
  const actual = await vi.importActual(`@electric-sql/client`)
  return {
    ...actual,
    ShapeStream: vi.fn(() => mockStream),
  }
})

function everyContiguousPartition<T>(values: Array<T>): Array<Array<Array<T>>> {
  if (values.length === 0) return [[]]
  const partitions: Array<Array<Array<T>>> = []
  const boundaryCount = values.length - 1
  for (let mask = 0; mask < 1 << boundaryCount; mask++) {
    const batches: Array<Array<T>> = [[values[0]!]]
    for (let index = 1; index < values.length; index++) {
      if ((mask & (1 << (index - 1))) !== 0) {
        batches.push([values[index]!])
      } else {
        batches.at(-1)!.push(values[index]!)
      }
    }
    partitions.push(batches)
  }
  return partitions
}

function isSdkResetFramedPartition(
  batches: Array<Array<Message<OracleRow>>>,
): boolean {
  // Model the installed SDK's HTTP 409 reset path: it publishes a synthetic
  // singleton reset, not the response body. See electric-sdk-framing.test.ts.
  // Arbitrary data/reset coalescing is outside this verified protocol domain;
  // this is not a claim that the SDK validates every other server response.
  return batches.every(
    (batch) =>
      batch.length <= 1 ||
      batch.every(
        (message) =>
          (message.headers as Record<string, unknown>).control !==
          `must-refetch`,
      ),
  )
}

function createMetadata(seed: ReadonlyMap<string, unknown>): {
  api: SyncMetadataApi<string | number>
  state: Map<string, unknown>
} {
  const state = new Map(seed)
  return {
    state,
    api: {
      row: {
        get: () => undefined,
        set: () => {},
        delete: () => {},
      },
      collection: {
        get: (key) => state.get(key),
        set: (key, value) => {
          state.set(key, value)
        },
        delete: (key) => {
          state.delete(key)
        },
        list: (prefix) =>
          Array.from(state, ([key, value]) => ({ key, value })).filter(
            ({ key }) => !prefix || key.startsWith(prefix),
          ),
      },
    },
  }
}

function resumeState(): ReadonlyMap<string, unknown> {
  // This fixture represents an untagged source. Legacy/unknown membership is
  // exercised separately by the cold-recovery history generator.
  return new Map([
    [
      `electric:resume`,
      {
        kind: `resume`,
        requiresTagState: false,
        offset: `10_0`,
        handle: `shape-1`,
        shapeId,
        updatedAt: 1,
      },
    ],
  ])
}

function createPersistedAdapter(
  collectionMetadata: Map<string, unknown>,
  rows: Map<string | number, OracleRow>,
  loadGate: Promise<void> = Promise.resolve(),
): PersistenceAdapter {
  return {
    loadSubset: () =>
      loadGate.then(() =>
        Array.from(rows, ([key, value]) => ({
          key,
          value: structuredClone(value),
        })),
      ),
    loadCollectionMetadata: () =>
      Promise.resolve(
        Array.from(collectionMetadata, ([key, value]) => ({
          key,
          value: structuredClone(value),
        })),
      ),
    applyCommittedTx: (_collectionId: string, tx: PersistedTx) => {
      for (const mutation of tx.collectionMetadataMutations ?? []) {
        if (mutation.type === `delete`) {
          collectionMetadata.delete(mutation.key)
        } else {
          collectionMetadata.set(mutation.key, structuredClone(mutation.value))
        }
      }
      if (tx.truncate) rows.clear()
      for (const mutation of tx.mutations) {
        if (mutation.type === `delete`) {
          rows.delete(mutation.key)
        } else if (mutation.type === `update`) {
          rows.set(mutation.key, {
            ...rows.get(mutation.key),
            ...structuredClone(mutation.value),
          } as OracleRow)
        } else {
          rows.set(mutation.key, structuredClone(mutation.value) as OracleRow)
        }
      }
      return Promise.resolve()
    },
    ensureIndex: () => Promise.resolve(),
  }
}

function createOracleCollection(
  id: string,
  syncMode: ElectricSyncMode,
  metadata: SyncMetadataApi<string | number>,
  shapeResumeOptions: { offset?: Offset; handle?: string } = {},
) {
  let subscriber!: (messages: Array<Message<OracleRow>>) => void
  const unsubscribe = vi.fn()
  mockSubscribe.mockImplementationOnce((callback) => {
    subscriber = callback
    return unsubscribe
  })
  const options = electricCollectionOptions<OracleRow>({
    id,
    shapeOptions: {
      url: `http://test-url`,
      params: { table: `test_table` },
      ...shapeResumeOptions,
    },
    syncMode,
    getKey: (row) => row.id,
    startSync: true,
  })
  const originalSync = options.sync
  return {
    collection: createCollection({
      ...options,
      sync: {
        sync: (params: Parameters<typeof originalSync.sync>[0]) =>
          originalSync.sync({ ...params, metadata }),
      },
    }),
    subscriber,
    unsubscribe,
  }
}

type TraceResult = {
  rows: Array<[string | number, string, string]>
  snapshots: Array<Array<[string | number, string, string]>>
  status: string
  resume: unknown
}

type PersistedTraceResult = TraceResult & {
  durableRows: Array<[string | number, string, string]>
  durableResume: unknown
  persistenceCommits: number
}

type ReferenceState = {
  committed: Map<number, OracleRow>
  pending: Map<number, OracleRow>
}

function rowsFromCollection(
  collection: Collection<OracleRow, string | number>,
): Array<[string | number, string, string]> {
  return Array.from(
    collection,
    ([key, row]): [string | number, string, string] => [
      key,
      row.name,
      row.stable,
    ],
  ).sort(([left], [right]) => String(left).localeCompare(String(right)))
}

function rowsFromMap(
  rows: ReadonlyMap<string | number, OracleRow>,
): Array<[string | number, string, string]> {
  return Array.from(rows, ([key, row]): [string | number, string, string] => [
    key,
    row.name,
    row.stable,
  ]).sort(([left], [right]) => String(left).localeCompare(String(right)))
}

function applyReferenceBatch(
  state: ReferenceState,
  batch: ReadonlyArray<Message<OracleRow>>,
): boolean {
  let commits = false
  for (const message of batch) {
    const headers = message.headers as Record<string, unknown>
    const control = headers.control
    if (typeof control === `string`) {
      if (control === `must-refetch`) {
        state.pending.clear()
      }
      if (control === `up-to-date` || control === `subset-end`) commits = true
      continue
    }
    if (!(`value` in message)) continue
    const value = message.value
    const id = value.id
    if (headers.operation === `delete`) {
      state.pending.delete(id)
    } else if (headers.operation === `insert`) {
      state.pending.set(id, value)
    } else {
      const current = state.pending.get(id)
      if (current) {
        state.pending.set(id, { ...current, ...value } as OracleRow)
      }
    }
  }
  if (commits) state.committed = new Map(state.pending)
  return commits
}

function expectedSnapshots(
  prefix: Array<Array<Message<OracleRow>>>,
  batches: Array<Array<Message<OracleRow>>>,
): Array<Array<[string | number, string, string]>> {
  const state: ReferenceState = {
    committed: new Map(),
    pending: new Map(),
  }
  const observed: Array<Array<[string | number, string, string]>> = []
  for (const batch of prefix) applyReferenceBatch(state, batch)
  for (const batch of batches) {
    applyReferenceBatch(state, batch)
    observed.push(rowsFromMap(state.committed))
  }
  return observed
}

function recomputeCommittedRows(
  batches: ReadonlyArray<ReadonlyArray<Message<OracleRow>>>,
  unknownUpdate: `ignore` | `promote-complete` = `ignore`,
): Array<[string | number, string, string]> {
  let commitBatchIndex = -1
  for (let index = 0; index < batches.length; index++) {
    const commits = batches[index]!.some((message) => {
      const control = (message.headers as Record<string, unknown>).control
      return control === `up-to-date` || control === `subset-end`
    })
    if (commits) commitBatchIndex = index
  }
  if (commitBatchIndex < 0) return []

  // A control message commits its entire callback, including messages that
  // happen to follow the control inside that atomic delivery.
  const committedPrefix = batches.slice(0, commitBatchIndex + 1).flat()
  let resetIndex = -1
  for (let index = 0; index < committedPrefix.length; index++) {
    if (
      (committedPrefix[index]!.headers as Record<string, unknown>).control ===
      `must-refetch`
    ) {
      resetIndex = index
    }
  }

  const rows = new Map<number, OracleRow>()
  for (const message of committedPrefix.slice(resetIndex + 1)) {
    if (!(`value` in message)) continue
    const headers = message.headers as Record<string, unknown>
    const value = message.value
    if (headers.operation === `delete`) {
      rows.delete(value.id)
    } else if (headers.operation === `insert`) {
      rows.set(value.id, value)
    } else {
      const current = rows.get(value.id)
      if (current) {
        rows.set(value.id, { ...current, ...value } as OracleRow)
      } else if (
        unknownUpdate === `promote-complete` &&
        typeof value.name === `string` &&
        typeof value.stable === `string`
      ) {
        rows.set(value.id, value)
      }
    }
  }
  return rowsFromMap(rows)
}

function recomputedSnapshots(
  prefix: Array<Array<Message<OracleRow>>>,
  batches: Array<Array<Message<OracleRow>>>,
): Array<Array<[string | number, string, string]>> {
  const history = [...prefix]
  return batches.map((batch) => {
    history.push(batch)
    return recomputeCommittedRows(history)
  })
}

function observableResume(value: unknown): unknown {
  if (value === null || typeof value !== `object`) return value
  const state = value as Record<string, unknown>
  return {
    kind: state.kind,
    offset: state.offset,
    handle: state.handle,
    shapeId: state.shapeId,
  }
}

type Publication = { cut: string; rows: TraceResult[`rows`] }

function observePublications(
  collection: Collection<OracleRow, string | number>,
) {
  const entries: Array<Publication> = []
  const record = (cut: string) => {
    entries.push({ cut, rows: structuredClone(rowsFromCollection(collection)) })
  }
  const subscription = collection.subscribeChanges(() => record(`event`), {
    includeInitialState: false,
  })
  return { entries, record, stop: () => subscription.unsubscribe() }
}

function expectWholePublications(
  entries: Array<Publication>,
  allowed: Array<TraceResult[`rows`]>,
) {
  let position = 0
  for (const entry of entries) {
    while (
      position < allowed.length &&
      !isDeepStrictEqual(entry.rows, allowed[position])
    )
      position++
    expect(position, JSON.stringify({ entry, allowed, entries })).toBeLessThan(
      allowed.length,
    )
  }
}

async function runTrace(
  id: string,
  syncMode: ElectricSyncMode,
  prefix: Array<Array<Message<OracleRow>>>,
  batches: Array<Array<Message<OracleRow>>>,
  seed: ReadonlyMap<string, unknown> = new Map(),
): Promise<TraceResult> {
  const metadata = createMetadata(seed)
  const { collection, subscriber } = createOracleCollection(
    id,
    syncMode,
    metadata.api,
  )
  for (const batch of prefix) subscriber(batch)
  const snapshots: Array<Array<[string | number, string, string]>> = []
  for (const batch of batches) {
    subscriber(batch)
    snapshots.push(rowsFromCollection(collection))
  }
  const rows = rowsFromCollection(collection)
  const result = {
    rows,
    snapshots,
    status: collection.status,
    resume: observableResume(metadata.state.get(`electric:resume`)),
  }
  await collection.cleanup()
  return result
}

async function runPersistedTrace(
  id: string,
  syncMode: ElectricSyncMode,
  batches: Array<Array<Message<OracleRow>>>,
  authoredSnapshots?: TraceResult[`snapshots`],
): Promise<PersistedTraceResult> {
  let subscriber!: (messages: Array<Message<OracleRow>>) => void
  mockSubscribe.mockImplementationOnce((callback) => {
    subscriber = callback
    return vi.fn()
  })
  const persistedRows = new Map<string | number, OracleRow>()
  const persistedMetadata = new Map<string, unknown>()
  const adapter = createPersistedAdapter(persistedMetadata, persistedRows)
  const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
  let persistenceCommits = 0
  adapter.applyCommittedTx = (...args) => {
    persistenceCommits++
    return applyCommittedTx(...args)
  }
  const collection = createCollection(
    persistedCollectionOptions<
      OracleRow,
      string | number,
      never,
      ElectricCollectionUtils<OracleRow>
    >({
      ...electricCollectionOptions<OracleRow>({
        id,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode,
        getKey: (row) => row.id,
        startSync: true,
      }),
      persistence: {
        adapter,
      },
    }),
  )
  collection.startSyncImmediate()
  const publications = observePublications(collection)
  try {
    publications.record(`before empty-cache startup`)
    await vi.waitFor(() => expect(subscriber).toBeTypeOf(`function`), {
      interval: 1,
      timeout: 250,
    })
    publications.record(`stream subscribed`)
    expectWholePublications(publications.entries, [[]])

    const snapshots: Array<Array<[string | number, string, string]>> = []
    const history: Array<Array<Message<OracleRow>>> = []
    for (const batch of batches) {
      const cut = publications.entries.length
      const before = rowsFromCollection(collection)
      publications.record(`before delivery ${history.length}`)
      history.push(structuredClone(batch))
      const expected =
        authoredSnapshots?.[history.length - 1] ??
        recomputeCommittedRows(history)
      subscriber(structuredClone(batch))
      publications.record(`after delivery ${history.length - 1}`)
      await vi.waitFor(
        () =>
          expect(
            rowsFromCollection(collection),
            `${syncMode}: ${JSON.stringify(history)}`,
          ).toEqual(expected),
        { interval: 1, timeout: 250 },
      )
      publications.record(`settled ${history.length - 1}`)
      expectWholePublications(publications.entries.slice(cut), [
        before,
        expected,
      ])
      snapshots.push(rowsFromCollection(collection))
    }
    const durabilityCut = publications.entries.length
    await vi.waitFor(() => expect(collection.status).toBe(`ready`), {
      interval: 1,
      timeout: 250,
    })
    const exported = collection.config.sync.exportSyncMeta?.() as
      | { resume?: unknown }
      | undefined
    await vi.waitFor(
      () => {
        expect(persistenceCommits).toBeGreaterThan(0)
        expect(rowsFromMap(persistedRows)).toEqual(
          rowsFromCollection(collection),
        )
      },
      { interval: 1, timeout: 250 },
    )
    publications.record(`durability settled`)
    expectWholePublications(publications.entries.slice(durabilityCut), [
      snapshots.at(-1) ?? [],
    ])
    const result = {
      rows: rowsFromCollection(collection),
      snapshots,
      status: collection.status,
      resume: observableResume(exported?.resume),
      durableRows: rowsFromMap(persistedRows),
      durableResume: observableResume(persistedMetadata.get(`electric:resume`)),
      persistenceCommits,
    }
    return result
  } finally {
    publications.stop()
    await collection.cleanup()
  }
}

async function runQueryTrace(
  id: string,
  batches: Array<Array<Message<OracleRow>>>,
  authoredSnapshots?: TraceResult[`snapshots`],
): Promise<TraceResult> {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Number.POSITIVE_INFINITY,
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  })
  const queryKey = [id] as const
  let queryRows: Array<OracleRow> = []
  const collection = createCollection(
    queryCollectionOptions<OracleRow>({
      id,
      queryClient,
      queryKey,
      queryFn: () => Promise.resolve(queryRows),
      getKey: (row) => row.id,
      startSync: true,
    }),
  )
  const publications = observePublications(collection)
  try {
    publications.record(`before empty Query preload`)
    await collection.preload()
    publications.record(`empty Query ready`)
    expectWholePublications(publications.entries, [[]])

    const snapshots: TraceResult[`snapshots`] = []
    const history: Array<Array<Message<OracleRow>>> = []
    for (const batch of batches) {
      const cut = publications.entries.length
      const before = rowsFromCollection(collection)
      publications.record(`before query snapshot ${history.length}`)
      history.push(batch)
      const commits = batch.some((message) => {
        const control = (message.headers as Record<string, unknown>).control
        return control === `up-to-date` || control === `subset-end`
      })
      if (commits) {
        // Without explicit authored snapshots this is a model-fed Query
        // projection control, not an independent Electric protocol authority.
        queryRows = (
          authoredSnapshots?.[history.length - 1] ??
          recomputeCommittedRows(history)
        ).map(([rowId, name, stable]) => ({
          id: Number(rowId),
          name,
          stable,
        }))
        queryClient.setQueryData(queryKey, queryRows)
        publications.record(`after query delivery ${history.length - 1}`)
        await vi.waitFor(
          () => {
            expect(rowsFromCollection(collection)).toEqual(
              queryRows.map((row): [number, string, string] => [
                row.id,
                row.name,
                row.stable,
              ]),
            )
          },
          { interval: 1, timeout: 250 },
        )
      }
      publications.record(`settled query snapshot ${history.length - 1}`)
      expectWholePublications(publications.entries.slice(cut), [
        before,
        queryRows.map((row) => [row.id, row.name, row.stable]),
      ])
      snapshots.push(rowsFromCollection(collection))
    }

    const result: TraceResult = {
      rows: rowsFromCollection(collection),
      snapshots,
      status: collection.status,
      resume: undefined,
    }
    return result
  } finally {
    publications.stop()
    await collection.cleanup()
    queryClient.clear()
  }
}

function change(
  operation: `insert` | `update` | `delete`,
  id: number,
  name: string,
): ChangeMessage<OracleRow> {
  const value =
    operation === `insert`
      ? { id, name, stable: `stable-${id}` }
      : operation === `update`
        ? { id, name }
        : { id }
  return {
    key: String(id),
    value: value as OracleRow,
    headers: { operation },
  }
}

const upToDate: Message<OracleRow> = {
  headers: { control: `up-to-date` },
}
const subsetEnd: Message<OracleRow> = {
  headers: { control: `subset-end` },
}
const mustRefetch: Message<OracleRow> = {
  headers: { control: `must-refetch` },
}

async function checkInitialMoveOut(
  syncMode: ElectricSyncMode,
  removals: number,
  id: number,
  updated: string,
) {
  const inserted = change(`insert`, id, `snapshot`)
  const initial: Array<Message<OracleRow>> = [
    { ...inserted, headers: { ...inserted.headers, tags: [`left`] } },
    ...Array.from(
      { length: removals },
      () =>
        ({
          headers: {
            event: `move-out`,
            patterns: [{ pos: 0, value: `left` }],
          },
        }) as Message<OracleRow>,
    ),
    upToDate,
  ]
  // The contract is a tagged relation: removing its only tag removes the row.
  // Completing that snapshot must not affect later, unrelated live updates.
  const initialRows: TraceResult[`rows`] =
    removals === 0 ? [[id, `snapshot`, `stable-${id}`]] : []
  for (const partition of everyContiguousPartition(initial)) {
    const result = await runTrace(
      `initial-move-out-${syncMode}`,
      syncMode,
      partition,
      [
        [change(`insert`, id + 1, `live`), upToDate],
        [change(`update`, id + 1, updated), upToDate],
      ],
    )
    expect(result.snapshots).toEqual([
      [...initialRows, [id + 1, `live`, `stable-${id + 1}`]].sort(
        ([left], [right]) => String(left).localeCompare(String(right)),
      ),
      [...initialRows, [id + 1, updated, `stable-${id + 1}`]].sort(
        ([left], [right]) => String(left).localeCompare(String(right)),
      ),
    ])
    expect(result.status).toBe(`ready`)
  }
}

type PartitionScenario = {
  name: string
  prefix: Array<Array<Message<OracleRow>>>
  messages: Array<Message<OracleRow>>
  expectedRows: Array<[number, string, string]>
  resume: boolean
}

type HistoryToken = {
  operation: `insert` | `update` | `delete`
  id: number
  name: string
}

type DesignToken =
  | HistoryToken
  | { operation: `reset` | `commit` | `subset` | `neutral` }

type ProcessSlot = `a` | `b`

type ProcessCommand =
  | { kind: `create`; slot: ProcessSlot }
  | { kind: `import`; slot: ProcessSlot; txid: number; resume: boolean }
  | { kind: `preload`; slot: ProcessSlot }
  | {
      kind: `batch`
      slot: ProcessSlot
      operation: HistoryToken[`operation`]
      id: number
      name: string
      txid: number
    }
  | { kind: `reset`; slot: ProcessSlot }
  | { kind: `snapshot`; slot: ProcessSlot; id: number; name: string }
  | { kind: `retired-callback`; slot: ProcessSlot; id: number; name: string }
  | { kind: `cleanup`; slot: ProcessSlot }
  | { kind: `restart`; slot: ProcessSlot }

type ProcessRuntime = {
  collection: Collection<OracleRow, string | number>
  subscriber?: (messages: Array<Message<OracleRow>>) => void
  retiredSubscriber?: (messages: Array<Message<OracleRow>>) => void
  reference: ReferenceState
  seenTxids: Set<number>
  resumeAvailable: boolean
  requiresCompleteResume: boolean
  resettingSnapshot: boolean
  terminalError: boolean
  active: boolean
  retired: boolean
  preloads: Array<ObservedPreload>
}

type PreloadOutcome =
  | { status: `fulfilled` }
  | { status: `rejected`; reason: unknown }

function observePreload(promise: Promise<void>) {
  const observed: {
    expectedRejection?: `cleanup` | `invalid-resume`
    settled: boolean
    outcome: Promise<PreloadOutcome>
  } = {
    settled: false,
    // Both handlers are installed at creation, before a driver command can
    // invalidate or retire the collection. Keep the original rejection object.
    outcome: promise.then(
      () => {
        observed.settled = true
        return { status: `fulfilled` }
      },
      (reason: unknown) => {
        observed.settled = true
        return { status: `rejected`, reason }
      },
    ),
  }
  return observed
}

type ObservedPreload = ReturnType<typeof observePreload>

function expectPreloadOutcome(
  observed: ObservedPreload,
  outcome: PreloadOutcome,
) {
  if (observed.expectedRejection === undefined) {
    if (outcome.status === `rejected`) throw outcome.reason
    return
  }
  expect(outcome.status).toBe(`rejected`)
  if (outcome.status === `rejected`) {
    expect(outcome.reason).toMatchObject(
      observed.expectedRejection === `cleanup`
        ? {
            name: `AbortError`,
            message: `Collection preload was abandoned during cleanup`,
          }
        : {
            message: `Electric resume state referenced an unseen row; a full snapshot is required`,
          },
    )
  }
}

const processCommandArb: fc.Arbitrary<ProcessCommand> = fc.oneof(
  fc.record({
    kind: fc.constant(`create` as const),
    slot: fc.constantFrom<ProcessSlot>(`a`, `b`),
  }),
  fc.record({
    kind: fc.constant(`import` as const),
    slot: fc.constantFrom<ProcessSlot>(`a`, `b`),
    txid: fc.integer({ min: 1, max: 50 }),
    resume: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant(`preload` as const),
    slot: fc.constantFrom<ProcessSlot>(`a`, `b`),
  }),
  fc.record({
    kind: fc.constant(`batch` as const),
    slot: fc.constantFrom<ProcessSlot>(`a`, `b`),
    operation: fc.constantFrom<HistoryToken[`operation`]>(
      `insert`,
      `update`,
      `delete`,
    ),
    id: fc.integer({ min: 1, max: 3 }),
    name: fc.string({ maxLength: 8 }),
    txid: fc.integer({ min: 51, max: 100 }),
  }),
  fc.record({
    kind: fc.constant(`reset` as const),
    slot: fc.constantFrom<ProcessSlot>(`a`, `b`),
  }),
  fc.record({
    kind: fc.constant(`snapshot` as const),
    slot: fc.constantFrom<ProcessSlot>(`a`, `b`),
    id: fc.integer({ min: 1, max: 3 }),
    name: fc.string({ maxLength: 8 }),
  }),
  fc.record({
    kind: fc.constant(`retired-callback` as const),
    slot: fc.constantFrom<ProcessSlot>(`a`, `b`),
    id: fc.integer({ min: 1, max: 3 }),
    name: fc.string({ maxLength: 8 }),
  }),
  fc.record({
    kind: fc.constant(`cleanup` as const),
    slot: fc.constantFrom<ProcessSlot>(`a`, `b`),
  }),
  fc.record({
    kind: fc.constant(`restart` as const),
    slot: fc.constantFrom<ProcessSlot>(`a`, `b`),
  }),
)

const designTokenArb: fc.Arbitrary<DesignToken> = fc.oneof(
  fc.record({
    operation: fc.constantFrom<HistoryToken[`operation`]>(
      `insert`,
      `update`,
      `delete`,
    ),
    id: fc.integer({ min: 1, max: 3 }),
    name: fc.string({ maxLength: 8 }),
  }),
  fc.record({
    operation: fc.constantFrom<`reset` | `commit` | `subset` | `neutral`>(
      `reset`,
      `commit`,
      `subset`,
      `neutral`,
    ),
  }),
)

type SchedulerEvent =
  | `startup-promise`
  | `hydration`
  | `snapshot-available`
  | `commit`
  | `cleanup`

function permutations<T>(values: ReadonlyArray<T>): Array<Array<T>> {
  if (values.length <= 1) return [[...values]]
  const result: Array<Array<T>> = []
  values.forEach((value, index) => {
    const rest = [...values.slice(0, index), ...values.slice(index + 1)]
    for (const suffix of permutations(rest)) result.push([value, ...suffix])
  })
  return result
}

async function drainScheduler(): Promise<void> {
  for (let turn = 0; turn < 12; turn++) await Promise.resolve()
}

function buildValidHistory(tokens: Array<HistoryToken>): {
  messages: Array<Message<OracleRow>>
  expectedRows: Array<[number, string, string]>
} {
  const state = new Map<number, { name: string; stable: string }>()
  const messages: Array<Message<OracleRow>> = []

  for (const token of tokens) {
    if (token.operation === `delete`) {
      if (!state.has(token.id)) continue
      messages.push(change(`delete`, token.id, token.name))
      state.delete(token.id)
      continue
    }

    const operation =
      token.operation === `update` && !state.has(token.id)
        ? `insert`
        : token.operation
    messages.push(change(operation, token.id, token.name))
    state.set(token.id, {
      name: token.name,
      stable: `stable-${token.id}`,
    })
  }

  return {
    messages: [...messages, upToDate],
    expectedRows: Array.from(state, ([id, row]): [number, string, string] => [
      id,
      row.name,
      row.stable,
    ]).sort(([left], [right]) => left - right),
  }
}

function designMessage(token: DesignToken): Message<OracleRow> {
  if (token.operation === `reset`) return mustRefetch
  if (token.operation === `commit`) return upToDate
  if (token.operation === `subset`) return subsetEnd
  if (token.operation === `neutral`) {
    return {
      headers: {
        control: `snapshot-end`,
        xmin: `100`,
        xmax: `150`,
        xip_list: [],
      },
    }
  }
  if (!(`id` in token)) throw new Error(`Unknown design token`)
  return change(token.operation, token.id, token.name)
}

function buildDifferentialHistory(
  tokens: Array<DesignToken>,
): Array<Message<OracleRow>> {
  const known = new Set<number>([99])
  const messages: Array<Message<OracleRow>> = [
    change(`insert`, 99, `baseline`),
    upToDate,
  ]

  for (const token of tokens) {
    if (token.operation === `reset`) {
      known.clear()
      messages.push(mustRefetch)
      continue
    }
    if (
      token.operation === `commit` ||
      token.operation === `subset` ||
      token.operation === `neutral`
    ) {
      messages.push(designMessage(token))
      continue
    }
    if (!(`id` in token)) throw new Error(`Unknown differential token`)
    if (token.operation === `delete`) {
      if (!known.delete(token.id)) continue
      messages.push(change(`delete`, token.id, token.name))
      continue
    }
    const operation =
      token.operation === `update` && !known.has(token.id)
        ? `insert`
        : token.operation
    known.add(token.id)
    messages.push(change(operation, token.id, token.name))
  }

  messages.push(subsetEnd)
  return messages
}

async function runProcessGrammar(
  idPrefix: string,
  generated: Array<ProcessCommand>,
) {
  const subscribers: Array<(messages: Array<Message<OracleRow>>) => void> = []
  const runtimes = new Map<ProcessSlot, ProcessRuntime>()
  const allPreloads: Array<ObservedPreload> = []
  const reached: Array<{ command: ProcessCommand; result: string }> = []
  const callbackVisits = new Map<
    NonNullable<ProcessRuntime[`subscriber`]>,
    number
  >()
  const expectPendingRejection = (
    runtime: ProcessRuntime,
    reason: NonNullable<ObservedPreload[`expectedRejection`]>,
  ) => {
    for (const preload of runtime.preloads) {
      if (!preload.settled) preload.expectedRejection = reason
    }
  }
  let generation = 0
  mockSubscribe.mockReset()
  mockSubscribe.mockImplementation((callback) => {
    const observed: NonNullable<ProcessRuntime[`subscriber`]> = (messages) => {
      callbackVisits.set(observed, callbackVisits.get(observed)! + 1)
      callback(messages)
    }
    callbackVisits.set(observed, 0)
    subscribers.push(observed)
    return vi.fn()
  })

  const createRuntime = async (slot: ProcessSlot) => {
    const previous = runtimes.get(slot)
    if (previous) {
      expectPendingRejection(previous, `cleanup`)
      await previous.collection.cleanup()
    }
    generation++
    const collection = createCollection(
      electricCollectionOptions<OracleRow>({
        id: `${idPrefix}-${slot}-${generation}`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        getKey: (row) => row.id,
        startSync: false,
      }),
    )
    runtimes.set(slot, {
      collection,
      reference: { committed: new Map(), pending: new Map() },
      seenTxids: new Set(),
      resumeAvailable: false,
      requiresCompleteResume: false,
      resettingSnapshot: false,
      terminalError: false,
      active: false,
      retired: false,
      preloads: [],
    })
  }

  const startRuntime = (runtime: ProcessRuntime, preload: boolean) => {
    if (runtime.active) return
    const subscriberIndex = subscribers.length
    if (preload) {
      const observed = observePreload(runtime.collection.preload())
      runtime.preloads.push(observed)
      allPreloads.push(observed)
    } else {
      runtime.collection.startSyncImmediate()
    }
    const subscriber = subscribers[subscriberIndex]
    if (!subscriber) throw new Error(`Electric stream did not subscribe`)
    runtime.subscriber = subscriber
    runtime.requiresCompleteResume = runtime.resumeAvailable
    runtime.resettingSnapshot = false
    runtime.terminalError = false
    runtime.active = true
    runtime.retired = false
  }

  const assertAllSlots = () => {
    runtimes.forEach((runtime) => {
      const expected = runtime.active
        ? rowsFromMap(runtime.reference.committed)
        : []
      expect(rowsFromCollection(runtime.collection)).toEqual(expected)
      if (runtime.terminalError) {
        expect(runtime.collection.status).toBe(`error`)
      }
      if (!runtime.active && runtime.retired) {
        expect(runtime.collection.status).toBe(`cleaned-up`)
      }
    })
  }

  const execute = async (command: ProcessCommand) => {
    if (command.kind === `create`) {
      await createRuntime(command.slot)
      return `created`
    }
    const runtime = runtimes.get(command.slot)
    if (!runtime) return `skipped: no collection`

    if (command.kind === `import`) {
      if (runtime.active) return `skipped: already active`
      runtime.collection.config.sync.importSyncMeta?.({
        version: 1,
        seenTxids: [command.txid],
        ...(command.resume
          ? {
              resume: {
                kind: `resume`,
                requiresTagState: false,
                offset: `10_0`,
                handle: `shape-1`,
                shapeId,
                updatedAt: command.txid,
              },
            }
          : {}),
      })
      await expect(
        runtime.collection.utils.awaitTxId(command.txid, 20),
      ).resolves.toBe(true)
      runtime.resumeAvailable ||= command.resume
      runtime.seenTxids.add(command.txid)
      for (const [otherSlot, other] of runtimes) {
        if (otherSlot === command.slot || other.seenTxids.has(command.txid)) {
          continue
        }
        await expect(
          other.collection.utils.awaitTxId(command.txid, 2),
        ).rejects.toThrow()
      }
      return `imported`
    }

    if (command.kind === `preload`) {
      if (runtime.active) return `skipped: already active`
      startRuntime(runtime, true)
      return `preloaded`
    }
    if (command.kind === `restart`) {
      if (runtime.active) return `skipped: already active`
      startRuntime(runtime, false)
      return `restarted`
    }
    if (command.kind === `cleanup`) {
      expectPendingRejection(runtime, `cleanup`)
      runtime.retiredSubscriber =
        runtime.subscriber ?? runtime.retiredSubscriber
      await runtime.collection.cleanup()
      runtime.active = false
      runtime.retired = true
      runtime.subscriber = undefined
      runtime.reference = {
        committed: new Map(),
        pending: new Map(),
      }
      runtime.resumeAvailable = false
      runtime.requiresCompleteResume = false
      runtime.resettingSnapshot = false
      runtime.terminalError = false
      return `cleaned up`
    }
    if (command.kind === `retired-callback`) {
      if (!runtime.retiredSubscriber) return `skipped: no retired callback`
      const observeOwners = () =>
        Array.from(runtimes, ([slot, owner]) => ({
          slot,
          rows: rowsFromCollection(owner.collection),
          status: owner.collection.status,
          metadata: structuredClone(
            owner.collection.config.sync.exportSyncMeta?.(),
          ),
        }))
      const before = observeOwners()
      const beforeVisits = callbackVisits.get(runtime.retiredSubscriber)!
      runtime.retiredSubscriber([
        change(`insert`, command.id, command.name),
        { headers: { control: `up-to-date`, txids: [1001] } },
      ])
      expect(callbackVisits.get(runtime.retiredSubscriber)).toBe(
        beforeVisits + 1,
      )
      expect(observeOwners()).toEqual(before)
      return `delivered: retired callback`
    }
    if (!runtime.active || !runtime.subscriber) return `skipped: inactive`
    if (runtime.terminalError) return `skipped: terminal error`

    if (command.kind === `reset`) {
      runtime.subscriber([mustRefetch])
      applyReferenceBatch(runtime.reference, [mustRefetch])
      runtime.resettingSnapshot = true
      return `delivered: reset`
    }

    if (command.kind === `snapshot`) {
      const messages = [change(`insert`, command.id, command.name), upToDate]
      runtime.subscriber(messages)
      applyReferenceBatch(runtime.reference, messages)
      runtime.resettingSnapshot = false
      runtime.resumeAvailable = true
      return `delivered: snapshot`
    }

    const evidenceChange = change(command.operation, command.id, command.name)
    const messages: Array<Message<OracleRow>> = [
      {
        ...evidenceChange,
        headers: {
          operation: command.operation,
          txids: [command.txid],
        },
      },
      upToDate,
    ]
    const observesTxid =
      command.operation !== `update` ||
      runtime.reference.pending.has(command.id)
    const invalidResume =
      runtime.requiresCompleteResume &&
      !runtime.resettingSnapshot &&
      command.operation === `update` &&
      !runtime.reference.pending.has(command.id)
    const txidOutcome = observesTxid
      ? runtime.collection.utils.awaitTxId(command.txid, 100)
      : undefined
    if (invalidResume) expectPendingRejection(runtime, `invalid-resume`)
    runtime.subscriber(messages)
    if (invalidResume) {
      runtime.terminalError = true
      runtime.resumeAvailable = false
      runtime.retiredSubscriber = runtime.subscriber
      return `delivered: invalid resume`
    }
    applyReferenceBatch(runtime.reference, messages)
    runtime.resettingSnapshot = false
    runtime.resumeAvailable = true
    if (txidOutcome) {
      await expect(txidOutcome).resolves.toBe(true)
      runtime.seenTxids.add(command.txid)
    }
    return `delivered: batch`
  }

  const requiredPrefix: Array<ProcessCommand> = [
    { kind: `create`, slot: `a` },
    { kind: `create`, slot: `b` },
    { kind: `import`, slot: `a`, txid: 1, resume: true },
    { kind: `import`, slot: `b`, txid: 2, resume: false },
    { kind: `preload`, slot: `a` },
    { kind: `preload`, slot: `b` },
    {
      kind: `batch`,
      slot: `a`,
      operation: `insert`,
      id: 1,
      name: `a-initial`,
      txid: 51,
    },
    {
      kind: `batch`,
      slot: `b`,
      operation: `insert`,
      id: 1,
      name: `b-initial`,
      txid: 52,
    },
    { kind: `reset`, slot: `a` },
    { kind: `snapshot`, slot: `a`, id: 2, name: `a-snapshot` },
  ]
  const requiredSuffix: Array<ProcessCommand> = [
    { kind: `cleanup`, slot: `a` },
    { kind: `restart`, slot: `a` },
    { kind: `retired-callback`, slot: `a`, id: 3, name: `retired-a` },
    {
      kind: `batch`,
      slot: `a`,
      operation: `insert`,
      id: 3,
      name: `a-restarted`,
      txid: 53,
    },
    { kind: `cleanup`, slot: `b` },
    { kind: `restart`, slot: `b` },
    { kind: `retired-callback`, slot: `b`, id: 3, name: `retired-b` },
    {
      kind: `batch`,
      slot: `b`,
      operation: `insert`,
      id: 3,
      name: `b-restarted`,
      txid: 54,
    },
  ]

  try {
    for (const command of [
      ...requiredPrefix,
      ...generated,
      ...requiredSuffix,
    ]) {
      const entry = { command, result: `entered` }
      reached.push(entry)
      entry.result = await execute(command)
      assertAllSlots()
    }
  } catch (error) {
    throw new Error(`Process grammar ${idPrefix}: ${JSON.stringify(reached)}`, {
      cause: error,
    })
  } finally {
    for (const runtime of runtimes.values())
      expectPendingRejection(runtime, `cleanup`)
    await Promise.all(
      Array.from(runtimes.values(), ({ collection }) => collection.cleanup()),
    )
    await Promise.all(allPreloads.map(({ outcome }) => outcome))
    mockSubscribe.mockReset()
  }
  const preloads = await Promise.all(
    allPreloads.map(async (observed) => {
      const outcome = await observed.outcome
      expectPreloadOutcome(observed, outcome)
      return outcome
    }),
  )
  return { reached, preloads }
}

async function runSchedulerPermutation(
  id: string,
  order: Array<SchedulerEvent>,
): Promise<{
  outcome: `resolved` | `aborted`
  acknowledgedBeforeDurable: boolean
}> {
  const startup = createDeferred<void>()
  const hydration = createDeferred<void>()
  const commit = createDeferred<void>()
  const persistedMetadata = new Map(resumeState())
  const persistedRows = new Map<string | number, OracleRow>([
    [1, { id: 1, name: `persisted`, stable: `stable-1` }],
  ])
  const adapter = createPersistedAdapter(
    persistedMetadata,
    persistedRows,
    hydration.promise,
  )
  const loadMetadata = adapter.loadCollectionMetadata!.bind(adapter)
  adapter.loadCollectionMetadata = async (...args) => {
    await startup.promise
    return loadMetadata(...args)
  }
  const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
  adapter.applyCommittedTx = async (...args) => {
    await commit.promise
    return applyCommittedTx(...args)
  }

  let subscriber: ((messages: Array<Message<OracleRow>>) => void) | undefined
  let snapshotRequested = false
  let snapshotDelivered = false
  const deliveryPhases = new Set<`before-cleanup` | `after-cleanup`>()
  let cleanupCompleted = false
  let acknowledgedBeforeDurable = false
  const schedulerStream = {
    ...mockStream,
    subscribe: (callback: (messages: Array<Message<OracleRow>>) => void) => {
      subscriber = callback
      return vi.fn()
    },
  }
  vi.mocked(ShapeStream).mockReset()
  vi.mocked(ShapeStream).mockImplementation(() => schedulerStream as never)

  const collection = createCollection(
    persistedCollectionOptions<
      OracleRow,
      string | number,
      never,
      ElectricCollectionUtils<OracleRow>
    >({
      ...electricCollectionOptions<OracleRow>({
        id,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode: `progressive`,
        getKey: (row) => row.id,
        startSync: false,
      }),
      persistence: { adapter },
    }),
  )
  let matchSettlement: `resolved` | `aborted` | `timed-out` | undefined
  let txidSettlement: `resolved` | `aborted` | `timed-out` | undefined
  const matchOutcome = collection.utils
    .awaitMatch((message) => `value` in message && message.value.id === 1, 250)
    .then(
      () => `resolved` as const,
      (error: unknown) =>
        /aborted/i.test(String(error))
          ? (`aborted` as const)
          : (`timed-out` as const),
    )
    .then((outcome) => (matchSettlement = outcome))
  const txidOutcome = collection.utils
    .awaitTxId(91, 250)
    .then(
      () => `resolved` as const,
      (error: unknown) =>
        /aborted/i.test(String(error))
          ? (`aborted` as const)
          : (`timed-out` as const),
    )
    .then((outcome) => (txidSettlement = outcome))
  collection.startSyncImmediate()

  const deliverSnapshotIfPossible = () => {
    if (!snapshotRequested || snapshotDelivered || !subscriber) return
    snapshotDelivered = true
    deliveryPhases.add(cleanupCompleted ? `after-cleanup` : `before-cleanup`)
    const update = change(`update`, 1, `scheduled`)
    subscriber([
      { ...update, headers: { operation: `update`, txids: [91] } },
      upToDate,
    ])
  }

  const assertSchedulerCheckpoint = () => {
    expect(matchSettlement === undefined).toBe(txidSettlement === undefined)
    if (matchSettlement === `resolved`) {
      expect(txidSettlement).toBe(`resolved`)
      expect(snapshotDelivered).toBe(true)
      acknowledgedBeforeDurable ||= persistedRows.get(1)?.name === `persisted`
    }
    if (matchSettlement === `aborted`) {
      expect(txidSettlement).toBe(`aborted`)
      expect(collection.status).toBe(`cleaned-up`)
    }
    expect(matchSettlement).not.toBe(`timed-out`)
    expect(txidSettlement).not.toBe(`timed-out`)
  }

  try {
    for (const event of order) {
      if (event === `startup-promise`) startup.resolve()
      if (event === `hydration`) hydration.resolve()
      if (event === `snapshot-available`) snapshotRequested = true
      if (event === `commit`) commit.resolve()
      if (event === `cleanup`) {
        await collection.cleanup()
        cleanupCompleted = true
      }
      await drainScheduler()
      deliverSnapshotIfPossible()
      await drainScheduler()
      assertSchedulerCheckpoint()
    }

    startup.resolve()
    hydration.resolve()
    commit.resolve()
    snapshotRequested = true
    await drainScheduler()
    deliverSnapshotIfPossible()
    await drainScheduler()
    assertSchedulerCheckpoint()

    const [match, txid] = await Promise.all([matchOutcome, txidOutcome])
    if (match === `timed-out` || txid === `timed-out`) {
      throw new Error(`scheduler waiter timed out`)
    }
    expect(match).toBe(txid)
    expect(collection.status).toBe(`cleaned-up`)
    expect(rowsFromCollection(collection)).toEqual([])
    if (deliveryPhases.has(`after-cleanup`)) {
      expect(persistedRows.get(1)?.name).toBe(`persisted`)
    }

    if (order[0] === `cleanup`) {
      expect(match).toBe(`aborted`)
      expect(subscriber).toBeUndefined()
      expect(persistedRows.get(1)?.name).toBe(`persisted`)
    }
    if (match === `resolved`) {
      expect(persistedRows.get(1)).toEqual({
        id: 1,
        name: `scheduled`,
        stable: `stable-1`,
      })
    }
    return { outcome: match, acknowledgedBeforeDurable }
  } finally {
    await collection.cleanup()
    vi.mocked(ShapeStream).mockReset()
    vi.mocked(ShapeStream).mockImplementation(() => mockStream as never)
  }
}

describe(`Electric adapter laws`, () => {
  let processGrammarRun = 0

  beforeEach(() => {
    vi.clearAllMocks()
    mockStream.isUpToDate = false
    mockStream.shapeHandle = `shape-current`
    mockStream.lastOffset = `20_0`
  })

  it.each(
    ([`eager`, `on-demand`, `progressive`] as const).flatMap((syncMode) =>
      [0, 1, 2].map((removals) => ({ syncMode, removals })),
    ),
  )(
    `preserves live updates after $removals initial tagged move-outs in $syncMode mode`,
    ({ syncMode, removals }) =>
      checkInitialMoveOut(syncMode, removals, 1, `updated`),
  )

  fcTest.prop(
    [
      fc.integer({ min: 1, max: 20 }),
      fc.string({ maxLength: 8 }),
      fc.integer({ min: 0, max: 2 }),
    ],
    { numRuns: 20 },
  )(
    `generated initial tagged move-outs preserve later live updates`,
    async (id, updated, removals) => {
      for (const syncMode of [`eager`, `on-demand`, `progressive`] as const) {
        await checkInitialMoveOut(syncMode, removals, id, updated)
      }
    },
  )

  fcTest.prop([fc.array(processCommandArb, { maxLength: 20 })], {
    numRuns: 20,
  })(
    `generated process grammar preserves lifecycle and concurrent-collection isolation`,
    async (commands) => {
      processGrammarRun++
      await runProcessGrammar(`process-grammar-${processGrammarRun}`, commands)
    },
  )

  it(`delivers retired callbacks without advancing a failed lifecycle`, async () => {
    const result = await runProcessGrammar(`process-grammar-terminal-error`, [
      {
        kind: `batch`,
        slot: `a`,
        operation: `update`,
        id: 1,
        name: `unseen`,
        txid: 55,
      },
      { kind: `snapshot`, slot: `a`, id: 1, name: `stale callback` },
      {
        kind: `retired-callback`,
        slot: `a`,
        id: 1,
        name: `actually delivered`,
      },
    ])
    expect(
      result.reached
        .filter(({ command }) => command.kind === `retired-callback`)
        .map(({ result: reached }) => reached),
    ).toEqual([
      `delivered: retired callback`,
      `delivered: retired callback`,
      `delivered: retired callback`,
    ])
    expect(
      result.reached.find(
        ({ command }) =>
          command.kind === `snapshot` && command.name === `stale callback`,
      )?.result,
    ).toBe(`skipped: terminal error`)
  })

  it.each([`invalid-resume`, `cleanup`] as const)(
    `records an initial preload's %s rejection before continuing the grammar`,
    async (failure) => {
      const result = await runProcessGrammar(`preload-${failure}`, [
        { kind: `create`, slot: `a` },
        { kind: `import`, slot: `a`, txid: 4, resume: true },
        { kind: `preload`, slot: `a` },
        ...(failure === `cleanup`
          ? [{ kind: `cleanup` as const, slot: `a` as const }]
          : [
              {
                kind: `batch` as const,
                slot: `a` as const,
                operation: `update` as const,
                id: 3,
                name: `unseen`,
                txid: 56,
              },
            ]),
        { kind: `retired-callback`, slot: `a`, id: 3, name: `after rejection` },
      ])
      expect(result.preloads.map(({ status }) => status)).toEqual([
        `fulfilled`,
        `fulfilled`,
        `rejected`,
      ])
      const rejected = result.preloads[2]!
      if (rejected.status === `rejected`) {
        expect(rejected.reason).toMatchObject(
          failure === `cleanup`
            ? { name: `AbortError` }
            : {
                message: `Electric resume state referenced an unseen row; a full snapshot is required`,
              },
        )
      }
      expect(
        result.reached.find(
          ({ command }) =>
            command.kind === `retired-callback` &&
            command.name === `after rejection`,
        )?.result,
      ).toBe(`delivered: retired callback`)
    },
  )

  it(`preserves unexpected preload failures instead of treating observation as success`, async () => {
    const failure = new Error(`test-owned preload failure`)
    const observed = observePreload(Promise.reject(failure))
    const outcome = await observed.outcome
    expect(outcome).toEqual({ status: `rejected`, reason: failure })
    if (outcome.status === `rejected`) expect(outcome.reason).toBe(failure)
    expect(() => expectPreloadOutcome(observed, outcome)).toThrow(failure)
    const success = observePreload(Promise.resolve())
    expectPreloadOutcome(success, await success.outcome)
  })

  it.each([`reset`, `delete`, `move-out`] as const)(
    `keeps $0 removal authoritative across an optimistic write and a new acquisition`,
    async (removal) => {
      const trace = createOracleCollection(
        `parked-presence`,
        `on-demand`,
        createMetadata(new Map()).api,
      )
      const persistence = createDeferred<void>()
      let acquired: Promise<unknown> | undefined
      let transaction: ReturnType<typeof createTransaction> | undefined
      try {
        const inserted = change(`insert`, 1, `complete`)
        trace.subscriber([
          { ...inserted, headers: { ...inserted.headers, tags: [`left`] } },
          upToDate,
        ])
        transaction = createTransaction({
          mutationFn: () => persistence.promise,
        })
        transaction.mutate(() =>
          trace.collection.insert({
            id: 99,
            name: `optimistic`,
            stable: `stable-99`,
          }),
        )
        const removed: Message<OracleRow> =
          removal === `reset`
            ? mustRefetch
            : removal === `delete`
              ? change(`delete`, 1, `complete`)
              : {
                  headers: {
                    event: `move-out`,
                    patterns: [{ pos: 0, value: `left` }],
                  },
                }
        trace.subscriber([removed, subsetEnd])
        // Truncation drains immediately; ordinary removals remain parked.
        expect(trace.collection.has(1)).toBe(removal !== `reset`)
        acquired = Promise.resolve(
          trace.collection._sync.loadSubset({
            where: new IR.Func(`eq`, [new IR.PropRef([`id`]), new IR.Value(2)]),
          }),
        )
        void acquired.catch(() => {})
        trace.subscriber([change(`update`, 1, `partial`), upToDate])
        persistence.resolve()
        await transaction.isPersisted.promise
        await acquired
        expect(trace.collection.has(1)).toBe(false)
      } finally {
        persistence.resolve()
        await transaction?.isPersisted.promise
        await trace.collection.cleanup()
        await acquired
      }
    },
  )

  fcTest.prop(
    [fc.array(designTokenArb, { minLength: 1, maxLength: 7 }), fc.nat()],
    { numRuns: 24 },
  )(
    `operational and denotational reference designs agree before checking production`,
    async (tokens, partitionSeed) => {
      const prefix = [[upToDate]]
      const messages = [...tokens.map(designMessage), upToDate]
      const partitions = everyContiguousPartition(messages)
      const selected = [
        [messages],
        messages.map((message) => [message]),
        partitions[partitionSeed % partitions.length]!,
      ].filter(isSdkResetFramedPartition)

      for (const [partitionId, partition] of selected.entries()) {
        const operational = expectedSnapshots(prefix, partition)
        const denotational = recomputedSnapshots(prefix, partition)
        expect(operational).toEqual(denotational)

        for (const syncMode of [`eager`, `on-demand`, `progressive`] as const) {
          const actual = await runTrace(
            `design-grammar-${syncMode}-${partitionId}`,
            syncMode,
            prefix,
            partition,
          )
          expect(actual.snapshots).toEqual(denotational)
        }
      }
    },
  )

  it(`distinguishes plausible unseen-update and reset-visibility semantics`, async () => {
    const completeUnseenUpdate: ChangeMessage<OracleRow> = {
      key: `1`,
      value: { id: 1, name: `complete`, stable: `stable-1` },
      headers: { operation: `update` },
    }
    const updateHistory = [[completeUnseenUpdate, upToDate]]
    expect(recomputeCommittedRows(updateHistory, `ignore`)).toEqual([])
    expect(recomputeCommittedRows(updateHistory, `promote-complete`)).toEqual([
      [1, `complete`, `stable-1`],
    ])
    const updateActual = await runTrace(
      `design-unseen-update`,
      `eager`,
      [],
      updateHistory,
    )
    expect(updateActual.rows).toEqual(
      recomputeCommittedRows(updateHistory, `ignore`),
    )

    const resetHistory = [
      [change(`insert`, 1, `committed`), upToDate],
      [mustRefetch],
    ]
    const atomicReset = recomputedSnapshots([], resetHistory)
    const immediateReset: typeof atomicReset = [atomicReset[0]!, []]
    expect(atomicReset).not.toEqual(immediateReset)
    const resetActual = await runTrace(
      `design-reset-visibility`,
      `eager`,
      [],
      resetHistory,
    )
    expect(resetActual.snapshots).toEqual(atomicReset)
  })

  it(`keeps SDK reset callbacks separate from every neighboring message kind`, () => {
    const neighbors: Array<Message<OracleRow>> = [
      change(`insert`, 1, `row`),
      change(`update`, 1, `row`),
      change(`delete`, 1, `row`),
      { headers: { event: `move-out`, patterns: [{ pos: 0, value: `left` }] } },
      upToDate,
      subsetEnd,
      mustRefetch,
    ]
    expect(isSdkResetFramedPartition([[mustRefetch]])).toBe(true)
    for (const neighbor of neighbors) {
      for (const messages of [
        [neighbor, mustRefetch],
        [mustRefetch, neighbor],
      ]) {
        expect(
          isSdkResetFramedPartition([messages]),
          JSON.stringify(messages),
        ).toBe(false)
        expect(
          isSdkResetFramedPartition(messages.map((message) => [message])),
        ).toBe(true)
      }
    }
  })

  it(`distinguishes callback-atomic and subset publication semantics`, async () => {
    const callbackHistory = [
      [
        change(`insert`, 1, `before-control`),
        upToDate,
        change(`update`, 1, `after-control`),
      ],
    ]
    const callbackAtomic = recomputeCommittedRows(callbackHistory)
    const freezeAtControl: typeof callbackAtomic = [
      [1, `before-control`, `stable-1`],
    ]
    expect(callbackAtomic).toEqual([[1, `after-control`, `stable-1`]])
    expect(callbackAtomic).not.toEqual(freezeAtControl)
    expect(isSdkResetFramedPartition([[upToDate, mustRefetch]])).toBe(false)
    expect(
      isSdkResetFramedPartition([[mustRefetch, subsetEnd, mustRefetch]]),
    ).toBe(false)

    const readyPrefix = [[upToDate]]
    const subsetHistory = [
      [change(`insert`, 1, `subset-publication`)],
      [subsetEnd],
    ]
    const subsetPublishes = recomputedSnapshots(readyPrefix, subsetHistory)
    const upToDateOnly: typeof subsetPublishes = [[], []]
    expect(subsetPublishes).not.toEqual(upToDateOnly)

    for (const syncMode of [`eager`, `on-demand`, `progressive`] as const) {
      const callbackActual = await runTrace(
        `design-callback-atomic-${syncMode}`,
        syncMode,
        [],
        callbackHistory,
      )
      expect(callbackActual.rows).toEqual(callbackAtomic)

      const subsetActual = await runTrace(
        `design-subset-publication-${syncMode}`,
        syncMode,
        readyPrefix,
        subsetHistory,
      )
      expect(subsetActual.snapshots).toEqual(subsetPublishes)
    }
  })

  it(`settles every startup, hydration, snapshot availability, commit, and cleanup permutation`, async () => {
    const events: Array<SchedulerEvent> = [
      `startup-promise`,
      `hydration`,
      `snapshot-available`,
      `commit`,
      `cleanup`,
    ]
    let permutationIndex = 0
    const outcomes = new Set<`resolved` | `aborted`>()
    let sawAcknowledgementBeforeDurability = false
    for (const order of permutations(events)) {
      const currentIndex = permutationIndex++
      try {
        const result = await runSchedulerPermutation(
          `scheduler-permutation-${currentIndex}`,
          order,
        )
        outcomes.add(result.outcome)
        sawAcknowledgementBeforeDurability ||= result.acknowledgedBeforeDurable
      } catch (error) {
        throw new Error(
          `scheduler permutation ${currentIndex} failed: ${order.join(` → `)}`,
          { cause: error },
        )
      }
    }
    expect(outcomes).toEqual(new Set([`resolved`, `aborted`]))
    expect(sawAcknowledgementBeforeDurability).toBe(true)
  }, 30_000)

  fcTest.prop(
    [
      fc.tuple(
        fc.string({ maxLength: 8 }),
        fc.string({ maxLength: 8 }),
        fc.string({ maxLength: 8 }),
        fc.string({ maxLength: 8 }),
      ),
    ],
    { numRuns: 10 },
  )(
    `synthetic batch partition is invariant across Electric modes and phases`,
    async (names) => {
      const [first, second, updated, reinserted] = names
      const readyPrefix = [
        [change(`insert`, 1, first), change(`insert`, 2, second), upToDate],
      ]
      const scenarios: Array<PartitionScenario> = [
        {
          name: `bootstrap`,
          prefix: [],
          messages: [
            change(`insert`, 1, first),
            change(`insert`, 2, second),
            change(`update`, 1, updated),
            change(`delete`, 2, second),
            change(`insert`, 2, reinserted),
            upToDate,
          ],
          expectedRows: [
            [1, updated, `stable-1`],
            [2, reinserted, `stable-2`],
          ],
          resume: false,
        },
        {
          name: `steady`,
          prefix: readyPrefix,
          messages: [
            change(`update`, 1, updated),
            change(`delete`, 2, second),
            change(`insert`, 2, reinserted),
            upToDate,
          ],
          expectedRows: [
            [1, updated, `stable-1`],
            [2, reinserted, `stable-2`],
          ],
          resume: false,
        },
        {
          name: `split-delete-update`,
          prefix: [[change(`insert`, 1, first), upToDate]],
          messages: [
            change(`delete`, 1, first),
            change(`update`, 1, updated),
            upToDate,
          ],
          expectedRows: [],
          resume: false,
        },
        {
          name: `subset`,
          prefix: readyPrefix,
          messages: [
            change(`update`, 1, updated),
            change(`delete`, 2, second),
            subsetEnd,
          ],
          expectedRows: [[1, updated, `stable-1`]],
          resume: false,
        },
        {
          name: `must-refetch`,
          prefix: readyPrefix,
          messages: [
            mustRefetch,
            change(`insert`, 1, first),
            change(`update`, 1, updated),
            change(`insert`, 2, reinserted),
            upToDate,
          ],
          expectedRows: [
            [1, updated, `stable-1`],
            [2, reinserted, `stable-2`],
          ],
          resume: false,
        },
        {
          name: `must-refetch-unseen-update`,
          prefix: readyPrefix,
          messages: [mustRefetch, change(`update`, 1, updated), upToDate],
          expectedRows: [],
          resume: false,
        },
        {
          name: `must-refetch-subset`,
          prefix: readyPrefix,
          messages: [
            mustRefetch,
            change(`insert`, 1, first),
            subsetEnd,
            change(`update`, 1, updated),
            upToDate,
          ],
          expectedRows: [[1, updated, `stable-1`]],
          resume: false,
        },
        {
          name: `resume`,
          prefix: [],
          messages: [
            change(`insert`, 1, first),
            change(`update`, 1, updated),
            upToDate,
          ],
          expectedRows: [[1, updated, `stable-1`]],
          resume: true,
        },
      ]

      // Keep these stronger adapter robustness checks, including mixed-reset
      // callbacks, separate from the SDK-framed differential oracle above.
      for (const syncMode of [`eager`, `on-demand`, `progressive`] as const) {
        for (const scenario of scenarios) {
          const seed = scenario.resume ? resumeState() : new Map()
          const atomic = await runTrace(
            `${syncMode}-${scenario.name}-atomic`,
            syncMode,
            scenario.prefix,
            [scenario.messages],
            seed,
          )
          expect(atomic.rows).toEqual(scenario.expectedRows)
          expect(atomic.status).toBe(`ready`)
          expect(atomic.resume).toEqual(
            expect.objectContaining({ kind: `resume`, offset: `20_0` }),
          )

          let partitionId = 0
          for (const partition of everyContiguousPartition(scenario.messages)) {
            const currentPartition = partitionId++
            const split = await runTrace(
              `${syncMode}-${scenario.name}-${currentPartition}`,
              syncMode,
              scenario.prefix,
              partition,
              seed,
            )
            expect(
              {
                rows: split.rows,
                status: split.status,
                resume: split.resume,
              },
              `${syncMode}/${scenario.name}/partition-${currentPartition}: ${JSON.stringify({ partition, atomic, split })}`,
            ).toEqual({
              rows: atomic.rows,
              status: atomic.status,
              resume: atomic.resume,
            })
            expect(split.snapshots).toEqual(
              expectedSnapshots(scenario.prefix, partition),
            )
          }
        }
      }
    },
    30_000,
  )

  fcTest.prop(
    [
      fc.array(
        fc.record({
          operation: fc.constantFrom<HistoryToken[`operation`]>(
            `insert`,
            `update`,
            `delete`,
          ),
          id: fc.integer({ min: 1, max: 3 }),
          name: fc.string({ maxLength: 8 }),
        }),
        { minLength: 1, maxLength: 5 },
      ),
    ],
    { numRuns: 20 },
  )(
    `generated valid histories are invariant under every batch partition`,
    async (tokens) => {
      const history = buildValidHistory(tokens)
      for (const syncMode of [`eager`, `on-demand`, `progressive`] as const) {
        let partitionId = 0
        for (const partition of everyContiguousPartition(history.messages)) {
          const result = await runTrace(
            `generated-${syncMode}-${partitionId++}`,
            syncMode,
            [],
            partition,
          )
          expect(result.rows).toEqual(history.expectedRows)
          expect(result.snapshots).toEqual(expectedSnapshots([], partition))
          expect(result.status).toBe(`ready`)
        }
      }
    },
  )

  fcTest.prop(
    [fc.array(designTokenArb, { minLength: 1, maxLength: 7 }), fc.nat()],
    {
      numRuns: 20,
      examples: [
        [
          [
            { operation: `reset` },
            { operation: `subset` },
            { operation: `reset` },
          ],
          30,
        ],
      ],
    },
  )(
    `Electric drivers converge with the denotational reference and model-fed Query projection across publication epochs`,
    async (tokens, partitionSeed) => {
      const messages = buildDifferentialHistory(tokens)
      const partitions = everyContiguousPartition(messages).filter(
        isSdkResetFramedPartition,
      )
      const partition = partitions[partitionSeed % partitions.length]!
      const referenceSnapshots = recomputedSnapshots([], partition)

      for (const syncMode of [`eager`, `on-demand`, `progressive`] as const) {
        const direct = await runTrace(
          `direct-differential-${syncMode}`,
          syncMode,
          [],
          partition,
        )
        const persisted = await runPersistedTrace(
          `persisted-differential-${syncMode}`,
          syncMode,
          partition,
        )
        const query = await runQueryTrace(
          `query-differential-${syncMode}`,
          partition,
        )

        expect(direct.snapshots).toEqual(referenceSnapshots)
        expect(persisted.snapshots).toEqual(referenceSnapshots)
        expect(query.snapshots).toEqual(referenceSnapshots)
        expect(persisted.rows).toEqual(direct.rows)
        expect(query.rows).toEqual(direct.rows)
        expect(persisted.status).toBe(direct.status)
        expect(query.status).toBe(`ready`)
        expect(persisted.resume).toEqual(direct.resume)
        expect(persisted.durableRows).toEqual(direct.rows)
        expect(persisted.durableResume).toEqual(direct.resume)
        expect(persisted.persistenceCommits).toBeGreaterThan(0)
      }
    },
    30_000,
  )

  it(`retains a wrong intermediate publication even when the final read repairs it`, async () => {
    const trace = createOracleCollection(
      `publication-recorder-control`,
      `eager`,
      createMetadata(new Map()).api,
    )
    trace.subscriber([change(`insert`, 1, `old`), upToDate])
    const observed = observePublications(trace.collection)
    try {
      observed.record(`before`)
      trace.subscriber([change(`update`, 1, `wrong`), upToDate])
      trace.subscriber([change(`update`, 1, `correct`), upToDate])
      observed.record(`final`)
      expect(rowsFromCollection(trace.collection)).toEqual([
        [1, `correct`, `stable-1`],
      ])
      expect(observed.entries[0]!.rows).toEqual([[1, `old`, `stable-1`]])
      expect(
        observed.entries.some(
          ({ cut, rows }) => cut === `event` && rows[0]?.[1] === `wrong`,
        ),
      ).toBe(true)
      expect(() =>
        expectWholePublications(observed.entries, [
          [[1, `old`, `stable-1`]],
          [[1, `correct`, `stable-1`]],
        ]),
      ).toThrow()
      expectWholePublications(observed.entries, [
        [[1, `old`, `stable-1`]],
        [[1, `wrong`, `stable-1`]],
        [[1, `correct`, `stable-1`]],
      ])
    } finally {
      observed.stop()
      await trace.collection.cleanup()
    }
  })

  it(`checks an authored HTTP transcript and separate complete Query snapshots`, async () => {
    const { ShapeStream: RealShapeStream } = await vi.importActual<{
      ShapeStream: typeof ShapeStream
    }>(`@electric-sql/client`)
    const ready: Message<OracleRow> = {
      headers: { control: `up-to-date`, global_last_seen_lsn: `2` },
    }
    const authored: Array<Array<Message<OracleRow>>> = [
      [
        change(`insert`, 1, `old`),
        { headers: { control: `up-to-date`, global_last_seen_lsn: `1` } },
      ],
      [mustRefetch],
      [
        change(`insert`, 2, `replacement`),
        subsetEnd,
        change(`insert`, 3, `after-control`),
        ready,
      ],
    ]
    // These complete snapshots are authored directly, not computed by either
    // reference reducer or from any adapter result. A post-control row belongs
    // to the same delivered callback's atomic publication.
    const complete: TraceResult[`snapshots`] = [
      [[1, `old`, `stable-1`]],
      [[1, `old`, `stable-1`]],
      [
        [2, `replacement`, `stable-2`],
        [3, `after-control`, `stable-3`],
      ],
    ]
    const controller = new AbortController()
    const headers = {
      'electric-handle': `authored-old`,
      'electric-offset': `1_0`,
      // Without this completion header the SDK can prefetch the next chunk;
      // a positional mock-response queue would not describe the live request.
      'electric-up-to-date': `true`,
      'electric-schema': JSON.stringify({
        id: { type: `int4` },
        name: { type: `text` },
        stable: { type: `text` },
      }),
    }
    const wire = (messages: Array<Message<OracleRow>>) =>
      JSON.stringify(
        messages.map((message) =>
          `value` in message
            ? {
                ...message,
                value: { ...message.value, id: String(message.value.id) },
              }
            : message,
        ),
      )
    const responses = [
      new Response(wire(authored[0]!), { headers }),
      new Response(wire(authored[1]!), {
        status: 409,
        headers: { 'electric-handle': `authored-new` },
      }),
      new Response(wire(authored[2]!), {
        headers: {
          ...headers,
          'electric-handle': `authored-new`,
          'electric-offset': `2_0`,
          'electric-cursor': `1`,
        },
      }),
    ]
    const received: Array<Array<Message<OracleRow>>> = []
    const stream = new RealShapeStream<OracleRow>({
      url: `http://test-url/v1/authored-publication-transcript`,
      params: { table: `rows` },
      signal: controller.signal,
      fetchClient: () => {
        const response = responses.shift()
        if (response) return Promise.resolve(response)
        return new Promise<Response>((_resolve, reject) => {
          if (controller.signal.aborted) reject(controller.signal.reason)
          else
            controller.signal.addEventListener(
              `abort`,
              () => reject(controller.signal.reason),
              { once: true },
            )
        })
      },
    })
    const unsubscribe = stream.subscribe((messages) => {
      received.push(structuredClone(messages))
    })
    try {
      await vi.waitFor(() =>
        expect(
          received,
          JSON.stringify({ received, remainingResponses: responses.length }),
        ).toHaveLength(3),
      )
      expect(received).toEqual(authored)
      expect(isSdkResetFramedPartition(received)).toBe(true)
      // This validates this installed SDK's controlled-HTTP antecedent only.
      // It is not proof that all servers or SSE streams emit this transcript.
      for (const mode of [`eager`, `on-demand`, `progressive`] as const) {
        const direct = await runTrace(
          `authored-direct-${mode}`,
          mode,
          [],
          structuredClone(received),
        )
        const persisted = await runPersistedTrace(
          `authored-persisted-${mode}`,
          mode,
          structuredClone(received),
          complete,
        )
        expect(direct.snapshots).toEqual(complete)
        expect(persisted.snapshots).toEqual(complete)
        expect(persisted.durableRows).toEqual(complete[2])
      }
      const query = await runQueryTrace(
        `authored-query`,
        structuredClone(received),
        complete,
      )
      expect(query.snapshots).toEqual(complete)
    } finally {
      unsubscribe()
      controller.abort()
    }
  })

  fcTest.prop(
    [
      fc.integer({ min: 1, max: 20 }),
      fc.string({ maxLength: 8 }),
      fc.string({ maxLength: 8 }),
    ],
    { numRuns: 20 },
  )(
    `generated invalid resume transitions fail under every batch partition`,
    async (id, completeName, partialName) => {
      const messages = [
        change(`delete`, id, completeName),
        change(`update`, id, partialName),
        upToDate,
      ]

      for (const syncMode of [`eager`, `progressive`] as const) {
        for (const removal of [`delete`, `move-out`] as const) {
          const removed =
            removal === `delete`
              ? messages[0]!
              : ({
                  headers: {
                    event: `move-out`,
                    patterns: [{ pos: 0, value: `left` }],
                  },
                } as Message<OracleRow>)
          for (const [partitionId, partition] of everyContiguousPartition([
            removed,
            ...messages.slice(1),
          ]).entries()) {
            const metadata = createMetadata(resumeState())
            const trace = createOracleCollection(
              `generated-invalid-${syncMode}-${id}-${partitionId}`,
              syncMode,
              metadata.api,
            )
            const inserted = change(`insert`, id, completeName)
            trace.subscriber([
              { ...inserted, headers: { ...inserted.headers, tags: [`left`] } },
              upToDate,
            ])
            for (const batch of partition) trace.subscriber(batch)

            expect(trace.collection.status).toBe(`error`)
            expect(trace.collection.get(id)).toEqual(
              expect.objectContaining({ stable: `stable-${id}` }),
            )
            expect(metadata.state.get(`electric:resume`)).toEqual(
              expect.objectContaining({ kind: `reset` }),
            )
            await trace.collection.cleanup()
          }
        }
      }
    },
  )

  for (const syncMode of [`eager`, `progressive`] as const) {
    it(`rejects unseen resumed updates and recovers on the next ${syncMode} lifecycle`, async () => {
      const metadata = createMetadata(resumeState())
      const old = createOracleCollection(
        `invalid-${syncMode}-resume`,
        syncMode,
        metadata.api,
      )

      old.subscriber([change(`update`, 1, `partial`)])
      expect(old.collection.status).toBe(`error`)
      expect(old.collection.has(1)).toBe(false)
      expect(old.unsubscribe).toHaveBeenCalledOnce()
      expect(metadata.state.get(`electric:resume`)).toEqual(
        expect.objectContaining({ kind: `reset` }),
      )

      old.subscriber([change(`insert`, 1, `old generation`), upToDate])
      expect(old.collection.has(1)).toBe(false)
      expect(metadata.state.get(`electric:resume`)).toEqual(
        expect.objectContaining({ kind: `reset` }),
      )
      await old.collection.cleanup()

      const fresh = createOracleCollection(
        `fresh-${syncMode}-snapshot`,
        syncMode,
        metadata.api,
      )
      fresh.subscriber([change(`insert`, 1, `complete snapshot`), upToDate])

      expect(fresh.collection.status).toBe(`ready`)
      expect(fresh.collection.get(1)?.name).toBe(`complete snapshot`)
      expect(metadata.state.get(`electric:resume`)).toEqual(
        expect.objectContaining({ kind: `resume`, offset: `20_0` }),
      )
      await fresh.collection.cleanup()
    })

    it(`treats delete then update as an invalid ${syncMode} resume`, async () => {
      const metadata = createMetadata(resumeState())
      const trace = createOracleCollection(
        `delete-update-${syncMode}-resume`,
        syncMode,
        metadata.api,
      )

      trace.subscriber([
        change(`insert`, 1, `seen`),
        change(`delete`, 1, `seen`),
        change(`update`, 1, `partial`),
      ])

      expect(trace.collection.status).toBe(`error`)
      expect(trace.collection.has(1)).toBe(false)
      expect(metadata.state.get(`electric:resume`)).toEqual(
        expect.objectContaining({ kind: `reset` }),
      )
      await trace.collection.cleanup()
    })

    it(`rejects delete then update across every ${syncMode} resume partition`, async () => {
      const messages = [
        change(`delete`, 1, `complete`),
        change(`update`, 1, `partial`),
        upToDate,
      ]

      for (const [partitionId, partition] of everyContiguousPartition(
        messages,
      ).entries()) {
        const metadata = createMetadata(resumeState())
        const trace = createOracleCollection(
          `invalid-partition-${syncMode}-${partitionId}`,
          syncMode,
          metadata.api,
        )
        trace.subscriber([change(`insert`, 1, `complete`), upToDate])
        for (const batch of partition) trace.subscriber(batch)

        expect(trace.collection.status).toBe(`error`)
        expect(trace.collection.get(1)).toEqual(
          expect.objectContaining({ stable: `stable-1` }),
        )
        expect(metadata.state.get(`electric:resume`)).toEqual(
          expect.objectContaining({ kind: `reset` }),
        )
        await trace.collection.cleanup()
      }
    })
  }

  it(`keeps stream cleanup and stale callbacks scoped to their lifecycle`, async () => {
    const subscribers: Array<(messages: Array<Message<OracleRow>>) => void> = []
    const unsubscribes = [vi.fn(), vi.fn()]
    mockSubscribe.mockImplementation((callback) => {
      const index = subscribers.length
      subscribers.push(callback)
      return unsubscribes[index]!
    })
    const options = electricCollectionOptions<OracleRow>({
      id: `reused-sync-config`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      getKey: (row) => row.id,
      startSync: true,
    })
    const createLifecycle = (id: string) => {
      const metadata = createMetadata(resumeState())
      const lifecycleSync = options.sync
      return createCollection({
        ...options,
        id,
        sync: {
          ...lifecycleSync,
          sync: (params: Parameters<typeof lifecycleSync.sync>[0]) =>
            lifecycleSync.sync({ ...params, metadata: metadata.api }),
        },
      })
    }

    const oldCollection = createLifecycle(`old-sync-lifecycle`)
    const currentCollection = createLifecycle(`current-sync-lifecycle`)

    subscribers[0]!([change(`insert`, 1, `first row`), upToDate])
    subscribers[1]!([change(`insert`, 2, `second row`), upToDate])
    expect(oldCollection.get(1)?.name).toBe(`first row`)
    expect(currentCollection.get(2)?.name).toBe(`second row`)
    subscribers[0]!([change(`update`, 1, `first row updated`), upToDate])
    const currentMatch = currentCollection.utils.awaitMatch(
      (message) => `value` in message && message.value.id === 3,
      100,
    )
    const currentTxid = currentCollection.utils.awaitTxId(42, 100)
    const currentSnapshotTxid = currentCollection.utils.awaitTxId(50, 100)
    let currentMatchResolved = false
    let currentTxidResolved = false
    let currentSnapshotTxidResolved = false
    void currentMatch.then(() => {
      currentMatchResolved = true
    })
    void currentTxid.then(() => {
      currentTxidResolved = true
    })
    void currentSnapshotTxid.then(() => {
      currentSnapshotTxidResolved = true
    })
    subscribers[0]!([
      change(`insert`, 3, `wrong lifecycle`),
      {
        headers: {
          control: `snapshot-end`,
          xmin: `100`,
          xmax: `150`,
          xip_list: [],
        },
      },
      { headers: { control: `up-to-date`, txids: [42] } },
    ])
    await Promise.resolve()
    expect(currentMatchResolved).toBe(false)
    expect(currentTxidResolved).toBe(false)
    expect(currentSnapshotTxidResolved).toBe(false)

    await oldCollection.cleanup()

    expect(unsubscribes[0]).toHaveBeenCalledOnce()
    expect(unsubscribes[1]).not.toHaveBeenCalled()

    subscribers[0]!([change(`update`, 1, `stale`)])
    expect(unsubscribes[1]).not.toHaveBeenCalled()
    subscribers[1]!([
      change(`insert`, 3, `still live`),
      {
        headers: {
          control: `snapshot-end`,
          xmin: `100`,
          xmax: `150`,
          xip_list: [],
        },
      },
      { headers: { control: `up-to-date`, txids: [42] } },
    ])
    await expect(currentMatch).resolves.toBe(true)
    await expect(currentTxid).resolves.toBe(true)
    await expect(currentSnapshotTxid).resolves.toBe(true)
    expect(currentCollection.get(3)?.name).toBe(`still live`)
    await currentCollection.cleanup()
    expect(unsubscribes[1]).toHaveBeenCalledOnce()
  })

  it(`binds sync metadata import and export to the receiving collection`, async () => {
    const subscribers: Array<(messages: Array<Message<OracleRow>>) => void> = []
    mockSubscribe.mockImplementation((callback) => {
      subscribers.push(callback)
      return vi.fn()
    })
    const options = electricCollectionOptions<OracleRow>({
      id: `shared-metadata-config`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      getKey: (row) => row.id,
      startSync: true,
    })
    const first = createCollection({ ...options, id: `metadata-first` })
    const second = createCollection({ ...options, id: `metadata-second` })

    subscribers[0]!([{ headers: { control: `up-to-date`, txids: [11] } }])
    subscribers[1]!([{ headers: { control: `up-to-date`, txids: [22] } }])

    expect(first.config.sync.exportSyncMeta?.()).toMatchObject({
      version: 1,
      seenTxids: [11],
    })
    expect(second.config.sync.exportSyncMeta?.()).toMatchObject({
      version: 1,
      seenTxids: [22],
    })

    const importedResume = {
      kind: `resume` as const,
      requiresTagState: false,
      offset: `7_0` as const,
      handle: `shape-7`,
      shapeId,
      updatedAt: 7,
    }
    first.config.sync.importSyncMeta?.({
      version: 1,
      resume: importedResume,
      seenTxids: [99],
    })

    await expect(first.utils.awaitTxId(99, 50)).resolves.toBe(true)
    await expect(second.utils.awaitTxId(99, 10)).rejects.toThrow()
    expect(first.config.sync.exportSyncMeta?.()).toEqual({
      version: 1,
      resume: importedResume,
      seenTxids: [99],
    })
    expect(second.config.sync.exportSyncMeta?.()).toMatchObject({
      version: 1,
      seenTxids: [22],
    })
    expect(second.config.sync.exportSyncMeta?.()).not.toMatchObject({
      resume: importedResume,
    })

    const third = createCollection({ ...options, id: `metadata-third` })
    await expect(third.utils.awaitTxId(99, 10)).rejects.toThrow()
    expect(third.config.sync.exportSyncMeta?.()).not.toMatchObject({
      resume: importedResume,
    })

    await first.cleanup()
    await second.cleanup()
    await third.cleanup()
  })

  it(`consumes raw sync metadata when the next collection is materialized`, async () => {
    mockSubscribe.mockImplementation(() => vi.fn())
    const options = electricCollectionOptions<OracleRow>({
      id: `seeded-metadata-config`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      getKey: (row) => row.id,
      startSync: true,
    })
    const importedResume = {
      kind: `resume` as const,
      requiresTagState: false,
      offset: `8_0` as const,
      handle: `shape-8`,
      shapeId,
      updatedAt: 8,
    }
    options.sync.importSyncMeta?.({
      version: 1,
      resume: importedResume,
      seenTxids: [55],
    })

    const seeded = createCollection({ ...options, id: `metadata-seeded` })
    await expect(seeded.utils.awaitTxId(55, 50)).resolves.toBe(true)
    expect(seeded.config.sync.exportSyncMeta?.()).toMatchObject({
      resume: importedResume,
      seenTxids: [55],
    })

    const unseeded = createCollection({ ...options, id: `metadata-unseeded` })
    await expect(unseeded.utils.awaitTxId(55, 10)).rejects.toThrow()
    expect(unseeded.config.sync.exportSyncMeta?.()).toEqual({
      version: 1,
      seenTxids: [],
    })

    await seeded.cleanup()
    await unseeded.cleanup()
  })

  it(`binds imported evidence and pending matches before lazy sync starts`, async () => {
    let subscriber!: (messages: Array<Message<OracleRow>>) => void
    mockSubscribe.mockImplementation((callback) => {
      subscriber = callback
      return vi.fn()
    })
    const options = electricCollectionOptions<OracleRow>({
      id: `lazy-bound-evidence`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      getKey: (row) => row.id,
      startSync: false,
    })
    const collection = createCollection(options)
    const importedResume = {
      kind: `resume` as const,
      requiresTagState: false,
      offset: `9_0` as const,
      handle: `shape-9`,
      shapeId,
      updatedAt: 9,
    }
    collection.config.sync.importSyncMeta?.({
      version: 1,
      resume: importedResume,
      seenTxids: [33],
    })

    await expect(collection.utils.awaitTxId(33, 20)).resolves.toBe(true)
    const pendingMatch = collection.utils.awaitMatch(
      (message) => `value` in message && message.value.id === 5,
      100,
    )
    const pendingTxid = collection.utils.awaitTxId(34, 100)
    const preload = collection.preload()
    expect(vi.mocked(ShapeStream).mock.calls.at(-1)?.[0]).toMatchObject({
      offset: `9_0`,
      handle: `shape-9`,
    })
    const evidenceChange = change(`insert`, 5, `matched after start`)
    subscriber([
      {
        ...evidenceChange,
        headers: { operation: `insert`, txids: [34] },
      },
      upToDate,
    ])

    await expect(pendingMatch).resolves.toBe(true)
    await expect(pendingTxid).resolves.toBe(true)
    await preload
    expect(collection.get(5)?.name).toBe(`matched after start`)
    await collection.cleanup()
  })

  it(`keeps descriptor utilities captured before collection startup live`, async () => {
    let subscriber!: (messages: Array<Message<OracleRow>>) => void
    mockSubscribe.mockImplementation((callback) => {
      subscriber = callback
      return vi.fn()
    })
    const options = electricCollectionOptions<OracleRow>({
      id: `captured-descriptor-utilities`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      getKey: (row) => row.id,
      startSync: false,
    })
    const { awaitMatch, awaitTxId } = options.utils
    const collection = createCollection(options)
    const pendingMatch = awaitMatch(
      (message) => `value` in message && message.value.id === 77,
      100,
    )
    const pendingTxid = awaitTxId(77, 100)

    const preload = collection.preload()
    const evidenceChange = change(`insert`, 77, `captured utilities`)
    subscriber([
      {
        ...evidenceChange,
        headers: { operation: `insert`, txids: [77] },
      },
      upToDate,
    ])

    await expect(pendingMatch).resolves.toBe(true)
    await expect(pendingTxid).resolves.toBe(true)
    await preload
    await collection.cleanup()
  })

  it(`retires a pending pre-start match when a lazy collection is cleaned up`, async () => {
    mockSubscribe.mockImplementation(() => vi.fn())
    const collection = createCollection(
      electricCollectionOptions<OracleRow>({
        id: `lazy-pre-start-cleanup`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        getKey: (row) => row.id,
        startSync: false,
      }),
    )
    const pendingMatch = collection.utils.awaitMatch(() => false, 100)

    await collection.cleanup()

    await expect(pendingMatch).rejects.toThrow(/aborted/i)
    expect(mockSubscribe).not.toHaveBeenCalled()
  })

  it(`retires pre-start waiters when persisted metadata startup is interrupted`, async () => {
    const metadataStarted = createDeferred<void>()
    const metadataGate = createDeferred<void>()
    const adapter = createPersistedAdapter(new Map(), new Map())
    adapter.loadCollectionMetadata = async () => {
      metadataStarted.resolve()
      await metadataGate.promise
      return []
    }
    const collection = createCollection(
      persistedCollectionOptions<
        OracleRow,
        string | number,
        never,
        ElectricCollectionUtils<OracleRow>
      >({
        ...electricCollectionOptions<OracleRow>({
          id: `persisted-startup-waiter-cleanup`,
          shapeOptions: {
            url: `http://test-url`,
            params: { table: `test_table` },
          },
          getKey: (row) => row.id,
          startSync: false,
        }),
        persistence: { adapter },
      }),
    )
    const pendingMatch = collection.utils.awaitMatch(() => false, 100)
    const pendingTxid = collection.utils.awaitTxId(702, 100)
    const preload = expect(collection.preload()).rejects.toMatchObject({
      name: `AbortError`,
    })
    await metadataStarted.promise
    const matchOutcome = expect(pendingMatch).rejects.toThrow(/aborted/i)
    const txidOutcome = expect(pendingTxid).rejects.toThrow(/aborted/i)

    await collection.cleanup()

    await matchOutcome
    await txidOutcome
    expect(mockSubscribe).not.toHaveBeenCalled()
    metadataGate.resolve()
    await preload
  })

  it(`retires pre-start waiters through automatic collection GC`, async () => {
    const metadataGate = createDeferred<void>()
    const adapter = createPersistedAdapter(new Map(), new Map())
    adapter.loadCollectionMetadata = vi.fn(async () => {
      await metadataGate.promise
      return []
    })
    const collection = createCollection(
      persistedCollectionOptions<
        OracleRow,
        string | number,
        never,
        ElectricCollectionUtils<OracleRow>
      >({
        ...electricCollectionOptions<OracleRow>({
          id: `persisted-gc-waiter-cleanup`,
          shapeOptions: {
            url: `http://test-url`,
            params: { table: `test_table` },
          },
          getKey: (row) => row.id,
          startSync: false,
          gcTime: 10,
        }),
        persistence: { adapter },
      }),
    )
    const pendingMatch = collection.utils.awaitMatch(() => false, 5000)
    const pendingTxid = collection.utils.awaitTxId(703, 5000)
    // A pending preload owns retention; exercise unowned sync for automatic GC.
    collection.startSyncImmediate()
    await vi.waitFor(
      () => expect(adapter.loadCollectionMetadata).toHaveBeenCalledOnce(),
      { interval: 1, timeout: 250 },
    )
    const subscription = collection.subscribeChanges(() => {})
    const matchOutcome = pendingMatch.catch((error: unknown) => error)
    const txidOutcome = pendingTxid.catch((error: unknown) => error)

    subscription.unsubscribe()
    await vi.waitFor(() => expect(collection.status).toBe(`cleaned-up`), {
      interval: 10,
      timeout: 1500,
    })
    const pendingSentinel = Symbol(`pending`)
    const matchResult = await Promise.race([
      matchOutcome,
      new Promise((resolve) => setTimeout(() => resolve(pendingSentinel), 50)),
    ])
    const txidResult = await Promise.race([
      txidOutcome,
      new Promise((resolve) => setTimeout(() => resolve(pendingSentinel), 50)),
    ])

    expect(matchResult).toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/aborted/i),
      }),
    )
    expect(txidResult).toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/aborted/i),
      }),
    )
    expect(mockSubscribe).not.toHaveBeenCalled()
    metadataGate.resolve()
  })

  it(`retires every pending waiter when its collection lifecycle is cleaned up`, async () => {
    mockSubscribe.mockImplementation(() => vi.fn())
    const lazy = createCollection(
      electricCollectionOptions<OracleRow>({
        id: `lazy-waiter-cleanup`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        getKey: (row) => row.id,
        startSync: false,
      }),
    )
    const lazyTxid = lazy.utils.awaitTxId(700, 100)
    await lazy.cleanup()
    await expect(lazyTxid).rejects.toThrow(/aborted/i)

    const active = createOracleCollection(
      `active-waiter-cleanup`,
      `eager`,
      createMetadata(new Map()).api,
    )
    const activeMatch = active.collection.utils.awaitMatch(() => false, 100)
    const activeTxid = active.collection.utils.awaitTxId(701, 100)
    await active.collection.cleanup()

    await expect(activeMatch).rejects.toThrow(/aborted/i)
    await expect(activeTxid).rejects.toThrow(/aborted/i)
  })

  it(`settles waiters according to whether evidence or cleanup wins`, async () => {
    for (const cleanupWins of [true, false]) {
      const trace = createOracleCollection(
        `waiter-race-${cleanupWins}`,
        `eager`,
        createMetadata(new Map()).api,
      )
      const pendingMatch = trace.collection.utils.awaitMatch(
        (message) => `value` in message && message.value.id === 91,
        100,
      )
      const pendingTxid = trace.collection.utils.awaitTxId(91, 100)
      const evidenceChange = change(`insert`, 91, `race winner`)
      const evidence: Array<Message<OracleRow>> = [
        {
          ...evidenceChange,
          headers: { operation: `insert`, txids: [91] },
        },
        upToDate,
      ]

      if (cleanupWins) {
        await trace.collection.cleanup()
        trace.subscriber(evidence)
        await expect(pendingMatch).rejects.toThrow(/aborted/i)
        await expect(pendingTxid).rejects.toThrow(/aborted/i)
        expect(trace.collection.get(91)).toBeUndefined()
      } else {
        trace.subscriber(evidence)
        await trace.collection.cleanup()
        await expect(pendingMatch).resolves.toBe(true)
        await expect(pendingTxid).resolves.toBe(true)
      }
    }
  })

  it(`keeps committed match evidence across newer writer batches`, async () => {
    const metadata = createMetadata(new Map())
    const trace = createOracleCollection(
      `await-match-batch-generation`,
      `eager`,
      metadata.api,
    )

    trace.subscriber([change(`insert`, 1, `old batch`), upToDate])
    trace.subscriber([change(`insert`, 2, `current batch`), upToDate])

    await expect(
      trace.collection.utils.awaitMatch(
        (message) => `value` in message && message.value.name === `old batch`,
        20,
      ),
    ).resolves.toBe(true)
    await trace.collection.cleanup()
  })

  it(`keeps committed match evidence across callbacks with no new data`, async () => {
    const trace = createOracleCollection(
      `await-match-neutral-callback`,
      `eager`,
      createMetadata(new Map()).api,
    )

    trace.subscriber([change(`insert`, 1, `committed`), upToDate])
    trace.subscriber([
      {
        headers: {
          control: `snapshot-end`,
          xmin: `100`,
          xmax: `150`,
          xip_list: [],
        },
      },
    ])
    trace.subscriber([])

    await expect(
      trace.collection.utils.awaitMatch(
        (message) => `value` in message && message.value.id === 1,
        20,
      ),
    ).resolves.toBe(true)
    await trace.collection.cleanup()
  })

  it(`clears committed match evidence when the stream must refetch`, async () => {
    const trace = createOracleCollection(
      `await-match-reset-generation`,
      `eager`,
      createMetadata(new Map()).api,
    )

    trace.subscriber([change(`insert`, 1, `old generation`), upToDate])
    trace.subscriber([mustRefetch, upToDate])

    await expect(
      trace.collection.utils.awaitMatch(
        (message) =>
          `value` in message && message.value.name === `old generation`,
        20,
      ),
    ).rejects.toThrow(/Timeout waiting for custom match function/)
    await trace.collection.cleanup()
  })

  const reentryHistory = fc.record({
    txid: fc.integer({ min: 1, max: 10000 }),
    names: fc.array(fc.string({ maxLength: 8 }), {
      minLength: 1,
      maxLength: 5,
    }),
    trigger: fc.nat({ max: 4 }),
  })

  async function runReentryHistory(history: {
    txid: number
    names: Array<string>
    trigger: number
  }) {
    // Same ownership law, with retirement either outside or inside a callback.
    // Previously the grammar only retired a session between complete callbacks.
    for (const insideCallback of [false, true]) {
      const subscribers: Array<(messages: Array<Message<OracleRow>>) => void> =
        []
      mockSubscribe.mockImplementation((callback) => {
        subscribers.push(callback)
        return vi.fn()
      })
      const collection = createCollection(
        electricCollectionOptions<OracleRow>({
          shapeOptions: {
            url: `http://test-url`,
            params: { table: `test_table` },
          },
          getKey: (row) => row.id,
          startSync: true,
        }),
      )
      const triggerId = (history.trigger % history.names.length) + 1
      let retired = false
      let cleanup: Promise<void> | undefined
      let replacementVisits = 0
      let replacementOutcome: Promise<unknown> | undefined
      const restart = () => {
        retired = true
        cleanup = collection.cleanup()
        collection.startSyncImmediate()
        replacementOutcome = collection.utils
          .awaitMatch(() => {
            replacementVisits++
            return false
          })
          .catch(() => undefined)
      }
      const waiting = collection.utils.awaitMatch((message) => {
        if (
          insideCallback &&
          !retired &&
          `value` in message &&
          message.value.id === triggerId
        )
          restart()
        return false
      }, 20)
      // Observe the old waiter before any callback can retire its session.
      const oldOutcome = waiting.then(
        () => `resolved`,
        () => `rejected`,
      )
      try {
        if (!insideCallback) restart()
        const messages = history.names.map((name, index) =>
          change(`insert`, index + 1, name),
        )
        const acknowledgement: Message<OracleRow> = {
          headers: { control: `up-to-date`, txids: [history.txid] },
        }
        subscribers[0]!([...messages, acknowledgement])
        await cleanup
        expect(subscribers).toHaveLength(2)
        expect(await oldOutcome).toBe(`rejected`)
        expect(replacementVisits).toBe(0)
        // The old callback's tail is not evidence from the replacement stream.
        // This is the utility's own deadline, not a sleep used to infer readiness.
        await expect(
          collection.utils.awaitTxId(history.txid, 10),
        ).rejects.toThrow(/Timeout/)
        expect(collection.size).toBe(0)
        subscribers[1]!([...messages, acknowledgement])
        await expect(
          collection.utils.awaitTxId(history.txid, 10),
        ).resolves.toBe(true)
        expect(
          [...collection.values()].map((row) => ({
            id: row.id,
            name: row.name,
          })),
        ).toEqual(history.names.map((name, index) => ({ id: index + 1, name })))
      } finally {
        await collection.cleanup()
        await oldOutcome
        await replacementOutcome
      }
    }
  }

  fcTest.prop([reentryHistory], { seed: 42713, numRuns: oracleRuns(6) })(
    `replacement sessions reject evidence from callback reentry histories (fixed)`,
    runReentryHistory,
  )
  fcTest.prop(
    [reentryHistory],
    oraclePropertyOptions(10, `electric.match-reentry`),
  )(
    `replacement sessions reject evidence from callback reentry histories (random)`,
    runReentryHistory,
  )

  it(`does not let a committed message satisfy awaitMatch after restart`, async () => {
    const subscribers: Array<(messages: Array<Message<OracleRow>>) => void> = []
    mockSubscribe.mockImplementation((callback) => {
      subscribers.push(callback)
      return vi.fn()
    })
    const collection = createCollection(
      electricCollectionOptions<OracleRow>({
        id: `await-match-lifecycle-generation`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        getKey: (row) => row.id,
        startSync: true,
      }),
    )

    subscribers[0]!([change(`insert`, 1, `old lifecycle`), upToDate])
    await collection.cleanup()
    collection.startSyncImmediate()
    await vi.waitFor(() => expect(subscribers).toHaveLength(2))

    await expect(
      collection.utils.awaitMatch(
        (message) =>
          `value` in message && message.value.name === `old lifecycle`,
        20,
      ),
    ).rejects.toThrow(/Timeout waiting for custom match function/)
    await collection.cleanup()
  })

  for (const syncMode of [`eager`, `on-demand`, `progressive`] as const) {
    it(`does not apply an unseen ${syncMode} update after must-refetch`, async () => {
      const metadata = createMetadata(new Map())
      const trace = createOracleCollection(
        `must-refetch-unseen-${syncMode}`,
        syncMode,
        metadata.api,
      )
      trace.subscriber([change(`insert`, 1, `complete`), upToDate])

      trace.subscriber([mustRefetch, change(`update`, 1, `partial`), upToDate])

      expect(trace.collection.status).toBe(`ready`)
      expect(trace.collection.has(1)).toBe(false)
      await trace.collection.cleanup()
    })

    it(`keeps the ${syncMode} reset marker until the replacement snapshot is complete`, async () => {
      const metadata = createMetadata(resumeState())
      const trace = createOracleCollection(
        `durable-reset-${syncMode}`,
        syncMode,
        metadata.api,
      )

      trace.subscriber([mustRefetch])
      expect(metadata.state.get(`electric:resume`)).toEqual(
        expect.objectContaining({ kind: `reset` }),
      )

      trace.subscriber([change(`insert`, 1, `partial snapshot`), subsetEnd])
      expect(metadata.state.get(`electric:resume`)).toEqual(
        expect.objectContaining({ kind: `reset` }),
      )

      trace.subscriber([
        change(`update`, 2, `unseen`),
        change(`update`, 1, `complete snapshot`),
        upToDate,
      ])
      expect(trace.collection.status).toBe(`ready`)
      expect(trace.collection.get(1)).toEqual(
        expect.objectContaining({
          id: 1,
          name: `complete snapshot`,
          stable: `stable-1`,
        }),
      )
      expect(trace.collection.has(2)).toBe(false)
      expect(metadata.state.get(`electric:resume`)).toEqual(
        expect.objectContaining({ kind: `resume`, offset: `20_0` }),
      )
      await trace.collection.cleanup()
    })
  }

  it(`does not let an older applied receipt finish a newer reset`, async () => {
    const metadata = createMetadata(resumeState())
    const trace = createOracleCollection(
      `overlapping-reset-generations`,
      `eager`,
      metadata.api,
    )
    const persistence = createDeferred<void>()
    const transaction = createTransaction({
      mutationFn: () => persistence.promise,
    })

    trace.subscriber([
      mustRefetch,
      change(`insert`, 1, `first replacement`),
      subsetEnd,
    ])
    transaction.mutate(() =>
      trace.collection.insert({
        id: 99,
        name: `optimistic`,
        stable: `stable-99`,
      }),
    )
    trace.subscriber([upToDate])
    trace.subscriber([mustRefetch])
    await Promise.resolve()

    trace.subscriber([change(`update`, 2, `unseen`), upToDate])

    expect(trace.collection.status).not.toBe(`error`)
    expect(trace.collection.has(2)).toBe(false)

    persistence.resolve()
    await transaction.isPersisted.promise
    await trace.collection.cleanup()
  })

  it(`waits for a deferred applied receipt before publishing readiness`, async () => {
    const metadata = createMetadata(new Map())
    const trace = createOracleCollection(
      `deferred-applied-receipt`,
      `eager`,
      metadata.api,
    )
    const persistence = createDeferred<void>()
    const transaction = createTransaction({
      mutationFn: () => persistence.promise,
    })
    transaction.mutate(() =>
      trace.collection.insert({
        id: 99,
        name: `optimistic`,
        stable: `stable-99`,
      }),
    )

    trace.subscriber([change(`insert`, 1, `synced`), upToDate])
    await Promise.resolve()

    expect(trace.collection.status).toBe(`loading`)
    expect(trace.collection.has(1)).toBe(false)

    persistence.resolve()
    await transaction.isPersisted.promise
    await trace.collection.stateWhenReady()

    expect(trace.collection.status).toBe(`ready`)
    expect(trace.collection.get(1)).toEqual(
      expect.objectContaining({ stable: `stable-1` }),
    )
    await trace.collection.cleanup()
  })

  it(`does not publish readiness after a parked receipt is rejected by cleanup`, async () => {
    const metadata = createMetadata(new Map())
    const trace = createOracleCollection(
      `rejected-applied-receipt`,
      `eager`,
      metadata.api,
    )
    const persistence = createDeferred<void>()
    const transaction = createTransaction({
      mutationFn: () => persistence.promise,
    })
    transaction.mutate(() =>
      trace.collection.insert({
        id: 99,
        name: `optimistic`,
        stable: `stable-99`,
      }),
    )
    trace.subscriber([change(`insert`, 1, `synced`), upToDate])
    await Promise.resolve()
    expect(trace.collection.status).toBe(`loading`)

    await trace.collection.cleanup()
    persistence.resolve()
    await transaction.isPersisted.promise
    await Promise.resolve()

    expect(trace.collection.status).toBe(`cleaned-up`)
    expect(trace.collection.has(1)).toBe(false)
  })

  it(`accepts partial resumed updates for rows restored by persistence`, async () => {
    let subscriber!: (messages: Array<Message<OracleRow>>) => void
    mockSubscribe.mockImplementationOnce((callback) => {
      subscriber = callback
      return vi.fn()
    })
    const collectionMetadata = new Map(resumeState())
    const persistedRows = new Map<string | number, OracleRow>([
      [
        1,
        {
          id: 1,
          name: `persisted`,
          stable: `stable-1`,
        },
      ],
    ])
    const electricOptions = electricCollectionOptions<OracleRow>({
      id: `persisted-resume-oracle`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      syncMode: `progressive`,
      getKey: (row) => row.id,
      startSync: true,
    })
    const collection = createCollection(
      persistedCollectionOptions<
        OracleRow,
        string | number,
        never,
        ElectricCollectionUtils<OracleRow>
      >({
        ...electricOptions,
        persistence: {
          adapter: createPersistedAdapter(collectionMetadata, persistedRows),
        },
      }),
    )

    collection.startSyncImmediate()
    await collection._sync.loadSubset({ limit: 10 })
    expect(collection.get(1)).toEqual(
      expect.objectContaining({ name: `persisted`, stable: `stable-1` }),
    )
    expect(vi.mocked(ShapeStream).mock.calls.at(-1)?.[0]).toMatchObject({
      offset: `10_0`,
      handle: `shape-1`,
    })

    subscriber([change(`update`, 1, `resumed update`), upToDate])
    await vi.waitFor(() => expect(collection.status).toBe(`ready`))

    expect(collection.get(1)).toEqual(
      expect.objectContaining({
        name: `resumed update`,
        stable: `stable-1`,
      }),
    )
    await vi.waitFor(() => {
      expect(persistedRows.get(1)).toEqual(
        expect.objectContaining({
          name: `resumed update`,
          stable: `stable-1`,
        }),
      )
    })
    await collection.cleanup()
  })

  it(`buffers resumed updates that arrive while persisted rows are hydrating`, async () => {
    let subscriber: ((messages: Array<Message<OracleRow>>) => void) | undefined
    mockSubscribe.mockImplementationOnce((callback) => {
      subscriber = callback
      return vi.fn()
    })
    const hydration = createDeferred<void>()
    const collectionMetadata = new Map(resumeState())
    const persistedRows = new Map<string | number, OracleRow>([
      [
        1,
        {
          id: 1,
          name: `persisted`,
          stable: `stable-1`,
        },
      ],
    ])
    const electricOptions = electricCollectionOptions<OracleRow>({
      id: `concurrent-persisted-resume-oracle`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      syncMode: `progressive`,
      getKey: (row) => row.id,
      startSync: true,
    })
    const collection = createCollection(
      persistedCollectionOptions<
        OracleRow,
        string | number,
        never,
        ElectricCollectionUtils<OracleRow>
      >({
        ...electricOptions,
        persistence: {
          adapter: createPersistedAdapter(
            collectionMetadata,
            persistedRows,
            hydration.promise,
          ),
        },
      }),
    )

    collection.startSyncImmediate()
    await vi.waitFor(() => expect(subscriber).toBeTypeOf(`function`))
    expect(collection.status).not.toBe(`error`)
    subscriber!([change(`update`, 1, `concurrent update`), upToDate])

    expect(collection.status).not.toBe(`error`)
    hydration.resolve()
    await vi.waitFor(() => expect(collection.status).toBe(`ready`))
    expect(collection.get(1)).toEqual(
      expect.objectContaining({
        name: `concurrent update`,
        stable: `stable-1`,
      }),
    )
    await collection.cleanup()
  })

  it(`rehydrates persisted rows and resume metadata after cleanup and restart`, async () => {
    const subscribers: Array<(messages: Array<Message<OracleRow>>) => void> = []
    mockSubscribe.mockImplementation((callback) => {
      subscribers.push(callback)
      return vi.fn()
    })
    const collectionMetadata = new Map(resumeState())
    const persistedRows = new Map<string | number, OracleRow>([
      [1, { id: 1, name: `persisted`, stable: `stable-1` }],
    ])
    const collection = createCollection(
      persistedCollectionOptions<
        OracleRow,
        string | number,
        never,
        ElectricCollectionUtils<OracleRow>
      >({
        ...electricCollectionOptions<OracleRow>({
          id: `persisted-restart-oracle`,
          shapeOptions: {
            url: `http://test-url`,
            params: { table: `test_table` },
          },
          syncMode: `progressive`,
          getKey: (row) => row.id,
          startSync: true,
        }),
        persistence: {
          adapter: createPersistedAdapter(collectionMetadata, persistedRows),
        },
      }),
    )

    collection.startSyncImmediate()
    await vi.waitFor(() => expect(collection.get(1)?.name).toBe(`persisted`))
    await vi.waitFor(() => expect(subscribers).toHaveLength(1))
    subscribers[0]!([upToDate])
    await collection.stateWhenReady()

    await collection.cleanup()
    collection.startSyncImmediate()
    await vi.waitFor(() => expect(subscribers).toHaveLength(2))
    await vi.waitFor(() => expect(collection.get(1)?.name).toBe(`persisted`))
    expect(collectionMetadata.get(`electric:resume`)).toEqual(
      expect.objectContaining({ kind: `resume` }),
    )
    await collection.cleanup()
  })

  it(`does not let hydration from a cleaned-up lifecycle poison restart`, async () => {
    const subscribers: Array<(messages: Array<Message<OracleRow>>) => void> = []
    mockSubscribe.mockImplementation((callback) => {
      subscribers.push(callback)
      return vi.fn()
    })
    const firstHydration = createDeferred<void>()
    const collectionMetadata = new Map(resumeState())
    const persistedRows = new Map<string | number, OracleRow>([
      [1, { id: 1, name: `current`, stable: `stable-1` }],
    ])
    const adapter = createPersistedAdapter(collectionMetadata, persistedRows)
    let hydrationCall = 0
    adapter.loadSubset = vi.fn(async () => {
      hydrationCall++
      if (hydrationCall === 1) {
        await firstHydration.promise
        return [
          {
            key: 1,
            value: { id: 1, name: `stale`, stable: `stable-1` },
          },
        ]
      }
      return Array.from(persistedRows, ([key, value]) => ({ key, value }))
    })
    const collection = createCollection(
      persistedCollectionOptions<
        OracleRow,
        string | number,
        never,
        ElectricCollectionUtils<OracleRow>
      >({
        ...electricCollectionOptions<OracleRow>({
          id: `persisted-stale-hydration-oracle`,
          shapeOptions: {
            url: `http://test-url`,
            params: { table: `test_table` },
          },
          syncMode: `progressive`,
          getKey: (row) => row.id,
          startSync: true,
        }),
        persistence: { adapter },
      }),
    )

    collection.startSyncImmediate()
    await vi.waitFor(() => expect(adapter.loadSubset).toHaveBeenCalledTimes(1))
    await collection.cleanup()
    collection.startSyncImmediate()
    await vi.waitFor(() => expect(subscribers).toHaveLength(2))

    firstHydration.resolve()
    await vi.waitFor(() => expect(adapter.loadSubset).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(collection.get(1)?.name).toBe(`current`))
    subscribers[1]!([upToDate])
    await collection.stateWhenReady()
    await collection.cleanup()
  })

  it(`does not hydrate persisted on-demand rows before subset demand`, async () => {
    let subscriber: ((messages: Array<Message<OracleRow>>) => void) | undefined
    mockSubscribe.mockImplementationOnce((callback) => {
      subscriber = callback
      return vi.fn()
    })
    const collectionMetadata = new Map<string, unknown>()
    const persistedRows = new Map<string | number, OracleRow>([
      [1, { id: 1, name: `persisted`, stable: `stable-1` }],
    ])
    const adapter = createPersistedAdapter(collectionMetadata, persistedRows)
    const loadSubset = vi.fn(adapter.loadSubset)
    adapter.loadSubset = loadSubset
    const electricOptions = electricCollectionOptions<OracleRow>({
      id: `persisted-on-demand-oracle`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      syncMode: `on-demand`,
      getKey: (row) => row.id,
      startSync: true,
    })
    const collection = createCollection(
      persistedCollectionOptions<
        OracleRow,
        string | number,
        never,
        ElectricCollectionUtils<OracleRow>
      >({
        ...electricOptions,
        persistence: { adapter },
      }),
    )

    collection.startSyncImmediate()
    await vi.waitFor(() => expect(subscriber).toBeTypeOf(`function`))
    subscriber!([upToDate])
    await vi.waitFor(() => expect(collection.status).toBe(`ready`))

    expect(loadSubset).not.toHaveBeenCalled()
    expect(collection.has(1)).toBe(false)
    await collection.cleanup()
  })

  it.each(
    [`reset`, `delete`, `move-out`].flatMap((removal) =>
      [`none`, `before-commit`, `after-commit`].map((acquire) => ({
        removal,
        acquire,
      })),
    ),
  )(
    `keeps removed rows unknown across $removal and subset acquisition $acquire`,
    async ({ removal, acquire }) => {
      const trace = createOracleCollection(
        `presence-${removal}-${acquire}`,
        `on-demand`,
        createMetadata(new Map()).api,
      )
      const snapshot = createDeferred<void>()
      mockStream.requestSnapshot.mockReturnValueOnce(snapshot.promise)
      let acquired: Promise<unknown> | undefined
      const request = () => {
        acquired = Promise.resolve(
          trace.collection._sync.loadSubset({
            where: new IR.Func(`eq`, [new IR.PropRef([`id`]), new IR.Value(2)]),
          }),
        )
        expect(mockStream.requestSnapshot).toHaveBeenCalledOnce()
      }
      try {
        const inserted = change(`insert`, 1, `complete`)
        trace.subscriber([
          { ...inserted, headers: { ...inserted.headers, tags: [`left`] } },
          upToDate,
        ])
        expect(trace.collection.get(1)?.stable).toBe(`stable-1`)
        const removed: Message<OracleRow> =
          removal === `reset`
            ? mustRefetch
            : removal === `delete`
              ? change(`delete`, 1, `complete`)
              : ({
                  headers: {
                    event: `move-out`,
                    patterns: [{ pos: 0, value: `left` }],
                  },
                } as Message<OracleRow>)
        trace.subscriber([removed])
        if (acquire === `before-commit`) request()
        trace.subscriber([subsetEnd])
        expect(trace.collection.has(1)).toBe(false)
        if (acquire === `after-commit`) request()
        snapshot.resolve()
        await acquired
        trace.subscriber([change(`update`, 1, `partial`), upToDate])
        expect(trace.collection.has(1)).toBe(false)
      } finally {
        snapshot.resolve()
        await trace.collection.cleanup()
        await acquired
      }
    },
  )

  fcTest.prop(
    [
      fc.array(
        fc.record({
          operation: fc.constantFrom<
            HistoryToken[`operation`] | `reset` | `acquire` | `commit`
          >(`insert`, `update`, `delete`, `reset`, `acquire`, `commit`),
          id: fc.integer({ min: 1, max: 3 }),
          name: fc.string({ maxLength: 8 }),
        }),
        { minLength: 1, maxLength: 40 },
      ),
    ],
    {
      numRuns: 40,
      examples: [
        [
          ([`insert`, `commit`, `reset`, `acquire`, `update`] as const).map(
            (operation) => ({ operation, id: 1, name: `` }),
          ),
        ],
      ],
    },
  )(
    `subset acquisitions preserve row validity through generated stream histories`,
    async (commands) => {
      const trace = createOracleCollection(
        `acquisition-history`,
        `on-demand`,
        createMetadata(new Map()).api,
      )
      const reference: ReferenceState = {
        committed: new Map(),
        pending: new Map(),
      }
      let acquisition = 100
      try {
        for (const command of commands) {
          if (command.operation === `acquire`) {
            // A real acquisition, not just a synthetic subset-end marker. Use a
            // fresh predicate so exact request deduplication cannot bypass it.
            await trace.collection._sync.loadSubset({
              where: new IR.Func(`eq`, [
                new IR.PropRef([`id`]),
                new IR.Value(++acquisition),
              ]),
            })
          } else {
            const message =
              command.operation === `reset`
                ? mustRefetch
                : command.operation === `commit`
                  ? subsetEnd
                  : change(
                      command.operation === `insert` &&
                        reference.pending.has(command.id)
                        ? `update`
                        : command.operation,
                      command.id,
                      command.name,
                    )
            trace.subscriber([message])
            applyReferenceBatch(reference, [message])
          }
          expect(rowsFromCollection(trace.collection)).toEqual(
            rowsFromMap(reference.committed),
          )
        }
        trace.subscriber([upToDate])
        applyReferenceBatch(reference, [upToDate])
        expect(rowsFromCollection(trace.collection)).toEqual(
          rowsFromMap(reference.committed),
        )
      } finally {
        await trace.collection.cleanup()
      }
    },
  )

  it(`applies on-demand catch-up updates to hydrated persisted rows`, async () => {
    let subscriber!: (messages: Array<Message<OracleRow>>) => void
    mockSubscribe.mockImplementationOnce((callback) => {
      subscriber = callback
      return vi.fn()
    })
    const collectionMetadata = new Map(resumeState())
    const persistedRows = new Map<string | number, OracleRow>([
      [1, { id: 1, name: `persisted`, stable: `stable-1` }],
    ])
    const collection = createCollection(
      persistedCollectionOptions<
        OracleRow,
        string | number,
        never,
        ElectricCollectionUtils<OracleRow>
      >({
        ...electricCollectionOptions<OracleRow>({
          id: `on-demand-persisted-catch-up`,
          shapeOptions: {
            url: `http://test-url`,
            params: { table: `test_table` },
          },
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          startSync: true,
        }),
        persistence: {
          adapter: createPersistedAdapter(collectionMetadata, persistedRows),
        },
      }),
    )

    collection.startSyncImmediate()
    await vi.waitFor(() => expect(subscriber).toBeTypeOf(`function`))
    await collection._sync.loadSubset({})
    subscriber([change(`update`, 1, `caught up`), upToDate])
    await vi.waitFor(() => expect(collection.status).toBe(`ready`))

    expect(collection.get(1)).toEqual(
      expect.objectContaining({ name: `caught up`, stable: `stable-1` }),
    )
    expect(collectionMetadata.get(`electric:resume`)).toEqual(
      expect.objectContaining({ kind: `resume`, offset: `20_0` }),
    )
    await collection.cleanup()
  })

  it.each([
    {
      name: `malformed`,
      seed: new Map<string, unknown>([
        [
          `electric:resume`,
          {
            kind: `resume`,
            requiresTagState: false,
            offset: 10,
            handle: `shape-1`,
            shapeId,
            updatedAt: 1,
          },
        ],
      ]),
    },
    {
      name: `reset`,
      seed: new Map<string, unknown>([
        [`electric:resume`, { kind: `reset`, updatedAt: 1 }],
      ]),
    },
    {
      name: `incompatible`,
      seed: new Map<string, unknown>([
        [
          `electric:resume`,
          {
            kind: `resume`,
            requiresTagState: false,
            offset: `10_0`,
            handle: `shape-1`,
            shapeId: `different-shape`,
            updatedAt: 1,
          },
        ],
      ]),
    },
  ])(`starts a full snapshot for $name resume metadata`, async ({ seed }) => {
    const metadata = createMetadata(seed)
    const trace = createOracleCollection(
      `non-resumable-metadata`,
      `eager`,
      metadata.api,
    )

    expect(vi.mocked(ShapeStream).mock.calls.at(-1)?.[0]).toMatchObject({
      offset: undefined,
      handle: undefined,
    })
    trace.subscriber([change(`insert`, 1, `full snapshot`), upToDate])

    expect(trace.collection.status).toBe(`ready`)
    expect(trace.collection.get(1)).toEqual(
      expect.objectContaining({ stable: `stable-1` }),
    )
    expect(metadata.state.get(`electric:resume`)).toEqual(
      expect.objectContaining({ kind: `resume`, offset: `20_0` }),
    )
    await trace.collection.cleanup()
  })

  it(`does not mix an explicit resume option with persisted metadata`, async () => {
    const metadata = createMetadata(resumeState())
    const trace = createOracleCollection(
      `explicit-resume`,
      `on-demand`,
      metadata.api,
      { handle: `explicit-handle` },
    )

    expect(vi.mocked(ShapeStream).mock.calls.at(-1)?.[0]).toMatchObject({
      offset: `now`,
      handle: `explicit-handle`,
    })
    trace.subscriber([upToDate])
    expect(trace.collection.status).toBe(`ready`)
    await trace.collection.cleanup()
  })

  it(`lets an equal-timestamp reset dominate a stale hydrated resume`, async () => {
    let subscriber!: (messages: Array<Message<OracleRow>>) => void
    mockSubscribe.mockImplementationOnce((callback) => {
      subscriber = callback
      return vi.fn()
    })
    const options = electricCollectionOptions<OracleRow>({
      id: `equal-timestamp-reset`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      getKey: (row) => row.id,
      startSync: true,
    })
    options.sync.importSyncMeta?.({
      version: 1,
      resume: {
        kind: `resume`,
        requiresTagState: false,
        offset: `10_0`,
        handle: `stale-handle`,
        shapeId,
        updatedAt: 1,
      },
      seenTxids: [],
    })
    const originalSync = options.sync
    const metadata = createMetadata(
      new Map([[`electric:resume`, { kind: `reset`, updatedAt: 1 }]]),
    )
    const collection = createCollection({
      ...options,
      sync: {
        ...originalSync,
        sync: (params: Parameters<typeof originalSync.sync>[0]) =>
          originalSync.sync({ ...params, metadata: metadata.api }),
      },
    })

    expect(vi.mocked(ShapeStream).mock.calls.at(-1)?.[0]).toMatchObject({
      offset: undefined,
      handle: undefined,
    })
    subscriber([change(`insert`, 1, `full snapshot`), upToDate])
    expect(collection.status).toBe(`ready`)
    await collection.cleanup()
  })

  fcTest.prop(
    [
      fc.integer({ min: 0, max: 3 }),
      fc.integer({ min: 0, max: 3 }),
      fc.integer({ min: 0, max: 3 }),
      fc.string({ minLength: 1, maxLength: 8 }),
      fc.string({ minLength: 1, maxLength: 8 }),
      fc.string({ minLength: 1, maxLength: 8 }),
      fc.boolean(),
    ],
    { numRuns: 50 },
  )(
    `resume metadata merge is commutative and reset-safe on timestamp ties`,
    (
      leftTimestamp,
      rightTimestamp,
      thirdTimestamp,
      leftHandle,
      rightHandle,
      thirdHandle,
      thirdIsReset,
    ) => {
      const options = electricCollectionOptions<OracleRow>({
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        getKey: (row) => row.id,
      })
      const merge = options.sync.mergeSyncMeta!
      const left = {
        version: 1,
        resume: {
          kind: `resume`,
          requiresTagState: false,
          offset: `10_0`,
          handle: leftHandle,
          shapeId,
          updatedAt: leftTimestamp,
        },
        seenTxids: [],
      }
      const right = {
        version: 1,
        resume:
          leftTimestamp === rightTimestamp && leftHandle !== rightHandle
            ? { kind: `reset`, updatedAt: rightTimestamp }
            : {
                kind: `resume`,
                requiresTagState: false,
                offset: `20_0`,
                handle: rightHandle,
                shapeId,
                updatedAt: rightTimestamp,
              },
        seenTxids: [],
      }
      const third = {
        version: 1,
        resume: thirdIsReset
          ? { kind: `reset`, updatedAt: thirdTimestamp }
          : {
              kind: `resume`,
              requiresTagState: false,
              offset: `30_0`,
              handle: thirdHandle,
              shapeId,
              updatedAt: thirdTimestamp,
            },
        seenTxids: [],
      }

      const leftThenRight = merge(left, right)
      const rightThenLeft = merge(right, left)
      expect(leftThenRight).toEqual(rightThenLeft)
      expect(merge(left, left)).toEqual(left)
      expect(merge(merge(left, right), third)).toEqual(
        merge(left, merge(right, third)),
      )
      if (leftTimestamp === rightTimestamp) {
        expect(leftThenRight).toEqual(
          expect.objectContaining({
            resume: expect.objectContaining({ kind: `reset` }),
          }),
        )
      }
    },
  )

  fcTest.prop(
    [
      fc.array(fc.integer({ min: 1, max: 8 }), { minLength: 1, maxLength: 12 }),
      fc.array(fc.integer({ min: 1, max: 8 }), { minLength: 1, maxLength: 12 }),
    ],
    {
      numRuns: 30,
      examples: [
        [
          [1, 2, 1],
          [2, 3, 2],
        ],
        [[8], [1]],
      ],
    },
  )(
    `metadata merge preserves complete selected state and nonempty transaction evidence`,
    (leftTxids, rightTxids) => {
      const merge = electricCollectionOptions<OracleRow>({
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        getKey: (row) => row.id,
      }).sync.mergeSyncMeta!
      // Membership over an independent finite universe, not the merger's
      // concatenate/Set implementation. Duplicates cannot invent evidence.
      const union = Array.from({ length: 8 }, (_, index) => index + 1).filter(
        (txid) => leftTxids.includes(txid) || rightTxids.includes(txid),
      )
      for (const tagRequirement of [undefined, false, true]) {
        const resume = {
          kind: `resume`,
          offset: `10_0`,
          handle: `shape-1`,
          shapeId,
          updatedAt: 10,
          ...(tagRequirement === undefined
            ? {}
            : { requiresTagState: tagRequirement }),
        }
        const reset = { kind: `reset`, updatedAt: 10 }
        const newer = {
          ...resume,
          offset: `30_0`,
          handle: `shape-new`,
          shapeId: `other-shape`,
          updatedAt: 11,
        }
        const cases = [
          {
            name: `identical complete state`,
            left: resume,
            right: { ...resume },
            expected: resume,
          },
          {
            name: `newer complete state`,
            left: resume,
            right: newer,
            expected: newer,
          },
          {
            name: `newer reset`,
            left: resume,
            right: { kind: `reset`, updatedAt: 11 },
            expected: { kind: `reset`, updatedAt: 11 },
          },
          {
            name: `newer resume after reset`,
            left: reset,
            right: newer,
            expected: newer,
          },
          {
            name: `equal reset`,
            left: reset,
            right: { ...reset },
            expected: reset,
          },
          {
            name: `equal timestamp reset conflict`,
            left: resume,
            right: reset,
            expected: reset,
          },
          {
            name: `equal timestamp offset conflict`,
            left: resume,
            right: { ...resume, offset: `20_0` },
            expected: reset,
          },
          {
            name: `equal timestamp handle conflict`,
            left: resume,
            right: { ...resume, handle: `different` },
            expected: reset,
          },
          {
            name: `equal timestamp shape conflict`,
            left: resume,
            right: { ...resume, shapeId: `other-shape` },
            expected: reset,
          },
          {
            name: `only one resume`,
            left: undefined,
            right: resume,
            expected: resume,
          },
          {
            name: `no resume`,
            left: undefined,
            right: undefined,
            expected: undefined,
          },
        ]
        // Raw adapter-owned metadata policy: timestamp selection and conflict
        // reset, not a server causal-order claim. Equal-time differing tag
        // requirements are deliberately absent: their compatibility is open.
        for (const scenario of cases) {
          const left = {
            version: 1,
            seenTxids: leftTxids,
            ...(scenario.left ? { resume: scenario.left } : {}),
          }
          const right = {
            version: 1,
            seenTxids: rightTxids,
            ...(scenario.right ? { resume: scenario.right } : {}),
          }
          const expected = {
            version: 1,
            seenTxids: union,
            ...(scenario.expected ? { resume: scenario.expected } : {}),
          }
          const before = structuredClone([left, right])
          expect(merge(left, right), scenario.name).toEqual(expected)
          expect(merge(right, left), scenario.name).toEqual(expected)
          expect([left, right]).toEqual(before)
        }
      }
    },
  )

  it(`retains the selected tag requirement when timestamps establish an order`, () => {
    const merge = electricCollectionOptions<OracleRow>({
      shapeOptions: { url: `http://test-url`, params: { table: `test_table` } },
      getKey: (row) => row.id,
    }).sync.mergeSyncMeta!
    for (const olderTag of [undefined, false, true]) {
      for (const newerTag of [undefined, false, true]) {
        const state = (updatedAt: number, tag: boolean | undefined) => ({
          version: 1,
          seenTxids: [updatedAt],
          resume: {
            kind: `resume`,
            offset: `10_0`,
            handle: `shape-1`,
            shapeId,
            updatedAt,
            ...(tag === undefined ? {} : { requiresTagState: tag }),
          },
        })
        const older = state(1, olderTag)
        const newer = state(2, newerTag)
        const expected = { ...newer, seenTxids: [1, 2] }
        expect(merge(older, newer)).toEqual(expected)
        expect(merge(newer, older)).toEqual(expected)
      }
    }
  })

  it(`rejects an unseen partial update from an explicit eager resume`, async () => {
    const metadata = createMetadata(resumeState())
    const trace = createOracleCollection(
      `explicit-eager-resume`,
      `eager`,
      metadata.api,
      { offset: `10_0` as Offset, handle: `explicit-handle` },
    )

    trace.subscriber([change(`update`, 1, `partial`), upToDate])

    expect(trace.collection.status).toBe(`error`)
    expect(trace.collection.has(1)).toBe(false)
    expect(metadata.state.get(`electric:resume`)).toEqual(
      expect.objectContaining({ kind: `reset` }),
    )
    await trace.collection.cleanup()
  })

  it(`accepts complete replica updates from an explicit eager resume`, async () => {
    let subscriber!: (messages: Array<Message<OracleRow>>) => void
    mockSubscribe.mockImplementationOnce((callback) => {
      subscriber = callback
      return vi.fn()
    })
    const collection = createCollection(
      electricCollectionOptions<OracleRow>({
        id: `explicit-full-replica-resume`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table`, replica: `full` },
          offset: `10_0` as Offset,
          handle: `explicit-handle`,
        },
        syncMode: `eager`,
        getKey: (row) => row.id,
        startSync: true,
      }),
    )

    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `complete update`, stable: `stable-1` },
        headers: { operation: `update` },
      },
      upToDate,
    ])

    expect(collection.status).toBe(`ready`)
    expect(collection.get(1)).toEqual(
      expect.objectContaining({
        name: `complete update`,
        stable: `stable-1`,
      }),
    )
    await collection.cleanup()
  })

  it.each([10, 100])(
    `subset acquisition avoids scanning the applied baseline with %s rows`,
    async (size) => {
      const trace = createOracleCollection(
        `acquisition-work`,
        `on-demand`,
        createMetadata(new Map()).api,
      )
      try {
        trace.subscriber([
          ...Array.from({ length: size }, (_, id) =>
            change(`insert`, id, `row`),
          ),
          upToDate,
        ])
        await trace.collection._sync.loadSubset({})
        const keys = vi.spyOn(trace.collection._state.syncedData, `keys`)
        try {
          for (let i = 0; i < 3; i++)
            await trace.collection._sync.loadSubset({})
          expect(keys).not.toHaveBeenCalled()
          for (let i = 0; i < 3; i++)
            await trace.collection._sync.loadSubset({
              where: new IR.Func(`eq`, [
                new IR.PropRef([`id`]),
                new IR.Value(size + i),
              ]),
            })
          expect(keys).not.toHaveBeenCalled()
          expect(mockStream.requestSnapshot).toHaveBeenCalledTimes(4)
        } finally {
          keys.mockRestore()
        }
      } finally {
        await trace.collection.cleanup()
      }
    },
  )

  it(`warns once and restarts a persisted resume when hydration completion is unavailable`, async () => {
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const metadata = createMetadata(resumeState())
    Object.assign(metadata.api.row, {
      scanPersisted: () => Promise.resolve([{ key: 1 }]),
    })
    const trace = createOracleCollection(
      `unverifiable-persisted-resume`,
      `eager`,
      metadata.api,
    )

    try {
      expect(vi.mocked(ShapeStream).mock.calls.at(-1)?.[0]).toMatchObject({
        offset: undefined,
        handle: undefined,
      })
      trace.subscriber([change(`insert`, 1, `full snapshot`), upToDate])

      expect(trace.collection.status).toBe(`ready`)
      expect(trace.collection.get(1)).toEqual(
        expect.objectContaining({ stable: `stable-1` }),
      )
      await trace.collection.cleanup()
      trace.collection.startSyncImmediate()
      mockSubscribe.mock.calls.at(-1)![0]([upToDate])
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]?.[0]).toMatch(
        /persistence.*cannot verify hydration.*[Uu]pdate/,
      )
    } finally {
      await trace.collection.cleanup()
      warn.mockRestore()
    }
  })

  it(`ignores an unseen on-demand update without blocking readiness`, async () => {
    const metadata = createMetadata(resumeState())
    const trace = createOracleCollection(
      `on-demand-unseen-update`,
      `on-demand`,
      metadata.api,
    )

    trace.subscriber([change(`update`, 1, `partial`), upToDate])

    expect(trace.collection.status).toBe(`ready`)
    expect(trace.collection.has(1)).toBe(false)
    expect(metadata.state.get(`electric:resume`)).toEqual(
      expect.objectContaining({ kind: `resume`, offset: `20_0` }),
    )
    await trace.collection.cleanup()
  })

  it(`records match and txid evidence for an ignored on-demand update`, async () => {
    const trace = createOracleCollection(
      `on-demand-ignored-update-evidence`,
      `on-demand`,
      createMetadata(resumeState()).api,
    )
    trace.subscriber([upToDate])

    const pendingMatch = trace.collection.utils.awaitMatch(
      (message) => `value` in message && message.value.id === 808,
      100,
    )
    const pendingTxid = trace.collection.utils.awaitTxId(808, 100)
    const update = change(`update`, 808, `ignored`)
    update.headers.txids = [808]

    trace.subscriber([update, upToDate])

    await Promise.all([
      expect(pendingMatch).resolves.toBe(true),
      expect(pendingTxid).resolves.toBe(true),
    ])
    expect(trace.collection.has(808)).toBe(false)
    await trace.collection.cleanup()
  })
})
