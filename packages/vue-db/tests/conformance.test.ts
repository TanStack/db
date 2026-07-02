/**
 * Vue driver for the shared live-query conformance suite (#1623).
 *
 * Realm-sensitive pieces (collection factories, query operators) are imported
 * from Vue's `@tanstack/db` and handed to the shared scenarios. Vue composables
 * run inside an `effectScope` so `unmount` can dispose them via `scope.stop()`,
 * which triggers the `watchEffect` `onInvalidate` cleanup.
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
import { effectScope, nextTick, ref } from 'vue'
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

function makeDeferredSource<T extends { id: string }>(): DeferredSourceHandle<T> {
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
  const collection = createCollection<{ id: string }>({
    id: `conformance-vue-err-${sourceSeq++}`,
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
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 10))
}

function makeHandle(result: any, scope: ReturnType<typeof effectScope>) {
  const handle: LiveQueryHandle = {
    current(): ConformanceResult {
      return {
        data: result.data?.value,
        status: result.status?.value ?? `idle`,
        isReady: Boolean(result.isReady?.value),
        isError: Boolean(result.isError?.value),
        isEnabled: result.status?.value !== `disabled`,
      }
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

function runInScope<R>(fn: () => R): { result: R; scope: ReturnType<typeof effectScope> } {
  const scope = effectScope()
  let result!: R
  scope.run(() => {
    result = fn()
  })
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

runSuite(vueDriver)
