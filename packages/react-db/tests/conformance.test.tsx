/**
 * React reference driver for the shared live-query conformance suite (#1623).
 *
 * Everything realm-sensitive — collection creation and query operators — is
 * imported here (React package's `@tanstack/db`) and handed to the shared
 * scenarios, so instances match what this package's `useLiveQuery` expects.
 *
 * `knownGaps` is populated empirically from the run below, NOT from the coverage
 * matrix: only keys that actually fail belong here. Today that's just the
 * universal #1601 case (handled by the shared suite), so the list is empty.
 */
import { act, renderHook } from '@testing-library/react'
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
      id: `conformance-react-${sourceSeq++}`,
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
      id: `conformance-react-${sourceSeq++}`,
      getKey: (r) => r.id,
    }),
  )
  // Start sync so the sync fn binds utils and the collection sits in `loading`
  // (NoInitialState never calls markReady on its own).
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
    id: `conformance-react-err-${sourceSeq++}`,
    getKey: (r) => r.id,
    startSync: false,
    sync: {
      sync: () => {
        throw new Error(`conformance: sync failure`)
      },
    },
  })
  // Starting sync throws → engine catches and sets status to `error`.
  try {
    collection.startSyncImmediate()
  } catch {
    // expected: the rethrown sync error; status is already `error`
  }
  return { collection }
}

function mount(build: QueryBuild) {
  const hook = renderHook(() => useLiveQuery(build as any))
  return makeHandle(hook)
}

function mountCollection(collection: any) {
  const hook = renderHook(() => useLiveQuery(collection))
  return makeHandle(hook)
}

function mountConfig(build: QueryBuild) {
  const hook = renderHook(() => useLiveQuery({ query: build as any }))
  return makeHandle(hook)
}

function mountDisabled() {
  // React's disabled convention: the query callback returns null.
  const hook = renderHook(() => useLiveQuery(() => null as any))
  return makeHandle(hook)
}

function mountControllable<P>(
  build: (q: any, param: P) => any,
  initial: P,
): ControllableHandle<P> {
  const hook = renderHook(
    ({ param }: { param: P }) =>
      // Param goes in the dependency list so the hook recompiles when it changes.
      useLiveQuery((q: any) => build(q, param), [param]),
    { initialProps: { param: initial } },
  )
  const handle = makeHandle(hook)
  return {
    ...handle,
    async setParam(param: P) {
      await act(async () => {
        hook.rerender({ param })
      })
      await handle.flush()
    },
  }
}

function makeHandle(hook: ReturnType<typeof renderHook>) {
  return {
    current(): ConformanceResult {
      const r: any = hook.result.current
      return {
        data: r?.data,
        status: r?.status ?? `idle`,
        isReady: Boolean(r?.isReady),
        isError: Boolean(r?.isError),
        isEnabled: r?.status !== `disabled`,
      }
    },
    async flush() {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    },
    async apply(fn: () => void) {
      await act(async () => {
        fn()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    },
    unmount() {
      hook.unmount()
    },
  }
}

const reactDriver: LiveQueryDriver = {
  name: `react`,
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
  knownGaps: [],
  features: { serverSnapshot: true, suspense: true },
}

runSuite(reactDriver)
