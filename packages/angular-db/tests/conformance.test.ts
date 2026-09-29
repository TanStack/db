/**
 * Angular driver for the shared live-query conformance suite.
 *
 * `injectLiveQuery` needs an injection context, so each mount runs inside a
 * child `EnvironmentInjector` created off TestBed's; `unmount` calls
 * `injector.destroy()`, firing the `DestroyRef` cleanup. Result signals are read
 * after settling. Controllable inputs use Angular's reactive `{ params, query }`
 * form driven by a signal.
 *
 * All registered laws must pass; the driver has no whole-test waivers.
 */
import { describe, expect, it } from 'vitest'
import {
  DestroyRef,
  EnvironmentInjector,
  createEnvironmentInjector,
  inject,
  runInInjectionContext,
  signal,
} from '@angular/core'
import { TestBed } from '@angular/core/testing'
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
import { injectLiveQuery } from '../src/index'
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
      id: `conformance-angular-${sourceSeq++}`,
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
      id: `conformance-angular-${sourceSeq++}`,
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
    id: `conformance-angular-err-${sourceSeq++}`,
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
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 50))
}

function makeHandle(result: any, destroy: () => void): LiveQueryHandle {
  return {
    current(): ConformanceResult {
      return expectResultSurface({
        data: result.data(),
        state: result.state(),
        status: result.status(),
        isReady: result.isReady(),
        isError: result.isError(),
        // angular-db exposes no `isEnabled`; derive it from status (status-derived).
        isEnabled: result.status() !== `disabled`,
      })
    },
    flush: settle,
    async apply(fn: () => void) {
      fn()
      await settle()
    },
    unmount() {
      destroy()
    },
  }
}

function inCtx(fn: () => any): { result: any; destroy: () => void } {
  const parent = TestBed.inject(EnvironmentInjector)
  const injector = createEnvironmentInjector([], parent)
  let result: any
  withScopeSetup(
    () =>
      runInInjectionContext(injector, () => {
        result = fn()
      }),
    () => injector.destroy(),
  )
  return { result, destroy: () => injector.destroy() }
}

function mount(build: QueryBuild) {
  const { result, destroy } = inCtx(() => injectLiveQuery(build as any))
  return makeHandle(result, destroy)
}

function mountCollection(collection: any) {
  const { result, destroy } = inCtx(() => injectLiveQuery(collection))
  return makeHandle(result, destroy)
}

function mountConfig(build: QueryBuild) {
  const { result, destroy } = inCtx(() => injectLiveQuery({ query: build }))
  return makeHandle(result, destroy)
}

function mountDisabled() {
  const { result, destroy } = inCtx(() => injectLiveQuery(() => null))
  return makeHandle(result, destroy)
}

function mountControllable<P>(
  build: (q: any, param: P) => any,
  initial: P,
): ControllableHandle<P> {
  const param = signal<P>(initial)
  const { result, destroy } = inCtx(() =>
    injectLiveQuery({
      params: () => ({ value: param() }),
      query: ({ params, q }: any) => build(q, params.value),
    }),
  )
  const handle = makeHandle(result, destroy)
  return {
    ...handle,
    async setParam(next: P) {
      param.set(next)
      await settle()
    },
  }
}

const angularDriver: LiveQueryDriver = {
  name: `angular`,
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
  knownGaps: [],
  features: { serverSnapshot: false, suspense: false },
}

describe(`owned native scope setup`, () => {
  it(`keeps a successful scope alive until explicit disposal`, () => {
    let calls = 0
    const handle = inCtx(() => {
      inject(DestroyRef).onDestroy(() => {
        calls++
      })
      return 7
    })
    expect(calls).toBe(0)
    handle.destroy()
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
        inCtx(() => {
          inject(DestroyRef).onDestroy(() => {
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

runSuite(angularDriver)
it(`preserves raw result types through the actual driver reader`, () => {
  const raw: Record<string, unknown> = {
    data: [{ id: `a`, value: undefined }],
    state: new Map(),
    status: `disabled`,
    isReady: false,
    isError: false,
    isEnabled: false,
  }
  const result = Object.fromEntries(
    Object.keys(raw).map((key) => [key, () => raw[key]]),
  )
  const handle = makeHandle(result, () => {})
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
