/**
 * Preact driver for the shared live-query conformance suite.
 *
 * Everything realm-sensitive — collection creation and query operators — is
 * imported here (Preact package's `@tanstack/db`) and handed to the shared
 * scenarios, so instances match what this package's `useLiveQuery` expects.
 *
 * Observation cut: `render-probe.ts` records the hook result at each Preact
 * commit. `flush` is one `act` around a macrotask, so framework updates and
 * core sync settle before the suite reads the last committed result. A
 * rejected query throws from the mount or from `setParam`'s rerender.
 *
 * `mountControllable` captures its parameter in the query callback instead of
 * passing a dependency list. The hook derives identity from the query IR, so
 * this exercises recompilation through the public API that Preact offers.
 *
 * All registered laws must pass; the driver has no whole-test waivers.
 */
import { act } from 'preact/test-utils'
import {
  coalesce,
  count,
  createCollection,
  createLiveQueryCollection,
  createOptimisticAction,
  eq,
  groupKeys,
  gt,
  sum,
} from '@tanstack/db'
import {
  mockSyncCollectionOptions,
  mockSyncCollectionOptionsNoInitialState,
} from '../../db/tests/utils'
import { useLiveQuery } from '../src/useLiveQuery'
import { runSuite } from '../../db/tests/conformance/suite'
import { createPublicationLog } from '../../db/tests/conformance/publication-log'
import { makeLaggingSource } from '../../db/tests/conformance/lagging-source'
import { expectResultSurface } from '../../db/tests/conformance/result-laws'
import { renderHook, settle } from './render-probe'
import type { MountedHook } from './render-probe'
import type { PooledLiveQueries } from '@tanstack/db'
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
  collectionId?: string,
): SourceHandle<T> {
  const collection = createCollection(
    mockSyncCollectionOptions<T>({
      id: collectionId ?? `conformance-preact-${sourceSeq++}`,
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
      id: `conformance-preact-${sourceSeq++}`,
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

function makePrecreated(
  build: QueryBuild,
  opts?: { startSync?: boolean; gcTime?: number },
) {
  const collection = createLiveQueryCollection({
    query: build as any,
    startSync: opts?.startSync ?? true,
    gcTime: opts?.gcTime,
  })
  return { collection }
}

function makeErrorSource() {
  const expectedError = new Error(`conformance: sync failure`)
  let startup: { returned: true } | { returned: false; error: unknown } = {
    returned: true,
  }
  const collection = createCollection<{ id: string }>({
    id: `conformance-preact-err-${sourceSeq++}`,
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

function makeHandle(hook: MountedHook<any>): LiveQueryHandle {
  return {
    collection: () => hook.result.current?.collection ?? null,
    current(): ConformanceResult {
      const r: any = hook.result.current
      return expectResultSurface({
        data: r?.data,
        state: r?.state,
        status: r?.status,
        isReady: r?.isReady,
        persistedStatus: r?.persistedStatus,
        isPersistedReady: r?.isPersistedReady,
        persistedError: r?.persistedError,
        isError: r?.isError,
        // Read the hook's real `isEnabled` field so the suite catches a broken
        // one (deriving from status would mask it).
        isEnabled: r?.isEnabled,
      })
    },
    flush: settle,
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

function mount(build: QueryBuild) {
  return makeHandle(renderHook(() => useLiveQuery(build as any)))
}

function mountCollection(collection: any) {
  return makeHandle(renderHook(() => useLiveQuery(collection)))
}

function mountConfig(
  build: QueryBuild,
  opts?: {
    gcTime?: number
    pool?: PooledLiveQueries
    queryKey?: ReadonlyArray<unknown>
  },
) {
  return makeHandle(
    renderHook(() => useLiveQuery({ query: build as any, ...opts })),
  )
}

function mountDisabled() {
  // Preact's disabled convention: the query callback returns null.
  return makeHandle(renderHook(() => useLiveQuery(() => null as any)))
}

function mountControllable<P>(
  build: (q: any, param: P) => any,
  initial: P,
  opts?: { pool?: PooledLiveQueries },
): ControllableHandle<P> {
  const published = createPublicationLog()
  const hook = renderHook(
    ({ param }: { param: P }) =>
      opts?.pool !== undefined
        ? // The config form derives identity from the query on each render.
          useLiveQuery({ query: (q: any) => build(q, param), pool: opts.pool })
        : useLiveQuery((q: any) => build(q, param)),
    {
      initialProps: { param: initial },
      onCommit: (result) => published.record(result.data, result.state),
    },
  )
  const handle = makeHandle(hook)
  return {
    ...handle,
    publications: published.values,
    statePublications: published.stateValues,
    async setParam(param: P) {
      hook.rerender({ param })
      await settle()
    },
  }
}

// The config-object form with a queryKey chosen per step; an undefined key
// leaves the hook to derive the identity.
function mountKeyedControllable<P>(
  build: (q: any, param: P) => any,
  key: (param: P) => ReadonlyArray<unknown> | undefined,
  initial: P,
): ControllableHandle<P> {
  const published = createPublicationLog()
  const hook = renderHook(
    ({ param }: { param: P }) =>
      useLiveQuery({
        query: (q: any) => build(q, param),
        queryKey: key(param),
      } as any),
    {
      initialProps: { param: initial },
      onCommit: (result) => published.record(result.data, result.state),
    },
  )
  const handle = makeHandle(hook)
  return {
    ...handle,
    publications: published.values,
    statePublications: published.stateValues,
    async setParam(param: P) {
      hook.rerender({ param })
      await settle()
    },
  }
}

const preactDriver: LiveQueryDriver = {
  name: `preact`,
  // Each render re-runs the query input and compares its identity.
  comparesQueryIdentity: true,
  disabledRepresentation: `absent`,
  ops: { eq, gt, count, sum, coalesce, groupKeys, createOptimisticAction },
  makeSource,
  makeDeferredSource,
  makeLaggingSource: <T extends { id: string }>() =>
    makeLaggingSource<T>(
      createCollection,
      `conformance-preact-lagging-${sourceSeq++}`,
    ),
  makePrecreated,
  makeErrorSource,
  mount,
  mountControllable,
  mountKeyedControllable,
  mountCollection,
  mountConfig,
  mountDisabled,
  knownGaps: [],
  features: { serverSnapshot: false, suspense: false, pooledEqFilters: true },
}

runSuite(preactDriver)
