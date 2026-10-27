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
import { useLayoutEffect } from 'react'
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
import { expect, it } from 'vitest'
import {
  mockSyncCollectionOptions,
  mockSyncCollectionOptionsNoInitialState,
} from '../../db/tests/utils'
import { useLiveQuery } from '../src/useLiveQuery'
import { runSuite } from '../../db/tests/conformance/suite'
import { createPublicationLog } from '../../db/tests/conformance/publication-log'
import { makeLaggingSource } from '../../db/tests/conformance/lagging-source'
import { expectResultSurface } from '../../db/tests/conformance/result-laws'
import { rejectReadsAfterRenderError } from './rejected-binding'
import type { RenderHookResult } from '@testing-library/react'
import type { PooledLiveQueries } from '@tanstack/db'
import type {
  ConformanceResult,
  ControllableHandle,
  DeferredSourceHandle,
  LiveQueryDriver,
  QueryBuild,
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
) {
  const collection = createCollection(
    mockSyncCollectionOptions<T>({
      id: collectionId ?? `conformance-react-${sourceSeq++}`,
      getKey: (r) => r.id,
      initialData: [...initialData],
    }),
  )
  const write = writer<T>(collection)
  return {
    collection,
    insert: (row: T) => write(`insert`, row),
    update: (row: T) => write(`update`, row),
    remove: (row: T) => write(`delete`, row),
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

function mountConfig(
  build: QueryBuild,
  opts?: { gcTime?: number; pool?: PooledLiveQueries },
) {
  const hook = renderHook(() => useLiveQuery({ query: build as any, ...opts }))
  return makeHandle(hook)
}

// An empty dependency list compiles the query once, at mount, where the hook
// checks its identity and claims its sources.
function mountWithDependencyList(build: QueryBuild) {
  const hook = renderHook(() => useLiveQuery(build as any, []))
  return makeHandle(hook)
}

function mountConfigWithDependencyList(
  build: QueryBuild,
  opts?: { gcTime?: number; pool?: PooledLiveQueries },
) {
  const hook = renderHook(() =>
    useLiveQuery({ query: build as any, ...opts } as any, []),
  )
  return makeHandle(hook)
}

function mountDisabled() {
  // React's disabled convention: the query callback returns null.
  const hook = renderHook(() => useLiveQuery(() => null as any))
  return makeHandle(hook)
}

// React compares query identity on two production paths: the identity derived
// from the query IR on every render (the 1.0 form), and a deprecated
// dependency list, which decides reuse and checks identity when the query
// compiles. The suite runs once per path.
type IdentityPath = `derived` | `dependency list`

const mountControllableWith = (path: IdentityPath) =>
  function mountControllable<P>(
    build: (q: any, param: P) => any,
    initial: P,
    opts?: { pool?: PooledLiveQueries },
  ): ControllableHandle<P> {
    const published = createPublicationLog()
    const hook = renderHook(
      ({ param }: { param: P }) => {
        const query = (q: any) => build(q, param)
        // A pooled query uses the config form, on either identity path.
        const result =
          opts?.pool !== undefined
            ? path === `derived`
              ? useLiveQuery({ query, pool: opts.pool })
              : useLiveQuery({ query, pool: opts.pool }, [param])
            : path === `derived`
              ? // The callback captures param, so its IR identity changes with it.
                useLiveQuery(query)
              : useLiveQuery(query, [param])
        // A layout effect records each committed value.
        useLayoutEffect(() => {
          published.record(result.data, result.state)
        })
        return result
      },
      { initialProps: { param: initial } },
    )
    const guard = rejectReadsAfterRenderError(hook)
    const handle = makeHandle(hook)
    return {
      ...handle,
      publications: published.values,
      statePublications: published.stateValues,
      async setParam(param: P) {
        await guard(() =>
          act(async () => {
            hook.rerender({ param })
          }),
        )
        await handle.flush()
      },
    }
  }

function makeHandle(hook: RenderHookResult<any, any>) {
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

// The config-object form with a queryKey chosen per step; an undefined key
// leaves the hook to derive the identity, or to follow the dependency list.
const mountKeyedControllableWith = (path: IdentityPath) =>
  function mountKeyedControllable<P>(
    build: (q: any, param: P) => any,
    key: (param: P) => ReadonlyArray<unknown> | undefined,
    initial: P,
  ): ControllableHandle<P> {
    const published = createPublicationLog()
    const hook = renderHook(
      ({ param }: { param: P }) => {
        const config = {
          query: (q: any) => build(q, param),
          queryKey: key(param),
        } as any
        const result =
          path === `derived`
            ? useLiveQuery(config)
            : useLiveQuery(config, [param])
        useLayoutEffect(() => {
          published.record(result.data, result.state)
        })
        return result
      },
      { initialProps: { param: initial } },
    )
    const guard = rejectReadsAfterRenderError(hook)
    const handle = makeHandle(hook)
    return {
      ...handle,
      publications: published.values,
      statePublications: published.stateValues,
      async setParam(param: P) {
        await guard(() =>
          act(async () => {
            hook.rerender({ param })
          }),
        )
        await handle.flush()
      },
    }
  }

const reactDriver: LiveQueryDriver = {
  name: `react`,
  // Each render re-runs the query input and compares its identity.
  comparesQueryIdentity: true,
  disabledRepresentation: `absent`,
  ops: { eq, gt, count, sum, coalesce, groupKeys, createOptimisticAction },
  makeSource,
  makeDeferredSource,
  makeLaggingSource: <T extends { id: string }>() =>
    makeLaggingSource<T>(
      createCollection,
      `conformance-react-lagging-${sourceSeq++}`,
    ),
  makePrecreated,
  makeErrorSource,
  mount,
  mountControllable: mountControllableWith(`derived`),
  mountKeyedControllable: mountKeyedControllableWith(`derived`),
  mountCollection,
  mountConfig,
  mountDisabled,
  knownGaps: [],
  features: { serverSnapshot: true, suspense: true, pooledEqFilters: true },
}

runSuite(reactDriver)
runSuite({
  ...reactDriver,
  name: `react (dependency list)`,
  mount: mountWithDependencyList,
  mountConfig: mountConfigWithDependencyList,
  mountControllable: mountControllableWith(`dependency list`),
  mountKeyedControllable: mountKeyedControllableWith(`dependency list`),
})
it(`publishes a synchronous ordered limit in the first layout commit`, async () => {
  const source = makeSource([
    { id: `1`, rank: 1 },
    { id: `2`, rank: 2 },
    { id: `3`, rank: 3 },
  ])
  const commits: Array<{ ids: Array<string>; status: string }> = []
  const hook = renderHook(() => {
    const result = useLiveQuery((q) =>
      q
        .from({ row: source.collection })
        .orderBy(({ row }) => row.rank)
        .limit(2),
    )
    useLayoutEffect(() => {
      commits.push({
        ids: result.data.map(({ id }) => id),
        status: result.status,
      })
    })
    return result
  })

  try {
    expect(commits[0]).toEqual({ ids: [`1`, `2`], status: `ready` })
  } finally {
    const liveQueryCollection = hook.result.current.collection
    hook.unmount()
    await liveQueryCollection.cleanup()
    await source.collection.cleanup()
  }
})

it(`publishes a synchronous full-source ordered limit in the first layout commit`, async () => {
  // A function filter makes the plan load its whole source; that initial load
  // shares the synchronous readiness cut with an ordinary ordered request.
  const source = makeSource([
    { id: `1`, rank: 1 },
    { id: `2`, rank: 2 },
    { id: `3`, rank: 3 },
  ])
  const commits: Array<{ ids: Array<string>; status: string }> = []
  const hook = renderHook(() => {
    const result = useLiveQuery({
      queryKey: [`full-source-ordered-limit`],
      query: (q) =>
        q
          .from({ row: source.collection })
          .fn.where(({ row }) => row.rank > 0)
          .orderBy(({ row }) => row.rank)
          .limit(2),
    })
    useLayoutEffect(() => {
      commits.push({
        ids: result.data.map(({ id }) => id),
        status: result.status,
      })
    })
    return result
  })

  try {
    expect(commits[0]).toEqual({ ids: [`1`, `2`], status: `ready` })
  } finally {
    const liveQueryCollection = hook.result.current.collection
    hook.unmount()
    await liveQueryCollection.cleanup()
    await source.collection.cleanup()
  }
})

it(`publishes a locale-string findOne fallback in the first layout commit`, async () => {
  // A locale string cannot form a provider cursor. Both acquisitions return
  // literal true from this eager source, so the first window is ready at the
  // initial render's layout commit.
  const source = createCollection(
    mockSyncCollectionOptions({
      id: `conformance-react-locale-fallback-${sourceSeq++}`,
      getKey: (row: { id: string; at: string }) => row.id,
      initialData: [
        { id: `1`, at: `2026-10-01` },
        { id: `2`, at: `2026-10-02` },
      ],
      autoIndex: `eager`,
      defaultStringCollation: { stringSort: `locale` },
    }),
  )
  const commits: Array<{ id: string | undefined; status: string }> = []
  const hook = renderHook(() => {
    const result = useLiveQuery((q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.at, `desc`)
        .findOne(),
    )
    useLayoutEffect(() => {
      commits.push({
        id: result.data?.id,
        status: result.status,
      })
    })
    return result
  })

  try {
    expect(commits[0]).toEqual({ id: `2`, status: `ready` })
  } finally {
    const liveQueryCollection = hook.result.current.collection
    hook.unmount()
    await liveQueryCollection.cleanup()
    await source.cleanup()
  }
})

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
