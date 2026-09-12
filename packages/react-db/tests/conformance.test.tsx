/**
 * React reference driver for the shared live-query conformance suite.
 *
 * Everything realm-sensitive — collection creation and query operators — is
 * imported here (React package's `@tanstack/db`) and handed to the shared
 * scenarios, so instances match what this package's `useLiveQuery` expects.
 *
 * All registered laws must pass; the driver has no whole-test waivers.
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
import { expect, it } from 'vitest'
import {
  mockSyncCollectionOptions,
  mockSyncCollectionOptionsNoInitialState,
} from '../../db/tests/utils'
import { useLiveQuery } from '../src/useLiveQuery'
import { runSuite } from '../../db/tests/conformance/suite'
import { expectResultSurface } from '../../db/tests/conformance/result-laws'
import type { RenderHookResult } from '@testing-library/react'
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
  const expectedError = new Error(`conformance: sync failure`)
  let startup: { returned: true } | { returned: false; error: unknown } = {
    returned: true,
  }
  const collection = createCollection<{ id: string }>({
    id: `conformance-react-err-${sourceSeq++}`,
    getKey: (r) => r.id,
    startSync: false,
    sync: {
      sync: () => {
        throw expectedError
      },
    },
  })
  // Starting sync throws → engine catches and sets status to `error`.
  try {
    collection.startSyncImmediate()
  } catch (error) {
    startup = { returned: false, error }
  }
  return { collection, expectedError, startup }
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

function makeHandle(hook: RenderHookResult<any, any>) {
  return {
    current(): ConformanceResult {
      const r: any = hook.result.current
      return expectResultSurface({
        data: r?.data,
        state: r?.state,
        status: r?.status,
        isReady: r?.isReady,
        isError: r?.isError,
        // Read react-db's real `isEnabled` field so the suite catches a broken
        // one (deriving from status would mask it).
        isEnabled: r?.isEnabled,
      })
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
  disabledRepresentation: `absent`,
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
it(`preserves raw result types through the actual driver reader`, () => {
  const raw: Record<string, unknown> = {
    data: [{ id: `a`, value: undefined }],
    state: new Map(),
    status: `disabled`,
    isReady: false,
    isError: false,
    isEnabled: false,
  }
  const hook = renderHook(() => raw)
  const handle = makeHandle(hook)
  try {
    const healthy = handle.current()
    expect(healthy.data).toBe(raw.data)
    expect(healthy.state).toBe(raw.state)
    expect(healthy.isReady).toBe(false)
    expect(healthy.isError).toBe(false)
    expect(healthy.isEnabled).toBe(false)
    for (const key of [`status`, `isReady`, `isError`, `isEnabled`]) {
      const original = raw[key]
      delete raw[key]
      expect(() => handle.current()).toThrowError(new RegExp(`raw ${key}`))
      for (const invalid of key === `status`
        ? [undefined, 0]
        : [undefined, 0, ``]) {
        raw[key] = invalid
        expect(() => handle.current()).toThrowError(new RegExp(`raw ${key}`))
      }
      raw[key] = original
      expect(handle.current()[key as keyof ConformanceResult]).toBe(original)
    }
  } finally {
    handle.unmount()
  }
})
