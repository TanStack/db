/**
 * Source ID reuse contract for React's derived live-query identity.
 *
 * A Collection ID names one source object for the lifetime of a mounted
 * derived-identity hook in one DbClient scope. Re-rendering that hook with a different object under
 * the same ID must reject before it can return rows from the old source.
 * Unmounting and cleaning up the old scope permits the ID in a new hook. Two
 * independent client scopes may use the same ID at the same time.
 *
 * Model: each mounted hook remembers the source object first seen for an ID
 * in each client scope. Same object and fresh ID transitions are legal. A
 * different object for a remembered ID is rejected. A new hook starts a new
 * model; switching clients selects that client's remembered bindings.
 * A render that starts a live query claims its source before a descendant
 * suspends, because the live query may still own that source until cleanup.
 * Separate hooks can use same-ID objects: their client-scoped Suspense cache
 * entries must remain distinct, including before the first hook commits.
 * A rejected render must release any sync-start deferral it acquired for a
 * shared client descriptor, so a later direct reader can start that Collection.
 * The release history grammar crosses every rejection cause (a source ID
 * collision, a query without a stable IR identity, a descriptor factory that
 * throws while the query binds its sources, a query the live query rejects
 * when it compiles, a single-result query in an infinite hook, which pages
 * many rows, a Suspense query that cannot stream during SSR, a sibling that
 * throws after the hook returns, and a render that suspends and never
 * commits), every hook
 * path (live, infinite, and Suspense, each with derived identity or a
 * dependency list), and both direct
 * readers (another hook over the Collection, and `startSyncImmediate()`). The
 * release must also hold when earlier deferred sync starts throw: each pending
 * Collection is attempted before the first startup error is rethrown.
 * The bounded histories below distinguish this law from a hash-only check,
 * which would miss A(id=x) -> C(id=y) -> B(id=x), a changed predicate, and
 * two different same-ID sources in one query.
 *
 * Driver and observation: render the public hook, then rerender it with each
 * source. At the rerender boundary, compare a thrown error or the public row.
 * A nonempty queryKey owns its identity, so a keyed query skips the claim: a
 * same-ID swap under a changed key reads the new source. The release grammar
 * below runs dependency-list hook paths too. This does not assert a
 * process-wide Collection registry or other explicit-key semantics.
 */
import {
  DbClient,
  SourceCollectionIdReuseError,
  collectionOptions,
  createCollection,
  eq,
  gt,
} from '@tanstack/db'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Component, Suspense } from 'react'
import { DbProvider } from '../src/DbProvider'
import { useLiveQuery } from '../src/useLiveQuery'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import type { Context, QueryBuilder } from '@tanstack/db'
import type { ReactNode } from 'react'

type Row = { id: string; value: string; rank: number }

class TestErrorBoundary extends Component<
  { children: ReactNode },
  { error?: Error }
> {
  state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    return this.state.error ? <div>Rejected</div> : this.props.children
  }
}

function source(id: string, value: string) {
  return createCollection(
    mockSyncCollectionOptions<Row>({
      id,
      getKey: (row) => row.id,
      initialData: [{ id: `one`, value, rank: 1 }],
    }),
  )
}

type Binding = { source: ReturnType<typeof source>; client?: DbClient }

// A prior source with the same ID in this client scope forbids a new object.
// Pairwise history comparison is independent of the hook's token maps.
function expectedCollision(history: ReadonlyArray<Binding>, next: Binding) {
  return history.some(
    (prior) =>
      prior.client === next.client &&
      prior.source.id === next.source.id &&
      prior.source !== next.source,
  )
}

function checkRerender(
  history: ReadonlyArray<Binding>,
  next: Binding,
  rerender: () => void,
) {
  if (expectedCollision(history, next)) {
    expect(rerender).toThrow(SourceCollectionIdReuseError)
  } else {
    expect(rerender).not.toThrow()
  }
}

/*
 * Release law. A hook in one DbClient scope first reads only its own source,
 * then rerenders into a rejected query that also reads a shared descriptor.
 * The rejected render may defer the shared Collection's sync start, and it
 * must release that deferral: the source stays unstarted until a direct
 * reader asks, and that reader then starts it exactly once and reads its row.
 *
 * Declared reach: every enumerated history must enter the state the law is
 * about, a rejected render that materialized the shared descriptor. Each cell
 * asserts that the descriptor factory ran once before the reader, so a
 * history that rejects before binding the shared source fails instead of
 * passing vacuously.
 */
