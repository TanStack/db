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
  gt,
  sum,
} from '@tanstack/db'
import { createRoot, createSignal, onCleanup } from 'solid-js'
import {
  mockSyncCollectionOptions,
  mockSyncCollectionOptionsNoInitialState,
} from '../../db/tests/utils'
import { useLiveQuery } from '../src/useLiveQuery'
import { runSuite } from '../../db/tests/conformance/suite'
import { expectResultSurface } from '../../db/tests/conformance/result-laws'
import { withScopeSetup } from '../../db/tests/conformance/scope-setup'
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
  const expectedError = new Error(`conformance: sync failure`)
  let startup: { returned: true } | { returned: false; error: unknown } = {
    returned: true,
  }
  const collection = createCollection<{ id: string }>({
    id: `conformance-solid-err-${sourceSeq++}`,
    getKey: (r) => r.id,
    startSync: false,
    sync: {
      sync: () => {
        throw expectedError
      },
    },
  })
  try {
    collection.startSyncImmediate()
  } catch (error) {
    startup = { returned: false, error }
  }
  return { collection, expectedError, startup }
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
      return expectResultSurface({
        data: result?.data,
        state: result?.state,
        status: result?.status,
        isReady: result?.isReady,
        isError: result?.isError,
        // solid-db exposes no `isEnabled`; derive it from status (status-derived).
        isEnabled: result?.status !== `disabled`,
      })
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
  disabledRepresentation: `empty-reactive`,
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
it(`preserves raw result types through the actual driver reader`, () => {
  const raw: Record<string, unknown> = {
    data: [{ id: `a`, value: undefined }],
    state: new Map(),
    status: `disabled`,
    isReady: false,
    isError: false,
    isEnabled: false,
  }
  const handle = makeHandle(
    () => raw,
    () => {},
  )
  try {
    const healthy = handle.current()
    expect(healthy.data).toBe(raw.data)
    expect(healthy.state).toBe(raw.state)
    expect(healthy.isReady).toBe(false)
    expect(healthy.isError).toBe(false)
    expect(healthy.isEnabled).toBe(false)
    for (const key of [`status`, `isReady`, `isError`]) {
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
