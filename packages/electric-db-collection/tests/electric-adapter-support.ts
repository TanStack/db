// Shared fixtures for the Electric adapter tests: the mocked ShapeStream,
// the collection and persistence harness, and the publication recorder.
// The laws these fixtures serve are owned by electric-oracle.property.test.ts,
// and each test file that uses them calls vi.mock for @electric-sql/client itself.
import { isDeepStrictEqual } from 'node:util'
import { expect, vi } from 'vitest'
import { createCollection } from '@tanstack/db'
import { electricCollectionOptions } from '../src/electric'
import { withElectricCleanup } from './electric-oracle-lifecycle'
import type { Mock } from 'vitest'
import type { Collection, SyncMetadataApi } from '@tanstack/db'
import type { ChangeMessage, Message, Offset, Row } from '@electric-sql/client'
import type {
  PersistedTx,
  PersistenceAdapter,
} from '../../db-sqlite-persistence-core/src'
import type { ElectricSyncMode } from '../src/electric'

export type OracleRow = Row & {
  id: number
  name: string
  stable: string
}

export const mockSubscribe: Mock = vi.fn()

export const shapeId = `{"params":{"table":"test_table"},"url":"http://test-url"}`

export const mockStream: {
  subscribe: Mock
  unsubscribeAll: Mock
  requestSnapshot: Mock
  fetchSnapshot: Mock
  forceDisconnectAndRefresh: Mock
  isUpToDate: boolean
  shapeHandle: string | undefined
  lastOffset: string
} = {
  subscribe: mockSubscribe,
  unsubscribeAll: vi.fn(),
  requestSnapshot: vi.fn().mockResolvedValue(undefined),
  fetchSnapshot: vi.fn().mockResolvedValue({ metadata: {}, data: [] }),
  forceDisconnectAndRefresh: vi.fn().mockResolvedValue(undefined),
  isUpToDate: false,
  shapeHandle: undefined as string | undefined,
  lastOffset: `-1` as string,
}

export function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