type ReleaseStep = { current: ReturnType<typeof source>; reject: boolean }

const releaseCauses: Record<
  string,
  (
    shared: any,
    failing: any,
  ) => {
    rejected: (step: ReleaseStep) => ReleaseStep
    query: (q: any, step: ReleaseStep, ordered: boolean) => any
    /** Which hook paths the cause rejects in; all of them by default. */
    rejectsIn?: (hook: ReleaseHook) => boolean
    /** The dependency values for a hook with a dependency list. */
    deps?: (step: ReleaseStep) => Array<unknown>
    /** Prepare the client, for a cause that depends on its mode. */
    setup?: (client: DbClient) => void
    /** Render the rejected step first, for a cause only a mount reaches. */
    atMount?: boolean
    /**
     * What the component does after the hook returns in the rejected step:
     * throw to an error boundary, or suspend on a promise that never settles.
     * Either way the render never commits; the hook itself rejected nothing.
     */
    afterHook?: `throw` | `suspend`
  }
> = {
  'a source ID collision': (shared) => ({
    rejected: () => ({
      current: source(`settings`, `replacement`),
      reject: true,
    }),
    query: (q, step, ordered) =>
      orderIf(
        step.reject
          ? q
              .from({ settings: step.current })
              .join({ shared }, ({ settings, shared: row }: any) =>
                eq(settings.id, row.id),
              )
          : q.from({ settings: step.current }),
        ordered,
      ),
  }),
  'a query without a stable IR identity': (shared) => ({
    rejected: (step) => ({ ...step, reject: true }),
    query: (q, step, ordered) =>
      orderIf(
        step.reject
          ? q
              .from({ settings: step.current })
              .join({ shared }, ({ settings, shared: row }: any) =>
                eq(settings.id, row.id),
              )
              .fn.where(() => true)
          : q.from({ settings: step.current }),
        ordered,
      ),
  }),
  'a descriptor factory that throws': (shared, failing) => ({
    rejected: (step) => ({ ...step, reject: true }),
    query: (q, step, ordered) =>
      orderIf(
        step.reject
          ? q
              .from({ settings: step.current })
              .join({ shared }, ({ settings, shared: row }: any) =>
                eq(settings.id, row.id),
              )
              .join({ failing }, ({ settings, failing: row }: any) =>
                eq(settings.id, row.id),
              )
          : q.from({ settings: step.current }),
        ordered,
      ),
  }),
  'a query the live query rejects when it compiles': (shared) => ({
    rejected: (step) => ({ ...step, reject: true }),
    // A root scalar select is valid IR that compilation refuses.
    query: (q, step, ordered) =>
      step.reject
        ? orderIf(
            q
              .from({ settings: step.current })
              .join({ shared }, ({ settings, shared: row }: any) =>
                eq(settings.id, row.id),
              ),
            ordered,
          ).select(({ settings }: any) => settings.value)
        : orderIf(q.from({ settings: step.current }), ordered),
  }),
  'a single-result window query': (shared) => ({
    rejected: (step) => ({ ...step, reject: true }),
    query: (q, step, ordered) => {
      const query = orderIf(
        step.reject
          ? q
              .from({ settings: step.current })
              .join({ shared }, ({ settings, shared: row }: any) =>
                eq(settings.id, row.id),
              )
          : q.from({ settings: step.current }),
        ordered,
      )
      return step.reject ? query.findOne() : query
    },
    // A live query may read one row; an infinite query must page many.
    rejectsIn: (hook) => hook.ordered,
  }),
  'a Suspense query that cannot stream during SSR': (shared) => ({
    rejected: (step) => ({ ...step, reject: true }),
    query: (q, step) =>
      q
        .from({ settings: step.current })
        .join({ shared }, ({ settings, shared: row }: any) =>
          eq(settings.id, row.id),
        ),
    // A function dependency gives the stream no stable key.
    deps: (step) => [step.current, () => step.reject],
    setup: (client) => client._setSsrStreamingEnabled(true),
    rejectsIn: (hook) => hook.suspense && hook.usesDeps,
    atMount: true,
  }),
  'a sibling that throws after the hook returns': (shared) => ({
    rejected: (step) => ({ ...step, reject: true }),
    query: (q, step, ordered) =>
      orderIf(
        step.reject
          ? q
              .from({ settings: step.current })
              .join({ shared }, ({ settings, shared: row }: any) =>
                eq(settings.id, row.id),
              )
          : q.from({ settings: step.current }),
        ordered,
      ),
    afterHook: `throw`,
    // A Suspense hook that returns has already preloaded its query, which
    // starts its sources, so no deferral is left to release.
    rejectsIn: (hook) => !hook.suspense,
  }),
  'a render that suspends and never commits': (shared) => ({
    rejected: (step) => ({ ...step, reject: true }),
    query: (q, step, ordered) =>
      orderIf(
        step.reject
          ? q
              .from({ settings: step.current })
              .join({ shared }, ({ settings, shared: row }: any) =>
                eq(settings.id, row.id),
              )
          : q.from({ settings: step.current }),
        ordered,
      ),
    afterHook: `suspend`,
    // As above: a Suspense hook's own read is a preload.
    rejectsIn: (hook) => !hook.suspense,
  }),
}

