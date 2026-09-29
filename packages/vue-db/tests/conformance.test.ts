/**
 * Vue driver for the shared live-query conformance suite.
 *
 * Realm-sensitive pieces (collection factories, query operators) are imported
 * from Vue's `@tanstack/db` and handed to the shared scenarios. Vue composables
 * run inside an `effectScope` so `unmount` can dispose them via `scope.stop()`,
 * which triggers the `watchEffect` `onInvalidate` cleanup.
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
import { effectScope, nextTick, onScopeDispose, ref } from 'vue'
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
      id: `conformance-vue-${sourceSeq++}`,
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
      id: `conformance-vue-${sourceSeq++}`,
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
    id: `conformance-vue-err-${sourceSeq++}`,
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
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 10))
}

function makeHandle(result: any, scope: ReturnType<typeof effectScope>) {
  const handle: LiveQueryHandle = {
    current(): ConformanceResult {
      return expectResultSurface({
        data: result.data?.value,
        state: result.state?.value,
        status: result.status?.value,
        isReady: result.isReady?.value,
        isError: result.isError?.value,
        // vue-db exposes no `isEnabled`; derive it from status (status-derived).
        isEnabled: result.status?.value !== `disabled`,
      })
    },
    flush: settle,
    async apply(fn: () => void) {
      fn()
      await settle()
    },
    unmount() {
      scope.stop()
    },
  }
  return handle
}

function runInScope<R>(fn: () => R): {
  result: R
  scope: ReturnType<typeof effectScope>
} {
  const scope = effectScope()
  let result!: R
  withScopeSetup(
    () =>
      scope.run(() => {
        result = fn()
      }),
    () => scope.stop(),
  )
  return { result, scope }
}

function mount(build: QueryBuild) {
  const { result, scope } = runInScope(() => useLiveQuery(build as any))
  return makeHandle(result, scope)
}

function mountCollection(collection: any) {
  const { result, scope } = runInScope(() => useLiveQuery(collection))
  return makeHandle(result, scope)
}

function mountConfig(build: QueryBuild) {
  const { result, scope } = runInScope(() =>
    useLiveQuery({ query: build } as any),
  )
  return makeHandle(result, scope)
}

function mountDisabled() {
  // Vue's disabled convention: the query callback returns undefined.
  const { result, scope } = runInScope(() =>
    useLiveQuery(() => undefined as any),
  )
  return makeHandle(result, scope)
}

function mountControllable<P>(
  build: (q: any, param: P) => any,
  initial: P,
): ControllableHandle<P> {
  const param = ref(initial) as { value: P }
  const { result, scope } = runInScope(() =>
    useLiveQuery((q: any) => build(q, param.value), [() => param.value]),
  )
  const handle = makeHandle(result, scope)
  return {
    ...handle,
    async setParam(next: P) {
      param.value = next
      await settle()
    },
  }
}

const vueDriver: LiveQueryDriver = {
  name: `vue`,
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
    const handle = runInScope(() => {
      onScopeDispose(() => {
        calls++
      })
      return 7
    })
    expect(calls).toBe(0)
    handle.scope.stop()
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
        runInScope(() => {
          onScopeDispose(() => {
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

runSuite(vueDriver)
it(`preserves raw result types through the actual driver reader`, () => {
  const raw: Record<string, unknown> = {
    data: [{ id: `a`, value: undefined }],
    state: new Map(),
    status: `disabled`,
    isReady: false,
    isError: false,
    isEnabled: false,
  }
  const scope = effectScope()
  const result = Object.fromEntries(
    Object.keys(raw).map((key) => [
      key,
      {
        get value() {
          return raw[key]
        },
      },
    ]),
  )
  const handle = makeHandle(result, scope)
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
