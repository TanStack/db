/**
 * Angular driver for the shared live-query conformance suite (#1623).
 *
 * `injectLiveQuery` needs an injection context, so each mount runs inside a
 * child `EnvironmentInjector` created off TestBed's; `unmount` calls
 * `injector.destroy()`, firing the `DestroyRef` cleanup. Result signals are read
 * after settling. Controllable inputs use Angular's reactive `{ params, query }`
 * form driven by a signal.
 *
 * `knownGaps` is populated empirically from the run below.
 */
import {
  EnvironmentInjector,
  createEnvironmentInjector,
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
  const collection = createCollection<{ id: string }>({
    id: `conformance-angular-err-${sourceSeq++}`,
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
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 50))
}

function makeHandle(result: any, destroy: () => void): LiveQueryHandle {
  return {
    current(): ConformanceResult {
      return {
        data: result.data(),
        status: result.status(),
        isReady: Boolean(result.isReady()),
        isError: Boolean(result.isError()),
        isEnabled: result.status() !== `disabled`,
      }
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
  runInInjectionContext(injector, () => {
    result = fn()
  })
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
  // Divergence the suite surfaced: angular-db's plain `{ query }` config-object
  // path calls createLiveQueryCollection(opts) as-is, without injecting
  // startSync:true the way the query-fn path does — so a bare `{ query }` never
  // syncs and returns empty. React/Vue/Svelte/Solid all auto-start a config
  // object; Angular requires an explicit `startSync: true` (its own config test
  // passes it). Recorded until angular-db aligns.
  knownGaps: [`config-object-input`],
  features: { serverSnapshot: false, suspense: false },
}

runSuite(angularDriver)