function orderIf(query: any, ordered: boolean) {
  return ordered ? query.orderBy(({ settings }: any) => settings.rank) : query
}

type ReleaseHook = {
  ordered: boolean
  suspense: boolean
  usesDeps: boolean
  use: (query: (q: any) => any, deps: Array<unknown>) => void
}

const releaseHooks: Record<string, ReleaseHook> = {
  'useLiveQuery with derived identity': {
    ordered: false,
    suspense: false,
    usesDeps: false,
    use: (query) => void useLiveQuery(query),
  },
  'useLiveQuery with a dependency list': {
    ordered: false,
    suspense: false,
    usesDeps: true,
    use: (query, deps) => void useLiveQuery(query, deps),
  },
  'useLiveInfiniteQuery with derived identity': {
    ordered: true,
    suspense: false,
    usesDeps: false,
    use: (query) => void useLiveInfiniteQuery(query, { pageSize: 1 }),
  },
  'useLiveInfiniteQuery with a dependency list': {
    ordered: true,
    suspense: false,
    usesDeps: true,
    use: (query, deps) =>
      void useLiveInfiniteQuery(query, { pageSize: 1 }, deps),
  },
  // A config can turn off the reclaim: gcTime 0 or Infinity disables GC, and
  // startSync false never arms it. A render that never commits must still
  // release its deferral.
  'useLiveQuery with gcTime 0': {
    ordered: false,
    suspense: false,
    usesDeps: false,
    use: (query) => void useLiveQuery({ query, gcTime: 0 }),
  },
  'useLiveQuery with gcTime Infinity': {
    ordered: false,
    suspense: false,
    usesDeps: false,
    use: (query) => void useLiveQuery({ query, gcTime: Infinity }),
  },
  'useLiveQuery with startSync false': {
    ordered: false,
    suspense: false,
    usesDeps: false,
    use: (query) => void useLiveQuery({ query, startSync: false }),
  },
  'useLiveSuspenseQuery with derived identity': {
    ordered: false,
    suspense: true,
    usesDeps: false,
    use: (query) => void useLiveSuspenseQuery(query),
  },
  'useLiveSuspenseQuery with a dependency list': {
    ordered: false,
    suspense: true,
    usesDeps: true,
    use: (query, deps) => void useLiveSuspenseQuery(query, deps),
  },
}

// Each reader asks for the source synchronously and returns a read of its
// row. A rejection has released already, so the demand starts the source at
// once. A render that never commits releases its deferral when its live
// query is reclaimed, so the row may arrive after the reader asked.
const releaseReaders: Record<
  string,
  (shared: ReturnType<typeof source>) => () => unknown
> = {
  'another hook over the Collection': (shared) => {
    const reader = renderHook(() => useLiveQuery(shared))
    return () => reader.result.current.data[0]?.value
  },
  'startSyncImmediate()': (shared) => {
    shared.startSyncImmediate()
    return () => shared.toArray[0]?.value
  },
}

