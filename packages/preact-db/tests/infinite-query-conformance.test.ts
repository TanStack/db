/**
 * Preact driver for the shared infinite-query conformance suite.
 *
 * The probe in `render-probe.ts`, `act`, and the hook result are the only
 * Preact-specific layer. Sources and query operators come from this package's
 * module realm. The shared suite owns the page model and histories; this
 * driver defines when Preact has committed enough work for those public
 * observations to be read.
 *
 * Publication cut: Preact publishes at each commit, and the probe records
 * every committed value in a layout effect. Preact has no render that skips
 * its commit, so the first observation is the first paint.
 *
 * Controllable mounts capture their parameter in the query callback. The hook
 * derives identity from the query IR, so a changed parameter recompiles and a
 * structurally equal one keeps the loaded pages. `setParamSync` rerenders
 * inside `act`, which commits and attaches the replacement subscription before
 * it returns.
 */
import { act } from 'preact/test-utils'
import {
  BTreeIndex,
  createCollection,
  createLiveQueryCollection,
  createLiveQueryWindowController,
  eq,
  gt,
} from '@tanstack/db'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import { runInfiniteQuerySuite } from '../../db/tests/conformance/infinite-suite-oracle'
import { makeInfiniteOnDemandSource } from '../../db/tests/conformance/infinite-on-demand'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
import { renderHook, settle } from './render-probe'
import type { MountedHook } from './render-probe'
import type {
  InfiniteQueryConfig,
  InfiniteQueryDriver,
  InfiniteQueryHandle,
  InfiniteQueryObservation,
} from '../../db/tests/conformance/infinite-contract'
import type { QueryBuild } from '../../db/tests/conformance/contract'

let sourceSequence = 0

