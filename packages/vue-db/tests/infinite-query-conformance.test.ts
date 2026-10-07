/**
 * Vue driver for the shared infinite-query conformance suite.
 *
 * The effect scope owns the hook, and `nextTick` defines Vue's observation cut.
 * Sources and query operators stay in this package's module realm. The shared
 * suite, not this bridge, owns the ordered-prefix and page-ledger model.
 */
import {
  BTreeIndex,
  createCollection,
  createLiveQueryCollection,
  createLiveQueryWindowController,
  gt,
} from '@tanstack/db'
import {
  effectScope,
  nextTick,
  onScopeDispose,
  reactive,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { describe, expect, it } from 'vitest'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import { runInfiniteQuerySuite } from '../../db/tests/conformance/infinite-suite-oracle'
import { makeInfiniteOnDemandSource } from '../../db/tests/conformance/infinite-on-demand'
import { withScopeSetup } from '../../db/tests/conformance/scope-setup'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
import type {
  InfiniteQueryConfig,
  InfiniteQueryDriver,
  InfiniteQueryHandle,
  InfiniteQueryObservation,
} from '../../db/tests/conformance/infinite-contract'
import type {
  QueryBuild,
  SourceHandle,
} from '../../db/tests/conformance/contract'

let sourceSequence = 0

function makeSource<T extends { id: string }>(
  initialData: ReadonlyArray<T>,
): SourceHandle<T> {
  const collection = createCollection(
    mockSyncCollectionOptions<T>({
      autoIndex: `eager`,
      id: `infinite-conformance-vue-${sourceSequence++}`,
      getKey: (row) => row.id,
      initialData: [...initialData],
    }),
  )
  const write = (type: `insert` | `update` | `delete`, value: T) => {
    collection.utils.begin()
    collection.utils.write({ type, value })
    collection.utils.commit()
  }
  return {
    collection,
    insert: (row) => write(`insert`, row),
    update: (row) => write(`update`, row),
    remove: (row) => write(`delete`, row),
  }
}

function makePrecreated(build: QueryBuild) {
  return {
    collection: createLiveQueryCollection({ query: build as any }),
  }
}

async function settle(): Promise<void> {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function runInScope<R>(fn: () => R) {
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

type Observations = Array<InfiniteQueryObservation>

function observe(result: any): InfiniteQueryObservation {
  return {
    status: result.status.value,
    ids: result.data.value.map((row: { id: string }) => row.id),
    pages: result.pages.value.map((page: Array<{ id: string }>) =>
      page.map((row) => row.id),
    ),
    hasNextPage: result.hasNextPage.value,
  }
}

// Vue renders the value present after setup, then at each pre-flush. A
// pre-flush watcher sees what a component would render, not each synchronous
// intermediate write that the same tick overwrites.
function recordPublications<R>(result: R, log: Observations): R {
  log.push(observe(result))
  watch(
    () => observe(result),
    (observation) => {
      log.push(observation)
    },
    { flush: `pre` },
  )
  return result
}

function makeHandle(
  result: any,
  scope: ReturnType<typeof effectScope>,
  log: Observations,
): InfiniteQueryHandle {
  return {
    observations: () => log,
    current() {
      return {
        data: result.data.value,
        pages: result.pages.value,
        pageParams: result.pageParams.value,
        hasNextPage: result.hasNextPage.value,
        isFetchingNextPage: result.isFetchingNextPage.value,
        error: result.error.value,
        status: result.status.value,
        collection: result.collection.value,
      }
    },
    fetchNextPage: () => result.fetchNextPage(),
    flush: settle,
    async apply(fn) {
      fn()
      await settle()
    },
    unmount() {
      scope.stop()
    },
  }
}

function mount(build: QueryBuild, config: InfiniteQueryConfig = {}) {
  const log: Observations = []
  const { result, scope } = runInScope(() =>
    recordPublications(useLiveInfiniteQuery(build as any, config as any), log),
  )
  return makeHandle(result, scope, log)
}

function mountControllable<P>(
  build: (q: any, param: P) => any,
  initial: P,
  config: InfiniteQueryConfig = {},
) {
  const param = ref(initial) as { value: P }
  const log: Observations = []
  const { result, scope } = runInScope(() =>
    recordPublications(
      useLiveInfiniteQuery((q: any) => build(q, param.value), config as any, [
        param,
      ]),
      log,
    ),
  )
  const handle = makeHandle(result, scope, log)
  return {
    ...handle,
    setParamSync(next: P) {
      param.value = next
    },
  }
}

function mountCollection(collection: any, config: InfiniteQueryConfig = {}) {
  const log: Observations = []
  const { result, scope } = runInScope(() =>
    recordPublications(useLiveInfiniteQuery(collection, config as any), log),
  )
  return makeHandle(result, scope, log)
}

function mountCollectionControllable(
  initial: any,
  config: InfiniteQueryConfig = {},
) {
  const collection = shallowRef(initial)
  const log: Observations = []
  const { result, scope } = runInScope(() =>
    recordPublications(useLiveInfiniteQuery(collection, config as any), log),
  )
  const handle = makeHandle(result, scope, log)
  return {
    ...handle,
    replaceCollectionSync(next: any) {
      collection.value = next
    },
  }
}

function mountConfigControllable(
  build: QueryBuild,
  initial: InfiniteQueryConfig,
) {
  const config = reactive({ ...initial })
  const log: Observations = []
  const { result, scope } = runInScope(() =>
    recordPublications(useLiveInfiniteQuery(build as any, config as any), log),
  )
  const handle = makeHandle(result, scope, log)
  return {
    ...handle,
    setConfigSync(next: InfiniteQueryConfig) {
      delete config.pageSize
      delete config.initialPageParam
      Object.assign(config, next)
    },
  }
}

function mountInputControllable(
  collection: any,
  build: QueryBuild,
  config: InfiniteQueryConfig = {},
) {
  const kind = ref<`collection` | `query`>(`collection`)
  const log: Observations = []
  const { result, scope } = runInScope(() =>
    recordPublications(
      useLiveInfiniteQuery(
        (q: any) => (kind.value === `collection` ? collection : build(q)),
        config as any,
        [kind],
      ),
      log,
    ),
  )
  const handle = makeHandle(result, scope, log)
  return {
    ...handle,
    setInputKindSync(next: `collection` | `query`) {
      kind.value = next
    },
  }
}

const vueInfiniteDriver: InfiniteQueryDriver = {
  name: `vue`,
  gt,
  makeSource,
  makeOnDemandSource: (data, delay) =>
    makeInfiniteOnDemandSource({ createCollection, BTreeIndex }, data, delay),
  makePrecreated,
  makeWindowController: createLiveQueryWindowController,
  mount,
  mountControllable,
  mountCollection,
  mountCollectionControllable,
  mountConfigControllable,
  mountInputControllable,
  knownGaps: [],
}

runInfiniteQuerySuite(vueInfiniteDriver)

describe(`infinite driver scope ownership`, () => {
  it(`retains successful scope until its owner disposes`, () => {
    let calls = 0
    const { scope } = runInScope(() =>
      onScopeDispose(() => {
        calls++
      }),
    )
    expect(calls).toBe(0)
    scope.stop()
    expect(calls).toBe(1)
  })
  it.each([false, true])(
    `cleans failed setup, cleanupFails=%s`,
    (cleanupFails) => {
      const primary = new Error(`setup`)
      const secondary = new Error(`cleanup`)
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