describe(`React source ID reuse: rejected renders release deferred sync starts`, () => {
  let sequence = 0
  for (const [causeName, makeCause] of Object.entries(releaseCauses)) {
    for (const [hookName, hook] of Object.entries(releaseHooks)) {
      const probe = makeCause(undefined, undefined)
      if (probe.rejectsIn && !probe.rejectsIn(hook)) continue
      for (const [readerName, read] of Object.entries(releaseReaders)) {
        it(`after ${causeName} in ${hookName}, ${readerName} starts the shared source`, async () => {
          const client = new DbClient()
          const id = `release-shared-${sequence++}`
          let syncStarts = 0
          let materialized = 0
          const shared = collectionOptions(
            id,
            () => (
              materialized++,
              {
                id,
                getKey: (row: Row) => row.id,
                sync: {
                  sync: ({ begin, write, commit, markReady }) => {
                    syncStarts++
                    begin()
                    write({
                      type: `insert`,
                      value: { id: `one`, value: `shared`, rank: 1 },
                    })
                    commit()
                    markReady()
                  },
                },
              }
            ),
          )
          const failing = collectionOptions(`${id}-failing`, () => {
            throw new Error(`descriptor factory failed`)
          })
          const cause = makeCause(shared, failing)
          cause.setup?.(client)
          const never = new Promise<void>(() => {})
          function View({ step }: { step: ReleaseStep }) {
            hook.use(
              (q) => cause.query(q, step, hook.ordered),
              cause.deps?.(step) ?? [step.current, step.reject],
            )
            if (step.reject && cause.afterHook === `throw`) {
              throw new Error(`sibling failed`)
            }
            if (step.reject && cause.afterHook === `suspend`) throw never
            return <div>Query</div>
          }
          const tree = (step: ReleaseStep) => (
            <DbProvider client={client}>
              <TestErrorBoundary>
                <Suspense fallback={<div>Loading</div>}>
                  <View step={step} />
                </Suspense>
              </TestErrorBoundary>
            </DbProvider>
          )
          const consoleError = vi
            .spyOn(console, `error`)
            .mockImplementation(() => {})
          try {
            const initial = {
              current: source(`settings`, `first`),
              reject: false,
            }
            const root = render(
              tree(cause.atMount ? cause.rejected(initial) : initial),
            )
            await act(async () => {})
            if (!cause.atMount) root.rerender(tree(cause.rejected(initial)))
            expect(
              root.getByText(
                cause.afterHook === `suspend` ? `Loading` : `Rejected`,
              ),
            ).toBeDefined()
            // Declared reach: the rejected render materialized the shared
            // descriptor, so it held a deferral the law must release.
            expect(materialized).toBe(1)
            // A rejection releases at its render boundary, before the reader.
            // A render that never commits releases at the reclaim, which the
            // real GC timer may reach before or after the reader asks.
            if (!cause.afterHook) expect(syncStarts).toBe(0)

            const value = read(client.collection(shared) as any)
            if (cause.afterHook) {
              await waitFor(() => expect(value()).toBe(`shared`))
            } else {
              // Released at the render boundary, so the demand started it.
              expect(syncStarts).toBe(1)
              await act(async () => {})
              expect(value()).toBe(`shared`)
            }
            expect(syncStarts).toBe(1)
          } finally {
            consoleError.mockRestore()
          }
        })
      }
    }
  }
})

