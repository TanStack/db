/**
 * Solid driver for the shared live-query conformance suite.
 *
 * Each mount runs inside a `createRoot` so `unmount` disposes via the captured
 * dispose fn; the root stays alive between mount and reads so Solid's reactive
 * getters stay current. Solid auto-tracks signals, so controllable inputs use a
 * signal read inside the query fn (no deps array). Collection/config inputs are
 * passed as accessors, per Solid's arity-based input detection.
 *
 * All registered laws must pass; the driver has no whole-test waivers.
 */
import { describe, expect, it } from 'vitest'
import {
  coalesce,
  count,
  createCollection,
  createLiveQueryCollection,
  createOptimisticAction,
  eq,
  groupKeys,
  gt,
  localOnlyCollectionOptions,
  sum,
} from '@tanstack/db'
import {
  createRenderEffect,
  createRoot,
  createSignal,
  onCleanup,
} from 'solid-js'
import { createStore } from 'solid-js/store'
import {
  mockSyncCollectionOptions,
  mockSyncCollectionOptionsNoInitialState,
} from '../../db/tests/utils'
import { useLiveQuery } from '../src/useLiveQuery'
import { runSuite } from '../../db/tests/conformance/suite'
import { runRowSnapshotHistories } from '../../db/tests/conformance/row-snapshot-oracle'
import { createPublicationLog } from '../../db/tests/conformance/publication-log'
import { expectPublishedRows } from '../../db/tests/conformance/publication-laws-oracle'
import { makeLaggingSource } from '../../db/tests/conformance/lagging-source'
import { makeSyncSource } from '../../db/tests/conformance/sync-source'
import { makeErrorSource as makeSharedErrorSource } from '../../db/tests/conformance/error-source'
import {
  expectResultSurface,
  selectedRowKeys,
} from '../../db/tests/conformance/result-laws'
import { withScopeSetup } from '../../db/tests/conformance/scope-setup'
import type { PooledLiveQueries } from '@tanstack/db'
import type {
  ConformanceResult,
  ControllableHandle,
  DeferredSourceHandle,
  LiveQueryDriver,
  LiveQueryHandle,
  QueryBuild,
  SourceHandle,
} from '../../db/tests/conformance/contract'

let sourceSeq = 0

function writer<T extends { id: string }>(collection: any) {
  return (type: `insert` | `update` | `delete`, value: T) => {
    collection.utils.begin()
    collection.utils.write({ type, value })
    collection.utils.commit()
  }
}

function makeSource<T extends { id: string }>(
  initialData: ReadonlyArray<T>,
  collectionId?: string,
  options?: { rowUpdateMode?: `full` },
): SourceHandle<T> {
  const collection = createCollection(
    mockSyncCollectionOptions<T>({
      id: collectionId ?? `conformance-solid-${sourceSeq++}`,
      getKey: (r) => r.id,
      initialData: [...initialData],
      rowUpdateMode: options?.rowUpdateMode,
    }),
  )
  const write = writer<T>(collection)
  return {
    collection,
    insert: (row) => write(`insert`, row),
    update: (row) => write(`update`, row),
    remove: (row) => write(`delete`, row),
  }
}

function makeDeferredSource<
  T extends { id: string },
>(): DeferredSourceHandle<T> {
  const collection = createCollection(
    mockSyncCollectionOptionsNoInitialState<T>({
      id: `conformance-solid-${sourceSeq++}`,
      getKey: (r) => r.id,
    }),
  )
  collection.startSyncImmediate()
  const write = writer<T>(collection)
  return {
    collection,
    insert: (row) => write(`insert`, row),
    update: (row) => write(`update`, row),
    remove: (row) => write(`delete`, row),
    emit: (rows) => {
      collection.utils.begin()
      rows.forEach((value) => collection.utils.write({ type: `insert`, value }))
      collection.utils.commit()
    },
    markReady: () => collection.utils.markReady(),
  }
}

function makePrecreated(
  build: QueryBuild,
  opts?: { startSync?: boolean; gcTime?: number },
) {
  const collection = createLiveQueryCollection({
    query: build as any,
    startSync: opts?.startSync ?? true,
    gcTime: opts?.gcTime,
  })
  return { collection }
}

function makeErrorSource(kind: `fail` | `crash`) {
  return makeSharedErrorSource(
    createCollection,
    `conformance-solid-err-${sourceSeq++}`,
    kind,
  )
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 10))
}

