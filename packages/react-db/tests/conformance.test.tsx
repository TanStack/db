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
import { Suspense, useLayoutEffect } from 'react'
import {
  BTreeIndex,
  BasicIndex,
  DbClient,
  Query,
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
import { afterAll, expect, it } from 'vitest'
import {
  mockSyncCollectionOptions,
  mockSyncCollectionOptionsNoInitialState,
} from '../../db/tests/utils'
import { useLiveQuery } from '../src/useLiveQuery'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import { registerWindowHistoryOracle } from '../../db/tests/conformance/window-history-oracle'
import { runSuite } from '../../db/tests/conformance/suite'
import { createPublicationLog } from '../../db/tests/conformance/publication-log'
import { makeLaggingSource } from '../../db/tests/conformance/lagging-source'
import { makeSyncSource } from '../../db/tests/conformance/sync-source'
import { makeErrorSource as makeSharedErrorSource } from '../../db/tests/conformance/error-source'
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
  options?: { rowUpdateMode?: `full` },
) {
  const collection = createCollection(
    mockSyncCollectionOptions<T>({
      id: collectionId ?? `conformance-react-${sourceSeq++}`,
      getKey: (r) => r.id,
      initialData: [...initialData],
      rowUpdateMode: options?.rowUpdateMode,
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

function makeErrorSource(kind: `fail` | `crash`) {
  return makeSharedErrorSource(
    createCollection,
    `conformance-react-err-${sourceSeq++}`,
    kind,
  )
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
  opts?: Parameters<LiveQueryDriver[`mountConfig`]>[1],
) {
  const hook = renderHook(() => useLiveQuery({ query: build as any, ...opts }))
  return makeHandle(hook)
}

// Retain this registration for replay coordinates. It uses the current
// derived-identity API, which checks identity and source claims on each render.
function mountWithDependencyList(build: QueryBuild) {
  const hook = renderHook(() => useLiveQuery(build as any))
  return makeHandle(hook)
}

function mountConfigWithDependencyList(
  build: QueryBuild,
  opts?: Parameters<LiveQueryDriver[`mountConfig`]>[1],
) {
  const hook = renderHook(() =>
    useLiveQuery({ query: build as any, ...opts } as any),
  )
  return makeHandle(hook)
}

function mountDisabled() {
  // React's disabled convention: the query callback returns null.
  const hook = renderHook(() => useLiveQuery(() => null as any))
  return makeHandle(hook)
}

// The legacy dependency-list label preserves receiving registrations and replay
// coordinates. Both branches now use the current derived-identity API; these
// labels do not represent separate production paths.
type IdentityPath = `derived` | `dependency list`

const mountControllableWith = (
  path: IdentityPath,
  withClient: boolean | DbClient = false,
  suspense = false,
) =>
  function mountControllable<P>(
    build: (q: any, param: P) => any,
    initial: P,
    opts?: { pool?: PooledLiveQueries },
  ): ControllableHandle<P> {
    const client =
      withClient instanceof DbClient
        ? withClient
        : withClient
          ? new DbClient()
          : undefined
    const published = createPublicationLog()
    const usePage = suspense ? useLiveSuspenseQuery : useLiveQuery
    let suspended = false
    function Fallback() {
      suspended = true
      return null
    }
    const hook = renderHook(
      ({ param }: { param: P }) => {
        const query = (q: any) => build(q, param)
        const input = client ? build(new Query(), param) : undefined
        // Both retained registrations use the config form for a pooled query.
        const result =
          opts?.pool !== undefined
            ? path === `derived`
              ? usePage({ query, pool: opts.pool, client })
              : usePage({ query, pool: opts.pool, client })
            : client
              ? usePage(
                  input instanceof Query
                    ? { query: input, client }
                    : { ...input, client },
                )
              : path === `derived`
                ? // The callback captures param, so its IR identity changes with it.
                  usePage(query)
                : usePage(query)
        // A layout effect records each committed value.
        useLayoutEffect(() => {
          suspended = false
          published.record(result.data, result.state)
        })
        return result
      },
      {
        initialProps: { param: initial },
        wrapper: ({ children }) =>
          suspense ? (
            <Suspense fallback={<Fallback />}>{children}</Suspense>
          ) : (
            children
          ),
      },
    )
    const guard = rejectReadsAfterRenderError(hook)
    const handle = makeHandle(hook, suspense)
    return {
      ...handle,
      isSuspended: () => suspended,
      publications: published.values,
      statePublications: published.stateValues,
      async setParam(param: P, observe?: () => void) {
        // renderHook's rerender commits inside its own synchronous act.
        guard(() => hook.rerender({ param }))
        observe?.()
        await handle.flush()
      },
    }
  }

function makeHandle(hook: RenderHookResult<any, any>, suspense = false) {
  return {
    collection: () => hook.result.current?.collection ?? null,
    current(): ConformanceResult {
      const r: any = hook.result.current
      // Suspense exposes readiness by returning successfully, not via flags.
      // No result is fabricated while it shows a fallback; the shared pending
      // receiver observes that fallback through isSuspended instead.
      if (suspense) {
        if (!r) throw new Error(`Suspense has no committed result`)
        return {
          ...r,
          status: `ready`,
          isReady: true,
          isLoadingError: false,
          isCrashed: false,
          isSyncError: false,
          isEnabled: true,
        }
      }
      return expectResultSurface({
        data: r?.data,
        state: r?.state,
        status: r?.status,
        isReady: r?.isReady,
        isLoadingError: r?.isLoadingError,
        isCrashed: r?.isCrashed,
        isSyncError: r?.isSyncError,
        // Read react-db's real `isEnabled` field so the suite catches a broken
        // one (deriving from status would mask it).
        isEnabled: r?.isEnabled,
        health: r?.health,
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
// leaves the hook to derive the identity.
const mountKeyedControllableWith = (
  path: IdentityPath,
  withClient: boolean | DbClient = false,
  suspense = false,
) =>
  function mountKeyedControllable<P>(
    build: (q: any, param: P) => any,
    key: (param: P) => ReadonlyArray<unknown> | undefined,
    initial: P,
  ): ControllableHandle<P> {
    const client =
      withClient instanceof DbClient
        ? withClient
        : withClient
          ? new DbClient()
          : undefined
    const published = createPublicationLog()
    const usePage = suspense ? useLiveSuspenseQuery : useLiveQuery
    let suspended = false
    function Fallback() {
      suspended = true
      return null
    }
    const hook = renderHook(
      ({ param }: { param: P }) => {
        const config = {
          query: (q: any) => build(q, param),
          queryKey: key(param),
          client,
        } as any
        const result = path === `derived` ? usePage(config) : usePage(config)
        useLayoutEffect(() => {
          suspended = false
          published.record(result.data, result.state)
        })
        return result
      },
      {
        initialProps: { param: initial },
        wrapper: ({ children }) =>
          suspense ? (
            <Suspense fallback={<Fallback />}>{children}</Suspense>
          ) : (
            children
          ),
      },
    )
    const guard = rejectReadsAfterRenderError(hook)
    const handle = makeHandle(hook, suspense)
    return {
      ...handle,
      isSuspended: () => suspended,
      publications: published.values,
      statePublications: published.stateValues,
      async setParam(param: P, observe?: () => void) {
        // renderHook's rerender commits inside its own synchronous act.
        guard(() => hook.rerender({ param }))
        observe?.()
        await handle.flush()
      },
    }
  }

const reactDriver: LiveQueryDriver = {
  name: `react`,
  parameterObservationCut: `committed synchronous rerender`,
  // Each render re-runs the query input and compares its identity.
  comparesQueryIdentity: true,
  disabledRepresentation: `absent`,
  ops: { eq, gt, count, sum, coalesce, groupKeys, createOptimisticAction },
  indexTypes: { basic: BasicIndex, btree: BTreeIndex },
  makeSource,
  makeDeferredSource,
  makeLaggingSource: <T extends { id: string }>() =>
    makeLaggingSource<T>(
      createCollection,
      `conformance-react-lagging-${sourceSeq++}`,
    ),
  makeSyncSource: <T extends { id: string }>(data: ReadonlyArray<T>) =>
    makeSyncSource<T>(
      createCollection,
      `conformance-react-health-${sourceSeq++}`,
      data,
    ),
  makePrecreated,
  makeErrorSource,
  mount,
  mountControllable: mountControllableWith(`derived`),
  mountKeyedControllable: mountKeyedControllableWith(`derived`),
  mountCollection,
  mountConfig,
  mountDisabled,
  limits: [],
  features: { serverSnapshot: true, suspense: true, pooledEqFilters: true },
}

// DbClient and Suspense are receiving modes of the shared page law. Other
// adapters register client-backed drivers against the same model and histories.
for (const client of [false, true])
  for (const suspense of [false, true]) {
    if (!client && !suspense) continue // registered by runSuite below
    const scope = client ? new DbClient() : false
    if (scope) afterAll(() => scope.cleanup())
    registerWindowHistoryOracle({
      ...reactDriver,
      name: `react${suspense ? ` Suspense` : ``}${client ? ` (DbClient)` : ``}`,
      features: { ...reactDriver.features, suspendsUntilReady: suspense },
      mountControllable: mountControllableWith(`derived`, scope, suspense),
      mountKeyedControllable: mountKeyedControllableWith(
        `derived`,
        scope,
        suspense,
      ),
    })
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
    isLoadingError: false,
    isCrashed: false,
    isSyncError: false,
    isEnabled: false,
  }
  const hook = renderHook(() => raw)
  const handle = makeHandle(hook)
  try {
    const healthy = handle.current()
    expect(healthy.data).toBe(raw.data)
    expect(healthy.state).toBe(raw.state)
    expect(healthy.isReady).toBe(false)
    expect(healthy.isLoadingError).toBe(false)
    expect(healthy.isEnabled).toBe(false)
    for (const key of [`status`, `isReady`, `isLoadingError`, `isEnabled`]) {
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