function makeSource<T extends { id: string }>(
  initialData: ReadonlyArray<T>,
  collectionId?: string,
) {
  const collection = createCollection(
    mockSyncCollectionOptions<T>({
      autoIndex: `eager`,
      id: collectionId ?? `infinite-conformance-preact-${sourceSequence++}`,
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
    insert: (row: T) => write(`insert`, row),
    update: (row: T) => write(`update`, row),
    remove: (row: T) => write(`delete`, row),
  }
}

function makePrecreated(build: QueryBuild) {
  return {
    collection: createLiveQueryCollection({ query: build as any }),
  }
}

type Observations = Array<InfiniteQueryObservation>

function observe(result: any): InfiniteQueryObservation {
  return {
    status: result.status,
    ids: result.data.map((row: { id: string }) => row.id),
    pages: result.pages.map((page: Array<{ id: string }>) =>
      page.map((row) => row.id),
    ),
    hasNextPage: result.hasNextPage,
  }
}

/** Mount and record every committed value as an observation. */
function mountRecorded<P>(
  useResult: (props: P) => unknown,
  initialProps?: P,
): { hook: MountedHook<P>; log: Observations } {
  const log: Observations = []
  const hook = renderHook(useResult, {
    initialProps,
    onCommit: (result) => log.push(observe(result)),
  })
  return { hook, log }
}

function makeHandle(
  hook: MountedHook<any>,
  log: Observations,
): InfiniteQueryHandle {
  return {
    current() {
      const result = hook.result.current
      return {
        data: result.data,
        pages: result.pages,
        pageParams: result.pageParams,
        hasNextPage: result.hasNextPage,
        isFetchingNextPage: result.isFetchingNextPage,
        error: result.error,
        status: result.status,
        collection: result.collection,
      }
    },
    observations: () => log,
    fetchNextPage() {
      let request!: Promise<void>
      act(() => {
        request = hook.result.current.fetchNextPage()
      })
      return request
    },
    flush: settle,
    async apply(fn) {
      await act(async () => {
        fn()
        await Promise.resolve()
      })
    },
    unmount() {
      hook.unmount()
    },
  }
}

function rerenderSync<P>(hook: MountedHook<P>, props: P): void {
  // The probe rerenders inside `act`, so the commit and the replacement
  // subscription complete before this returns.
  hook.rerender(props)
}

function mount(build: QueryBuild, config: InfiniteQueryConfig = {}) {
  const { hook, log } = mountRecorded(() =>
    useLiveInfiniteQuery(build as any, config as any),
  )
  return makeHandle(hook, log)
}

function mountControllable<P>(
  build: (q: any, param: P) => any,
  initial: P,
  config: InfiniteQueryConfig = {},
) {
  const { hook, log } = mountRecorded(
    ({ param }: { param: P }) =>
      useLiveInfiniteQuery((q: any) => build(q, param), config as any),
    { param: initial },
  )
  return {
    ...makeHandle(hook, log),
    setParamSync: (param: P) => rerenderSync(hook, { param }),
  }
}

// The keyed form: the config names a queryKey chosen per step, or none.
function mountKeyedControllable<P>(
  build: (q: any, param: P) => any,
  key: (param: P) => ReadonlyArray<unknown> | undefined,
  initial: P,
  config: InfiniteQueryConfig = {},
) {
  const { hook, log } = mountRecorded(
    ({ param }: { param: P }) =>
      useLiveInfiniteQuery((q: any) => build(q, param), {
        ...config,
        queryKey: key(param),
      } as any),
    { param: initial },
  )
  return {
    ...makeHandle(hook, log),
    setParamSync: (param: P) => rerenderSync(hook, { param }),
  }
}

function mountCollection(collection: any, config: InfiniteQueryConfig = {}) {
  const { hook, log } = mountRecorded(() =>
    useLiveInfiniteQuery(collection, config as any),
  )
  return makeHandle(hook, log)
}

function mountCollectionControllable(
  initial: any,
  config: InfiniteQueryConfig = {},
) {
  const { hook, log } = mountRecorded(
    ({ collection }: { collection: any }) =>
      useLiveInfiniteQuery(collection, config as any),
    { collection: initial },
  )
  return {
    ...makeHandle(hook, log),
    replaceCollectionSync: (collection: any) =>
      rerenderSync(hook, { collection }),
  }
}

function mountConfigControllable(
  build: QueryBuild,
  initial: InfiniteQueryConfig,
) {
  const { hook, log } = mountRecorded(
    ({ config }: { config: InfiniteQueryConfig }) =>
      useLiveInfiniteQuery(build as any, config as any),
    { config: initial },
  )
  return {
    ...makeHandle(hook, log),
    setConfigSync: (config: InfiniteQueryConfig) =>
      rerenderSync(hook, { config }),
  }
}

function mountInputControllable(
  collection: any,
  build: QueryBuild,
  config: InfiniteQueryConfig = {},
) {
  type Kind = `collection` | `query`
  const { hook, log } = mountRecorded(
    ({ kind }: { kind: Kind }) =>
      useLiveInfiniteQuery(
        kind === `collection` ? collection : build,
        config as any,
      ),
    { kind: `collection` as Kind },
  )
  return {
    ...makeHandle(hook, log),
    setInputKindSync: (kind: Kind) => rerenderSync(hook, { kind }),
  }
}

const preactInfiniteDriver: InfiniteQueryDriver = {
  name: `preact`,
  // Each render re-runs the query input and compares its identity.
  comparesQueryIdentity: true,
  gt,
  eq,
  makeSource,
  makeOnDemandSource: (data, delay) =>
    makeInfiniteOnDemandSource({ createCollection, BTreeIndex }, data, delay),
  makeLaggingOnDemandSource: (data) =>
    makeInfiniteOnDemandSource(
      { createCollection, BTreeIndex },
      data,
      undefined,
      `lagging`,
    ),
  makePrecreated,
  makeWindowController: createLiveQueryWindowController,
  mount,
  mountControllable,
  mountKeyedControllable,
  mountCollection,
  mountCollectionControllable,
  mountConfigControllable,
  mountInputControllable,
  knownGaps: [],
}

runInfiniteQuerySuite(preactInfiniteDriver)