function makeHandle(
  getResult: () => any,
  dispose: () => void,
): LiveQueryHandle {
  return {
    collection: () => getResult()?.collection ?? null,
    current(): ConformanceResult {
      const result = getResult()
      return expectResultSurface({
        data: result?.(),
        state: result?.state,
        status: result?.status,
        isReady: result?.isReady,
        isLoadingError: result?.isLoadingError,
        isCrashed: result?.isCrashed,
        isSyncError: result?.isSyncError,
        // solid-db exposes no `isEnabled`; derive it from status (status-derived).
        isEnabled: result?.status !== `disabled`,
        health: result?.health,
      })
    },
    // The hook's flags are getters that do not read the resource, so they
    // stay readable when reading `data` throws for an <ErrorBoundary>.
    statusSurface() {
      const result = getResult()
      return {
        status: result?.status,
        isReady: result?.isReady,
        isLoadingError: result?.isLoadingError,
        isCrashed: result?.isCrashed,
        isSyncError: result?.isSyncError,
        health: result?.health,
      }
    },
    flush: settle,
    async apply(fn: () => void) {
      fn()
      await settle()
    },
    unmount() {
      dispose()
    },
  }
}

function inRoot(fn: () => any): { getResult: () => any; dispose: () => void } {
  let result: any
  let dispose!: () => void
  withScopeSetup(
    () =>
      createRoot((d) => {
        dispose = d
        result = fn()
      }),
    () => dispose(),
  )
  return { getResult: () => result, dispose }
}

function mount(build: QueryBuild) {
  const { getResult, dispose } = inRoot(() => useLiveQuery(build as any))
  return makeHandle(getResult, dispose)
}

function mountCollection(collection: any) {
  // Solid accepts a pre-created collection via an accessor.
  const { getResult, dispose } = inRoot(() => useLiveQuery(() => collection))
  return makeHandle(getResult, dispose)
}

function mountConfig(
  build: QueryBuild,
  opts?: { gcTime?: number; pool?: PooledLiveQueries },
) {
  // Solid accepts the config-object form via an accessor.
  const { getResult, dispose } = inRoot(() =>
    useLiveQuery(() => ({ query: build, ...opts })),
  )
  return makeHandle(getResult, dispose)
}

function mountDisabled() {
  // Disabled: an accessor returning null.
  const { getResult, dispose } = inRoot(() => useLiveQuery(() => null))
  return makeHandle(getResult, dispose)
}

function mountControllable<P>(
  build: (q: any, param: P) => any,
  initial: P,
  opts?: { pool?: PooledLiveQueries },
): ControllableHandle<P> {
  const [param, setParam] = createSignal<P>(initial)
  const published = createPublicationLog()
  const { getResult, dispose } = inRoot(() => {
    const query =
      opts?.pool !== undefined
        ? // Reading param() in the config accessor makes Solid recompute on change.
          useLiveQuery(() => {
            const value = param()
            return { query: (q: any) => build(q, value), pool: opts.pool }
          })
        : // Reading param() inside the query fn makes Solid recompute on change.
          useLiveQuery((q: any) => build(q, param()))
    // Solid renders the value each render effect reads.
    createRenderEffect(() => published.record(query(), query.state))
    return query
  })
  const handle = makeHandle(getResult, dispose)
  return {
    ...handle,
    publications: published.values,
    statePublications: published.stateValues,
    async setParam(next: P) {
      setParam(() => next)
      // The first paint after the change: the framework ran its reactive
      // work synchronously, but no later task has run.
      published.record(getResult()(), getResult().state)
      await settle()
    },
  }
}

const solidDriver: LiveQueryDriver = {
  name: `solid`,
  // Reactive reads decide when the query compiles again.
  comparesQueryIdentity: false,
  disabledRepresentation: `empty-reactive`,
  ops: { eq, gt, count, sum, coalesce, groupKeys, createOptimisticAction },
  makeSource,
  wrapSnapshotValue: <T extends object>(value: T) => createStore(value)[0],
  makeDeferredSource,
  makeLaggingSource: <T extends { id: string }>() =>
    makeLaggingSource<T>(
      createCollection,
      `conformance-solid-lagging-${sourceSeq++}`,
    ),
  makeSyncSource: <T extends { id: string }>(data: ReadonlyArray<T>) =>
    makeSyncSource<T>(
      createCollection,
      `conformance-solid-health-${sourceSeq++}`,
      data,
    ),
  makePrecreated,
  makeErrorSource,
  mount,
  mountControllable,
  mountCollection,
  mountConfig,
  mountDisabled,
  // solid-db routes errors through its createResource/Suspense path: reading an
  // errored query throws (CollectionStateError) for an <ErrorBoundary> to catch,
  // rather than exposing a readable isLoadingError flag. That's a framework idiom, not a
  // gap — the error-status scenario is parametrized to assert it via the boundary.
  errorSurface: `throw`,
  knownGaps: [],
  features: { serverSnapshot: false, suspense: true, pooledEqFilters: true },
}

