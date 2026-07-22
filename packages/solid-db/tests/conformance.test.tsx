/**
 * Solid driver for the shared live-query conformance suite.
 *
 * Each mount runs inside a `createRoot` so `unmount` disposes via the captured
 * dispose fn; the root stays alive between mount and reads so Solid's reactive
 * getters stay current. Solid auto-tracks signals, so controllable inputs use a
 * signal read inside the query fn (no deps array). Collection/config inputs are
 * passed as accessors, per Solid's arity-based input detection.
 *
 * `knownGaps` is populated empirically from the run below.
 */
import {
  coalesce,
  count,
  createCollection,
  createLiveQueryCollection,
  createOptimisticAction,
  eq,
  gt,
  sum,
} from '@tanstack/db'
import { createRoot, createSignal } from 'solid-js'
import {
  mockSyncCollectionOptions,
  mockSyncCollectionOptionsNoInitialState,
} from '../../db/tests/utils'
import { useLiveQuery } from '../src/useLiveQuery'
import { runSuite } from '../../db/tests/conformance/suite'
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
): SourceHandle<T> {
  const collection = createCollection(
    mockSyncCollectionOptions<T>({
      id: `conformance-solid-${sourceSeq++}`,
      getKey: (r) => r.id,
      initialData: [...initialData],
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

function makePrecreated(build: QueryBuild, opts?: { startSync?: boolean }) {
  const collection = createLiveQueryCollection({
    query: build as any,
    startSync: opts?.startSync ?? true,
  })
  return { collection }
}

function makeErrorSource() {
  const collection = createCollection<{ id: string }>({
    id: `conformance-solid-err-${sourceSeq++}`,
    getKey: (r) => r.id,
    startSync: false,
    sync: {
      sync: () => {
        throw new Error(`conformance: sync failure`)
      },
    },
  })
  try {
    collection.startSyncImmediate()
  } catch {
    // expected: engine catches the sync error and sets status to `error`
  }
  return { collection }
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 10))
}

function makeHandle(
  getResult: () => any,
  dispose: () => void,
): LiveQueryHandle {
  return {
    current(): ConformanceResult {
      const result = getResult()
      return {
        data: result?.data,
        state: result?.state,
        status: result?.status ?? `idle`,
        isReady: Boolean(result?.isReady),
        isError: Boolean(result?.isError),
        // solid-db exposes no `isEnabled`; derive it from status (status-derived).
        isEnabled: result?.status !== `disabled`,
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
  createRoot((d) => {
    dispose = d
    result = fn()
  })
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

function mountConfig(build: QueryBuild) {
  // Solid accepts the config-object form via an accessor.
  const { getResult, dispose } = inRoot(() =>
    useLiveQuery(() => ({ query: build })),
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
): ControllableHandle<P> {
  const [param, setParam] = createSignal<P>(initial)
  const { getResult, dispose } = inRoot(() =>
    // Reading param() inside the query fn makes Solid recompute on change.
    useLiveQuery((q: any) => build(q, param())),
  )
  const handle = makeHandle(getResult, dispose)
  return {
    ...handle,
    async setParam(next: P) {
      setParam(() => next)
      await settle()
    },
  }
}

const solidDriver: LiveQueryDriver = {
  name: `solid`,
  ops: { eq, gt, count, sum, coalesce, createOptimisticAction },
  makeSource,
  makeDeferredSource,
  makePrecreated,
  makeErrorSource,
  mount,
  mountControllable,
  mountCollection,
  mountConfig,
  mountDisabled,
  // solid-db routes errors through its createResource/Suspense path: reading an
  // errored query throws (CollectionStateError) for an <ErrorBoundary> to catch,
  // rather than exposing a readable isError flag. That's a framework idiom, not a
  // gap — the error-status scenario is parametrized to assert it via the boundary.
  errorSurface: `throw`,
  knownGaps: [],
  features: { serverSnapshot: false, suspense: true },
}

runSuite(solidDriver)