export function everyContiguousPartition<T>(
  values: Array<T>,
): Array<Array<Array<T>>> {
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

export function createMetadata(seed: ReadonlyMap<string, unknown>): {
  api: SyncMetadataApi<string | number>
  state: Map<string, unknown>
} {
  const state = new Map(seed)
  return {
    state,
    api: {
      persistence: null,
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

export function resumeState(): ReadonlyMap<string, unknown> {
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

export function createPersistedAdapter(
  collectionMetadata: Map<string, unknown>,
  rows: Map<string | number, OracleRow>,
  loadGate: Promise<void> = Promise.resolve(),
): PersistenceAdapter {
  let latestTerm = 0
  let latestSeq = 0
  let latestRowVersion = 0
  let resetEpoch = 0
  return {
    loadSubset: () =>
      loadGate.then(() =>
        Array.from(rows, ([key, value]) => ({
          key,
          value: structuredClone(value),
        })),
      ),
    loadResumeSnapshot: async (_collectionId, ctx) => {
      if (ctx?.includeRows !== false) await loadGate
      return {
        rows:
          ctx?.includeRows === false
            ? []
            : Array.from(rows, ([key, value]) => ({
                key,
                value: structuredClone(value),
              })),
        keySet: { status: `consistent` },
        collectionMetadata: Array.from(collectionMetadata, ([key, value]) => ({
          key,
          value: structuredClone(value),
        })),
        latestTerm,
        latestSeq,
        latestRowVersion,
        resetEpoch,
      }
    },
    loadCollectionMetadata: () =>
      Promise.resolve(
        Array.from(collectionMetadata, ([key, value]) => ({
          key,
          value: structuredClone(value),
        })),
      ),
    applyCommittedTx: (_target, tx: PersistedTx) => {
      for (const mutation of tx.collectionMetadataMutations ?? []) {
        if (mutation.type === `delete`) {
          collectionMetadata.delete(mutation.key)
        } else {
          collectionMetadata.set(mutation.key, structuredClone(mutation.value))
        }
      }
      if (tx.truncate) {
        rows.clear()
        resetEpoch++
      }
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
      latestTerm = tx.term
      latestSeq = tx.seq
      latestRowVersion = tx.rowVersion
      return Promise.resolve()
    },
    ensureIndex: () => Promise.resolve(),
  }
}

export function createOracleCollection(
  id: string,
  syncMode: ElectricSyncMode,
  metadata: SyncMetadataApi<string | number>,
  shapeResumeOptions: {
    offset?: Offset
    handle?: string
    signal?: AbortSignal
    onError?: () => Promise<Record<string, never> | undefined>
  } = {},
  wrapParams: <TParams>(params: TParams) => TParams = (params) => params,
) {
  let subscriber!: (messages: Array<Message<OracleRow>>) => void
  let sdkError!: (error: unknown) => void
  const unsubscribe: Mock = vi.fn()
  mockSubscribe.mockImplementationOnce((callback, onSubscriberError) => {
    subscriber = callback
    sdkError = onSubscriberError
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
          originalSync.sync(wrapParams({ ...params, metadata })),
      },
    }),
    subscriber,
    sdkError,
    unsubscribe,
  }
}

export type TraceResult = {
  rows: Array<[string | number, string, string]>
  snapshots: Array<Array<[string | number, string, string]>>
  status: string
  resume: unknown
}

export function rowsFromCollection(
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

export function rowsFromMap(
  rows: ReadonlyMap<string | number, OracleRow>,
): Array<[string | number, string, string]> {
  return Array.from(rows, ([key, row]): [string | number, string, string] => [
    key,
    row.name,
    row.stable,
  ]).sort(([left], [right]) => String(left).localeCompare(String(right)))
}

export function observableResume(value: unknown): unknown {
  if (value === null || typeof value !== `object`) return value
  const state = value as Record<string, unknown>
  return {
    kind: state.kind,
    offset: state.offset,
    handle: state.handle,
    shapeId: state.shapeId,
  }
}

export type Publication = { cut: string; rows: TraceResult[`rows`] }

export function observePublications(
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

export function expectWholePublications(
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

export async function runTrace(
  id: string,
  syncMode: ElectricSyncMode,
  prefix: Array<Array<Message<OracleRow>>>,
  batches: Array<Array<Message<OracleRow>>>,
  seed: ReadonlyMap<string, unknown> = new Map(),
  hooks: {
    beforeDelivery?: () => void
    cleanup?: (cleanup: () => Promise<void>) => Promise<void>
  } = {},
): Promise<TraceResult> {
  const metadata = createMetadata(seed)
  const { collection, subscriber } = createOracleCollection(
    id,
    syncMode,
    metadata.api,
  )
  const deliver = (batch: Array<Message<OracleRow>>) => {
    hooks.beforeDelivery?.()
    subscriber(batch)
  }
  const cleanup = () => collection.cleanup()
  return withElectricCleanup(() => {
    for (const batch of prefix) deliver(batch)
    const snapshots: Array<Array<[string | number, string, string]>> = []
    for (const batch of batches) {
      deliver(batch)
      snapshots.push(rowsFromCollection(collection))
    }
    return {
      rows: rowsFromCollection(collection),
      snapshots,
      status: collection.status,
      resume: observableResume(metadata.state.get(`electric:resume`)),
    }
  }, [() => (hooks.cleanup ? hooks.cleanup(cleanup) : cleanup())])
}

export function change(
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

export const upToDate: Message<OracleRow> = {
  headers: { control: `up-to-date` },
}

export const subsetEnd: Message<OracleRow> = {
  headers: { control: `subset-end` },
}

export const mustRefetch: Message<OracleRow> = {
  headers: { control: `must-refetch` },
}

export type PreloadOutcome =
  { status: `fulfilled` } | { status: `rejected`; reason: unknown }

export function observePreload(promise: Promise<void>) {
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

export type ObservedPreload = ReturnType<typeof observePreload>

export function expectPreloadOutcome(
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

export function resetElectricOracleMocks(): void {
  vi.clearAllMocks()
  // clearAllMocks retains one-shot implementations from a failed earlier
  // history. Each history must own its transport responses independently.
  mockSubscribe.mockReset()
  mockStream.requestSnapshot.mockReset().mockResolvedValue(undefined)
  mockStream.isUpToDate = false
  mockStream.shapeHandle = `shape-current`
  mockStream.lastOffset = `20_0`
}

/**
 * After Collection readiness, an Electric sync adapter that gives up reports a
 * stopped sync: the Collection's `error`. Status and rows stay, and only a restart recovers; the
 * reset resume state is what lets that restart refetch.
 */
export function expectGaveUpAfterReadiness(
  collection: Collection<OracleRow, string | number>,
) {
  expect(collection.status).toBe(`ready`)
  expect(collection.health.failureReason).toBeNull()
  expect(collection.health.error).toBeTruthy()
}