describe(`React source ID reuse`, () => {
  it(`releases a later shared source when earlier deferred sync starts fail`, async () => {
    const client = new DbClient()
    const first = source(`settings`, `first`)
    const replacement = source(`settings`, `replacement`)
    const failedStarts: [number, number] = [0, 0]
    const failing = ([0, 1] as const).map((index) =>
      collectionOptions(`failing-${index}`, () => ({
        id: `failing-${index}`,
        getKey: (row: Row) => row.id,
        startSync: true,
        sync: {
          sync: () => {
            failedStarts[index]++
            throw new Error(`sync ${index} failed`)
          },
        },
      })),
    )
    let healthyStarts = 0
    const healthy = collectionOptions(`healthy-after-failures`, () => ({
      id: `healthy-after-failures`,
      getKey: (row: Row) => row.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          healthyStarts++
          begin()
          write({
            type: `insert`,
            value: { id: `one`, value: `healthy`, rank: 1 },
          })
          commit()
          markReady()
        },
      },
    }))
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})

    function View({
      current,
      include,
    }: {
      current: typeof first
      include: boolean
    }) {
      useLiveQuery({
        client,
        query: (q): QueryBuilder<Context> =>
          include
            ? q
                .from({ failingA: failing[0]! })
                .join({ failingB: failing[1]! }, ({ failingA, failingB }) =>
                  eq(failingA.id, failingB.id),
                )
                .join({ healthy }, ({ failingA, healthy: row }) =>
                  eq(failingA.id, row.id),
                )
                .join({ settings: current }, ({ failingA, settings }) =>
                  eq(failingA.id, settings.id),
                )
            : q.from({ settings: current }),
      })
      return <div>Query</div>
    }

    try {
      const root = render(
        <TestErrorBoundary>
          <View current={first} include={false} />
        </TestErrorBoundary>,
      )
      await act(async () => {})
      root.rerender(
        <TestErrorBoundary>
          <View current={replacement} include={true} />
        </TestErrorBoundary>,
      )
      expect(root.getByText(`Rejected`)).toBeDefined()
      expect(failedStarts).toEqual([1, 1])

      const shared = client.collection(healthy)
      const reader = renderHook(() => useLiveQuery(shared))
      await act(async () => {})
      expect(reader.result.current.status).toBe(`ready`)
      expect(reader.result.current.data[0]?.value).toBe(`healthy`)
      expect(healthyStarts).toBe(1)
    } finally {
      consoleError.mockRestore()
    }
  })

  it(`rejects a different active source with the same ID before exposing stale rows`, async () => {
    const first = source(`settings`, `first`)
    const second = source(`settings`, `second`)
    const hook = renderHook(
      ({ current }) =>
        useLiveQuery({ query: (q) => q.from({ settings: current }) }),
      { initialProps: { current: first } },
    )

    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`first`),
    )
    checkRerender([{ source: first }], { source: second }, () =>
      hook.rerender({ current: second }),
    )
  })

  it(`rejects a previously used ID after another source and a query change`, async () => {
    const first = source(`settings`, `first`)
    const other = source(`other`, `other`)
    const second = source(`settings`, `second`)
    const hook = renderHook(
      ({ current, minimum }) =>
        useLiveQuery({
          query: (q) =>
            q
              .from({ settings: current })
              .where(({ settings }) => gt(settings.rank, minimum)),
        }),
      { initialProps: { current: first, minimum: 0 } },
    )

    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`first`),
    )
    act(() => hook.rerender({ current: other, minimum: 0 }))
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`other`),
    )
    checkRerender(
      [{ source: first }, { source: other }],
      { source: second },
      () => hook.rerender({ current: second, minimum: -1 }),
    )
  })

  it(`accepts the same source object and a different source ID`, async () => {
    const first = source(`settings`, `first`)
    const other = source(`other`, `other`)
    const hook = renderHook(
      ({ current }) =>
        useLiveQuery({ query: (q) => q.from({ settings: current }) }),
      { initialProps: { current: first } },
    )

    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`first`),
    )
    checkRerender([{ source: first }], { source: first }, () =>
      hook.rerender({ current: first }),
    )
    expect(hook.result.current.data[0]?.value).toBe(`first`)
    checkRerender([{ source: first }], { source: other }, () =>
      hook.rerender({ current: other }),
    )
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`other`),
    )
  })

  it(`rejects two distinct source objects with one ID in a single query`, () => {
    const leftSource = source(`settings`, `first`)
    const rightSource = source(`settings`, `second`)
    expect(() =>
      renderHook(() =>
        useLiveQuery({
          query: (q) =>
            q
              .from({ first: leftSource })
              .join({ second: rightSource }, ({ first, second }) =>
                eq(first.id, second.id),
              ),
        }),
      ),
    ).toThrow(SourceCollectionIdReuseError)
  })

  it(`keeps a mounted hook's ID binding after source cleanup`, async () => {
    const first = source(`settings`, `first`)
    const second = source(`settings`, `second`)
    const hook = renderHook(
      ({ current }) =>
        useLiveQuery({ query: (q) => q.from({ settings: current }) }),
      { initialProps: { current: first } },
    )
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`first`),
    )
    await act(async () => first.cleanup())
    checkRerender([{ source: first }], { source: second }, () =>
      hook.rerender({ current: second }),
    )
  })

  it(`permits the same ID in a new hook after unmount and cleanup`, async () => {
    const first = source(`settings`, `first`)
    const oldHook = renderHook(() =>
      useLiveQuery({ query: (q) => q.from({ settings: first }) }),
    )
    await waitFor(() =>
      expect(oldHook.result.current.data[0]?.value).toBe(`first`),
    )
    const oldQuery = oldHook.result.current.collection
    oldHook.unmount()
    await waitFor(() => expect(oldQuery.status).toBe(`cleaned-up`))
    await first.cleanup()

    const second = source(`settings`, `second`)
    const newHook = renderHook(() =>
      useLiveQuery({ query: (q) => q.from({ settings: second }) }),
    )
    await waitFor(() =>
      expect(newHook.result.current.data[0]?.value).toBe(`second`),
    )
  })

  it(`lets a keyed query swap a source under its ID when the key changes`, async () => {
    const first = source(`settings`, `first`)
    const replacement = source(`settings`, `replacement`)
    const hook = renderHook(
      ({ current }: { current: typeof first }) =>
        useLiveQuery({
          queryKey: [`settings`, current === first ? 1 : 2],
          query: (q) => q.from({ settings: current }),
        }),
      { initialProps: { current: first } },
    )
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`first`),
    )
    hook.rerender({ current: replacement })
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`replacement`),
    )
  })

  // A Suspense mount suspends before it commits, so its retry render may
  // reuse the cached Suspense collection instead of compiling again. With a
  // dependency list, that retry must still claim the source's ID.
  it(`claims a Suspense query's source when a dependency-list retry reuses its cached collection`, async () => {
    let markFirstReady!: () => void
    const first = createCollection<Row>({
      id: `suspense-settings`,
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({
            type: `insert`,
            value: { id: `one`, value: `first`, rank: 1 },
          })
          commit()
          markFirstReady = markReady
        },
      },
    })
    const replacement = source(`suspense-settings`, `replacement`)
    const labels = new Map<object, string>([
      [first, `first`],
      [replacement, `replacement`],
    ])
    const View = ({ current }: { current: typeof first }) => {
      // A hashable dependency keys the Suspense cache; a Collection cannot.
      const { data } = useLiveSuspenseQuery(
        (q) => q.from({ settings: current }),
        [labels.get(current)],
      )
      return <div>{data[0]?.value}</div>
    }
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
    try {
      const root = render(
        <TestErrorBoundary>
          <Suspense fallback={<div>Loading</div>}>
            <View current={first} />
          </Suspense>
        </TestErrorBoundary>,
      )
      expect(root.getByText(`Loading`)).toBeDefined()
      await act(async () => markFirstReady())
      await waitFor(() => expect(root.getByText(`first`)).toBeDefined())

      root.rerender(
        <TestErrorBoundary>
          <Suspense fallback={<div>Loading</div>}>
            <View current={replacement} />
          </Suspense>
        </TestErrorBoundary>,
      )
      expect(root.getByText(`Rejected`)).toBeDefined()
    } finally {
      consoleError.mockRestore()
    }
  })

  it(`claims a Suspense query's source when a dependency-list hook mounts from a sibling's cached collection`, async () => {
    const first = source(`sibling-suspense`, `first`)
    const replacement = source(`sibling-suspense`, `replacement`)
    const labels = new Map<object, string>([
      [first, `first`],
      [replacement, `replacement`],
    ])
    const View = ({ current }: { current: typeof first }) => {
      // A hashable dependency keys the Suspense cache; a Collection cannot.
      const { data } = useLiveSuspenseQuery(
        (q) => q.from({ settings: current }),
        [labels.get(current)],
      )
      return <div>{data[0]?.value}</div>
    }
    const tree = (second: typeof first) => (
      <>
        <Suspense fallback={<div>Loading</div>}>
          <View current={first} />
        </Suspense>
        <TestErrorBoundary>
          <Suspense fallback={<div>Loading</div>}>
            <View current={second} />
          </Suspense>
        </TestErrorBoundary>
      </>
    )
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
    try {
      const root = render(tree(first))
      await waitFor(() => expect(root.getAllByText(`first`)).toHaveLength(2))
      root.rerender(tree(replacement))
      expect(root.getByText(`Rejected`)).toBeDefined()
    } finally {
      consoleError.mockRestore()
    }
  })

  it(`permits independent client scopes to use the same ID`, async () => {
    const firstClient = new DbClient()
    const secondClient = new DbClient()
    const first = source(`settings`, `first`)
    const second = source(`settings`, `second`)
    const firstHook = renderHook(() =>
      useLiveQuery({
        client: firstClient,
        query: (q) => q.from({ settings: first }),
      }),
    )
    const secondHook = renderHook(() =>
      useLiveQuery({
        client: secondClient,
        query: (q) => q.from({ settings: second }),
      }),
    )

    await waitFor(() => {
      expect(firstHook.result.current.data[0]?.value).toBe(`first`)
      expect(secondHook.result.current.data[0]?.value).toBe(`second`)
    })
  })

  it(`keeps separate client-scoped Suspense hooks bound to their own sources`, async () => {
    const client = new DbClient()
    const first = source(`settings`, `first`)
    const second = source(`settings`, `second`)
    const View = ({ current }: { current: typeof first }) => {
      const { data } = useLiveSuspenseQuery({
        client,
        query: (q) => q.from({ settings: current }),
      })
      return <div>{data[0]?.value}</div>
    }
    const firstView = render(
      <Suspense fallback={<div>First loading</div>}>
        <View current={first} />
      </Suspense>,
    )
    await waitFor(() => expect(firstView.getByText(`first`)).toBeDefined())
    const secondView = render(
      <Suspense fallback={<div>Second loading</div>}>
        <View current={second} />
      </Suspense>,
    )
    await waitFor(() => expect(secondView.getByText(`second`)).toBeDefined())
  })

  it(`keeps a client-scoped Suspense retry bound to its new source`, async () => {
    const client = new DbClient()
    const first = source(`settings`, `first`)
    const second = source(`settings`, `second`)
    const never = new Promise<void>(() => {})
    const View = ({
      current,
      suspend,
    }: {
      current: typeof first
      suspend: boolean
    }) => {
      const { data } = useLiveSuspenseQuery({
        client,
        query: (q) => q.from({ settings: current }),
      })
      if (suspend) throw never
      return <div>{data[0]?.value}</div>
    }
    const root = render(
      <Suspense fallback={<div>Loading</div>}>
        <View current={first} suspend={true} />
      </Suspense>,
    )
    expect(root.getByText(`Loading`)).toBeDefined()
    root.rerender(
      <Suspense fallback={<div>Loading</div>}>
        <View current={second} suspend={false} />
      </Suspense>,
    )
    await waitFor(() => expect(root.getByText(`second`)).toBeDefined())
  })

  it(`remembers IDs across DbProvider client switches`, async () => {
    const firstClient = new DbClient()
    const secondClient = new DbClient()
    const first = source(`settings`, `first`)
    const otherScope = source(`settings`, `other`)
    const replacement = source(`settings`, `replacement`)
    const View = ({ current }: { current: typeof first }) => {
      const { data } = useLiveQuery({
        query: (q) => q.from({ settings: current }),
      })
      return <div>{data[0]?.value}</div>
    }
    const root = render(
      <DbProvider client={firstClient}>
        <View current={first} />
      </DbProvider>,
    )
    await waitFor(() => expect(root.getByText(`first`)).toBeDefined())
    root.rerender(
      <DbProvider client={secondClient}>
        <View current={otherScope} />
      </DbProvider>,
    )
    await waitFor(() => expect(root.getByText(`other`)).toBeDefined())
    expect(() =>
      root.rerender(
        <DbProvider client={firstClient}>
          <View current={replacement} />
        </DbProvider>,
      ),
    ).toThrow(SourceCollectionIdReuseError)
  })

  it(`remembers each client scope when one mounted hook switches clients`, async () => {
    const firstClient = new DbClient()
    const secondClient = new DbClient()
    const first = source(`settings`, `first`)
    const otherScope = source(`settings`, `other`)
    const replacement = source(`settings`, `replacement`)
    const hook = renderHook(
      ({ client, current }) =>
        useLiveQuery({
          client,
          query: (q) => q.from({ settings: current }),
        }),
      { initialProps: { client: firstClient, current: first } },
    )

    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`first`),
    )
    hook.rerender({ client: secondClient, current: otherScope })
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`other`),
    )
    checkRerender(
      [
        { source: first, client: firstClient },
        { source: otherScope, client: secondClient },
      ],
      { source: replacement, client: firstClient },
      () => hook.rerender({ client: firstClient, current: replacement }),
    )
  })

  it(`rejects same-ID reuse after a suspended render starts a source query`, async () => {
    const first = source(`first`, `first`)
    const abandoned = source(`candidate`, `abandoned`)
    const replacement = source(`candidate`, `replacement`)
    const never = new Promise<void>(() => {})
    const View = ({
      current,
      suspend,
    }: {
      current: typeof first
      suspend: boolean
    }) => {
      const { data } = useLiveQuery({
        query: (q) => q.from({ settings: current }),
      })
      if (suspend) throw never
      return <div>{data[0]?.value}</div>
    }
    const root = render(
      <Suspense fallback={<div>Loading</div>}>
        <View current={first} suspend={false} />
      </Suspense>,
    )
    await waitFor(() => expect(root.getByText(`first`)).toBeDefined())

    root.rerender(
      <Suspense fallback={<div>Loading</div>}>
        <View current={abandoned} suspend={true} />
      </Suspense>,
    )
    checkRerender(
      [{ source: first }, { source: abandoned }],
      { source: replacement },
      () =>
        root.rerender(
          <Suspense fallback={<div>Loading</div>}>
            <View current={replacement} suspend={false} />
          </Suspense>,
        ),
    )
  })
})

