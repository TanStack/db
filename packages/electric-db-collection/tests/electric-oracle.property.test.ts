import { fc, test as fcTest } from '@fast-check/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection, createTransaction } from '@tanstack/db'
import { ShapeStream } from '@electric-sql/client'
import { QueryClient } from '@tanstack/query-core'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { queryCollectionOptions } from '../../query-db-collection/src/query'
import { electricCollectionOptions } from '../src/electric'
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

function isLegalElectricPartition(
  batches: Array<Array<Message<OracleRow>>>,
): boolean {
  return batches.every((batch) => {
    const resetIndex = batch.findIndex(
      (message) =>
        (message.headers as Record<string, unknown>).control === `must-refetch`,
    )
    if (resetIndex < 0) return true
    return !batch.slice(0, resetIndex).some((message) => {
      const control = (message.headers as Record<string, unknown>).control
      return control === `up-to-date` || control === `subset-end`
    })
  })
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
  return new Map([
    [
      `electric:resume`,
      {
        kind: `resume`,
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
      loadGate.then(() => Array.from(rows, ([key, value]) => ({ key, value }))),
    loadCollectionMetadata: () =>
      Promise.resolve(
        Array.from(collectionMetadata, ([key, value]) => ({ key, value })),
      ),
    applyCommittedTx: (_collectionId: string, tx: PersistedTx) => {
      for (const mutation of tx.collectionMetadataMutations ?? []) {
        if (mutation.type === `delete`) {
          collectionMetadata.delete(mutation.key)
        } else {
          collectionMetadata.set(mutation.key, mutation.value)
        }
      }
      if (tx.truncate) rows.clear()
      for (const mutation of tx.mutations) {
        if (mutation.type === `delete`) {
          rows.delete(mutation.key)
        } else if (mutation.type === `update`) {
          rows.set(mutation.key, {
            ...rows.get(mutation.key),
            ...mutation.value,
          } as OracleRow)
        } else {
          rows.set(mutation.key, mutation.value as OracleRow)
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
  await vi.waitFor(() => expect(subscriber).toBeTypeOf(`function`), {
    interval: 1,
    timeout: 250,
  })

  const snapshots: Array<Array<[string | number, string, string]>> = []
  const history: Array<Array<Message<OracleRow>>> = []
  for (const batch of batches) {
    subscriber(batch)
    history.push(batch)
    const expected = recomputeCommittedRows(history)
    await vi.waitFor(
      () => expect(rowsFromCollection(collection)).toEqual(expected),
      { interval: 1, timeout: 250 },
    )
    snapshots.push(rowsFromCollection(collection))
  }
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
      expect(rowsFromMap(persistedRows)).toEqual(rowsFromCollection(collection))
    },
    { interval: 1, timeout: 250 },
  )
  const result = {
    rows: rowsFromCollection(collection),
    snapshots,
    status: collection.status,
    resume: observableResume(exported?.resume),
    durableRows: rowsFromMap(persistedRows),
    durableResume: observableResume(persistedMetadata.get(`electric:resume`)),
    persistenceCommits,
  }
  await collection.cleanup()
  return result
}

async function runQueryTrace(
  id: string,
  batches: Array<Array<Message<OracleRow>>>,
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
  await collection.preload()

  const snapshots: TraceResult[`snapshots`] = []
  const history: Array<Array<Message<OracleRow>>> = []
  for (const batch of batches) {
    history.push(batch)
    const commits = batch.some((message) => {
      const control = (message.headers as Record<string, unknown>).control
      return control === `up-to-date` || control === `subset-end`
    })
    if (commits) {
      queryRows = recomputeCommittedRows(history).map(
        ([rowId, name, stable]) => ({
          id: Number(rowId),
          name,
          stable,
        }),
      )
      queryClient.setQueryData(queryKey, queryRows)
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
    snapshots.push(rowsFromCollection(collection))
  }

  const result: TraceResult = {
    rows: rowsFromCollection(collection),
    snapshots,
    status: collection.status,
    resume: undefined,
  }
  await collection.cleanup()
  queryClient.clear()
  return result
}

function change(
  operation: `insert` | `update` | `delete`,
  id: number,
  name: string,
): Message<OracleRow> {
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
  | { kind: `cleanup`; slot: ProcessSlot }
  | { kind: `restart`; slot: ProcessSlot }

type ProcessRuntime = {
  collection: Collection<OracleRow, string | number>
  subscriber?: (messages: Array<Message<OracleRow>>) => void
  reference: ReferenceState
  seenTxids: Set<number>
  resumeAvailable: boolean
  requiresCompleteResume: boolean
  resettingSnapshot: boolean
  terminalError: boolean
  active: boolean
  retired: boolean
  preloadPromises: Array<Promise<unknown>>
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
): Promise<void> {
  const subscribers: Array<(messages: Array<Message<OracleRow>>) => void> = []
  const runtimes = new Map<ProcessSlot, ProcessRuntime>()
  const allPreloads: Array<Promise<unknown>> = []
  let generation = 0
  mockSubscribe.mockReset()
  mockSubscribe.mockImplementation((callback) => {
    subscribers.push(callback)
    return vi.fn()
  })

  const createRuntime = async (slot: ProcessSlot) => {
    const previous = runtimes.get(slot)
    if (previous) await previous.collection.cleanup()
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
      preloadPromises: [],
    })
  }

  const startRuntime = (runtime: ProcessRuntime, preload: boolean) => {
    if (runtime.active) return
    const subscriberIndex = subscribers.length
    if (preload) {
      const promise = runtime.collection.preload()
      runtime.preloadPromises.push(promise)
      allPreloads.push(promise)
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
      return
    }
    const runtime = runtimes.get(command.slot)
    if (!runtime) return

    if (command.kind === `import`) {
      if (runtime.active) return
      runtime.collection.config.sync.importSyncMeta?.({
        version: 1,
        seenTxids: [command.txid],
        ...(command.resume
          ? {
              resume: {
                kind: `resume`,
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
      return
    }

    if (command.kind === `preload`) {
      startRuntime(runtime, true)
      return
    }
    if (command.kind === `restart`) {
      startRuntime(runtime, false)
      return
    }
    if (command.kind === `cleanup`) {
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
      return
    }
    if (!runtime.active || !runtime.subscriber || runtime.terminalError) return

    if (command.kind === `reset`) {
      runtime.subscriber([mustRefetch])
      applyReferenceBatch(runtime.reference, [mustRefetch])
      runtime.resettingSnapshot = true
      return
    }

    if (command.kind === `snapshot`) {
      const messages = [change(`insert`, command.id, command.name), upToDate]
      runtime.subscriber(messages)
      applyReferenceBatch(runtime.reference, messages)
      runtime.resettingSnapshot = false
      runtime.resumeAvailable = true
      return
    }

    const evidenceChange = change(
      command.operation,
      command.id,
      command.name,
    ) as ChangeMessage<OracleRow>
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
    runtime.subscriber(messages)
    if (invalidResume) {
      runtime.terminalError = true
      runtime.resumeAvailable = false
      return
    }
    applyReferenceBatch(runtime.reference, messages)
    runtime.resettingSnapshot = false
    runtime.resumeAvailable = true
    if (txidOutcome) {
      await expect(txidOutcome).resolves.toBe(true)
      runtime.seenTxids.add(command.txid)
    }
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
      await execute(command)
      assertAllSlots()
    }
  } finally {
    await Promise.all(
      Array.from(runtimes.values(), ({ collection }) => collection.cleanup()),
    )
    await Promise.allSettled(allPreloads)
    mockSubscribe.mockReset()
  }
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
    const update = change(`update`, 1, `scheduled`) as ChangeMessage<OracleRow>
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

  fcTest.prop([fc.array(processCommandArb, { maxLength: 20 })], {
    numRuns: 20,
  })(
    `generated process grammar preserves lifecycle and concurrent-collection isolation`,
    async (commands) => {
      processGrammarRun++
      await runProcessGrammar(`process-grammar-${processGrammarRun}`, commands)
    },
  )

  it(`stops lifecycle replay after an invalid resumed update`, async () => {
    await runProcessGrammar(`process-grammar-terminal-error`, [
      {
        kind: `batch`,
        slot: `a`,
        operation: `update`,
        id: 1,
        name: `unseen`,
        txid: 55,
      },
      { kind: `snapshot`, slot: `a`, id: 1, name: `stale callback` },
    ])
  })

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
      ].filter(isLegalElectricPartition)

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
    expect(isLegalElectricPartition([[upToDate, mustRefetch]])).toBe(false)

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
    `batch partition is invariant across Electric modes and phases`,
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
    { numRuns: 20 },
  )(
    `denotational reference, Electric, persisted Electric, and query adapters converge across controls and publication epochs`,
    async (tokens, partitionSeed) => {
      const messages = buildDifferentialHistory(tokens)
      const partitions = everyContiguousPartition(messages).filter(
        isLegalElectricPartition,
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
  )

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
        for (const [partitionId, partition] of everyContiguousPartition(
          messages,
        ).entries()) {
          const metadata = createMetadata(resumeState())
          const trace = createOracleCollection(
            `generated-invalid-${syncMode}-${id}-${partitionId}`,
            syncMode,
            metadata.api,
          )
          trace.subscriber([change(`insert`, id, completeName), upToDate])
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
    const evidenceChange = change(
      `insert`,
      5,
      `matched after start`,
    ) as ChangeMessage<OracleRow>
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
    const evidenceChange = change(
      `insert`,
      77,
      `captured utilities`,
    ) as ChangeMessage<OracleRow>
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
    const preload = collection.preload()
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
    const preload = collection.preload()
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
    await preload
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
      const evidenceChange = change(
        `insert`,
        91,
        `race winner`,
      ) as ChangeMessage<OracleRow>
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

  it(`does not let a committed message satisfy awaitMatch after a newer batch`, async () => {
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
    ).rejects.toThrow(/Timeout waiting for custom match function/)
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

  it.each([
    {
      name: `malformed`,
      seed: new Map<string, unknown>([
        [
          `electric:resume`,
          {
            kind: `resume`,
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
    const update = change(`update`, 808, `ignored`) as ChangeMessage<OracleRow>
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