describe(`owned native scope setup`, () => {
  it(`keeps a successful scope alive until explicit disposal`, () => {
    let calls = 0
    const handle = inRoot(() => {
      onCleanup(() => {
        calls++
      })
      return 7
    })
    expect(calls).toBe(0)
    handle.dispose()
    expect(calls).toBe(1)
  })

  it.each([false, true])(
    `disposes failed setup and retains errors, cleanupFails=%s`,
    (cleanupFails) => {
      const primary = new Error(`scope setup failure`)
      const secondary = new Error(`scope cleanup failure`)
      let calls = 0
      let caught: unknown
      try {
        inRoot(() => {
          onCleanup(() => {
            calls++
            if (cleanupFails) throw secondary
          })
          throw primary
        })
      } catch (error) {
        caught = error
      }
      expect(calls).toBe(1)
      if (cleanupFails) {
        expect(caught).toBeInstanceOf(AggregateError)
        expect((caught as AggregateError).errors).toEqual([primary, secondary])
        expect((caught as AggregateError).cause).toBe(primary)
      } else expect(caught).toBe(primary)
    },
  )
})

runSuite(solidDriver)

// The reported source is local-only. Keep that receiving path on the same
// snapshot law and histories as the adapter suite's controlled sync source.
it.each([`callback`, `config`, `collection`] as const)(
  `preserves local-only row snapshots through the %s input`,
  async (input) => {
    await runRowSnapshotHistories(
      {
        ...solidDriver,
        name: `solid-local-only`,
        snapshotSourceUsesDraft: true,
        makeSource<T extends { id: string }>(
          initialData: ReadonlyArray<T>,
          collectionId?: string,
          options?: { rowUpdateMode?: `full` },
        ) {
          const collection = createCollection(
            localOnlyCollectionOptions<T>({
              id: collectionId,
              getKey: (row) => row.id,
              initialData: [...initialData],
            }),
          )
          return {
            collection,
            insert: (row: T) => {
              collection.insert(row)
            },
            update: (row: T) => {
              return collection.update(row.id, (draft) => {
                // Local-only sync already replaces full rows. Remove omitted
                // keys from the draft when the shared history requests it.
                if (options?.rowUpdateMode === `full`)
                  for (const key of selectedRowKeys(draft))
                    if (!Object.hasOwn(row, key))
                      Reflect.deleteProperty(draft, key)
                Object.assign(draft, row)
              })
            },
            remove: (row: T) => {
              collection.delete(row.id)
            },
          }
        },
      },
      input,
      `sync`,
    )
  },
)

it(`preserves raw result types through the actual driver reader`, () => {
  const rawData = [{ id: `a`, value: undefined }]
  const raw = Object.assign(() => rawData, {
    state: new Map(),
    status: `disabled`,
    isReady: false,
    isLoadingError: false,
    isCrashed: false,
    isSyncError: false,
    isEnabled: false,
  })
  const handle = makeHandle(
    () => raw,
    () => {},
  )
  try {
    const healthy = handle.current()
    expect(healthy.data).toBe(rawData)
    expect(healthy.state).toBe(raw.state)
    expect(healthy.isReady).toBe(false)
    expect(healthy.isLoadingError).toBe(false)
    expect(healthy.isEnabled).toBe(false)
    for (const key of [`status`, `isReady`, `isLoadingError`] as const) {
      const original = raw[key]
      Reflect.deleteProperty(raw, key)
      expect(() => handle.current()).toThrowError(new RegExp(`raw ${key}`))
      for (const invalid of key === `status`
        ? [undefined, 0]
        : [undefined, 0, ``]) {
        Reflect.set(raw, key, invalid)
        expect(() => handle.current()).toThrowError(new RegExp(`raw ${key}`))
      }
      Reflect.set(raw, key, original)
      expect(handle.current()[key as keyof ConformanceResult]).toBe(original)
    }
  } finally {
    handle.unmount()
  }
})

// These controls supply wrong traces to the same comparison used by the
// shared source-ID and pooled scenarios. They add no production histories.
describe(`settled publication comparison`, () => {
  const rows = [{ id: `current` }]
  const stale = [{ id: `previous` }]
  it.each([
    { name: `settled rows`, values: [rows], expected: rows },
    {
      name: `empty loading turns before settled rows`,
      values: [undefined, [], rows],
      expected: rows,
    },
    {
      name: `a model whose settled result is empty`,
      values: [undefined, []],
      expected: [],
    },
  ])(`accepts $name`, ({ values, expected }) => {
    expectPublishedRows(values, expected)
  })

  it.each([
    { name: `an omitted log`, values: [] },
    { name: `a dropped accessor value`, values: [undefined] },
    { name: `a dropped settled publication`, values: [undefined, []] },
    { name: `stale rows before the settled value`, values: [stale, rows] },
    { name: `stale rows as the settled value`, values: [rows, stale] },
  ])(`rejects $name`, ({ values }) => {
    expect(() => expectPublishedRows(values, rows)).toThrow()
  })
})