/**
 * ## useLiveInfiniteQuery
 *
 * The infinite hook derives its identity the same way, and keeps the window
 * collection built by its latest render for a second render before commit.
 * That cache is keyed by derived identity, which names sources by ID, so the
 * same law applies: a different same-ID source must reject before the hook
 * can publish the old source's rows, from a committed or a suspended render.
 * This driver reuses the model above with the bounded histories that
 * distinguish the law from a hash-only check.
 */
describe(`React source ID reuse: useLiveInfiniteQuery`, () => {
  const useInfinite = (current: ReturnType<typeof source>) =>
    useLiveInfiniteQuery(
      (q) =>
        q.from({ settings: current }).orderBy(({ settings }) => settings.rank),
      { pageSize: 1 },
    )

  it(`rejects a different active source with the same ID before exposing stale rows`, async () => {
    const first = source(`settings`, `first`)
    const second = source(`settings`, `second`)
    const hook = renderHook(({ current }) => useInfinite(current), {
      initialProps: { current: first },
    })
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`first`),
    )
    checkRerender([{ source: first }], { source: second }, () =>
      hook.rerender({ current: second }),
    )
  })

  it(`rejects a previously used ID after another source`, async () => {
    const first = source(`settings`, `first`)
    const other = source(`other`, `other`)
    const second = source(`settings`, `second`)
    const hook = renderHook(({ current }) => useInfinite(current), {
      initialProps: { current: first },
    })
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`first`),
    )
    act(() => hook.rerender({ current: other }))
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`other`),
    )
    checkRerender(
      [{ source: first }, { source: other }],
      { source: second },
      () => hook.rerender({ current: second }),
    )
  })

  it(`accepts the same source object and a different source ID`, async () => {
    const first = source(`settings`, `first`)
    const other = source(`other`, `other`)
    const hook = renderHook(({ current }) => useInfinite(current), {
      initialProps: { current: first },
    })
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`first`),
    )
    checkRerender([{ source: first }], { source: first }, () =>
      hook.rerender({ current: first }),
    )
    checkRerender([{ source: first }], { source: other }, () =>
      hook.rerender({ current: other }),
    )
    await waitFor(() =>
      expect(hook.result.current.data[0]?.value).toBe(`other`),
    )
  })

  it(`rejects same-ID reuse after a suspended render starts a source query`, async () => {
    const first = source(`first`, `first`)
    const abandoned = source(`candidate`, `abandoned`)
    const replacement = source(`candidate`, `replacement`)
    const never = new Promise<void>(() => {})
    const View = ({
      current,
      suspend,
    }: {
      current: typeof first
      suspend: boolean
    }) => {
      const { data } = useInfinite(current)
      if (suspend) throw never
      return <div>{data[0]?.value}</div>
    }
    const root = render(
      <Suspense fallback={<div>Loading</div>}>
        <View current={first} suspend={false} />
      </Suspense>,
    )
    await waitFor(() => expect(root.getByText(`first`)).toBeDefined())
    root.rerender(
      <Suspense fallback={<div>Loading</div>}>
        <View current={abandoned} suspend={true} />
      </Suspense>,
    )
    checkRerender(
      [{ source: first }, { source: abandoned }],
      { source: replacement },
      () =>
        root.rerender(
          <Suspense fallback={<div>Loading</div>}>
            <View current={replacement} suspend={false} />
          </Suspense>,
        ),
    )
  })
})
