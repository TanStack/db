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
 * This remains true when earlier deferred sync starts throw: each pending
 * Collection is attempted before the first startup error is rethrown.
 * The bounded histories below distinguish this law from a hash-only check,
 * which would miss A(id=x) -> C(id=y) -> B(id=x), a changed predicate, and
 * two different same-ID sources in one query.
 *
 * Driver and observation: render the public hook, then rerender it with each
 * source. At the rerender boundary, compare a thrown error or the public row.
 * This does not assert a process-wide Collection registry, legacy dependency
 * arrays, or explicit-key semantics; explicit queryKey callers own their key.
 */
import { act, render, renderHook, waitFor } from '@testing-library/react'
import {
  DbClient,
  collectionOptions,
  createCollection,
  eq,
  gt,
} from '@tanstack/db'
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
    expect(rerender).toThrow(/source Collection .*same ID/i)
  } else {
    expect(rerender).not.toThrow()
  }
}

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
                .join({ healthy }, ({ failingA, healthy }) =>
                  eq(failingA.id, healthy.id),
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

  it(`releases a shared descriptor's sync deferral when a collision tears down the hook`, async () => {
    const client = new DbClient()
    const first = source(`settings`, `first`)
    const replacement = source(`settings`, `replacement`)
    let syncStarts = 0
    const descriptor = collectionOptions(`shared-after-collision`, () => ({
      id: `shared-after-collision`,
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
    }))
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})

    function View({
      current,
      includeShared,
    }: {
      current: typeof first
      includeShared: boolean
    }) {
      useLiveQuery({
        client,
        query: (q) =>
          includeShared
            ? q
                .from({ settings: current })
                .join({ shared: descriptor }, ({ settings, shared }) =>
                  eq(settings.id, shared.id),
                )
            : q.from({ settings: current }),
      })
      return <div>Query</div>
    }

    try {
      const root = render(
        <TestErrorBoundary>
          <View current={first} includeShared={false} />
        </TestErrorBoundary>,
      )
      await act(async () => {})
      root.rerender(
        <TestErrorBoundary>
          <View current={replacement} includeShared={true} />
        </TestErrorBoundary>,
      )
      expect(root.getByText(`Rejected`)).toBeDefined()
      expect(syncStarts).toBe(0)

      const shared = client.collection(descriptor)
      const reader = renderHook(() => useLiveQuery(shared))
      await act(async () => {})
      expect(reader.result.current.status).toBe(`ready`)
      expect(reader.result.current.data[0]?.value).toBe(`shared`)
      expect(syncStarts).toBe(1)
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
    ).toThrow(/source Collection .*same ID/i)
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
    ).toThrow(/source Collection .*same ID/i)
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

  it(`releases a shared descriptor's sync deferral when a collision tears down the hook`, async () => {
    const client = new DbClient()
    const first = source(`settings`, `first`)
    const replacement = source(`settings`, `replacement`)
    let syncStarts = 0
    const descriptor = collectionOptions(
      `infinite-shared-after-collision`,
      () => ({
        id: `infinite-shared-after-collision`,
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
      }),
    )
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
    function View({
      current,
      includeShared,
    }: {
      current: typeof first
      includeShared: boolean
    }) {
      useLiveInfiniteQuery(
        (q) =>
          includeShared
            ? q
                .from({ settings: current })
                .join({ shared: descriptor }, ({ settings, shared }) =>
                  eq(settings.id, shared.id),
                )
                .orderBy(({ settings }) => settings.rank)
            : q
                .from({ settings: current })
                .orderBy(({ settings }) => settings.rank),
        { pageSize: 1, client },
      )
      return <div>Query</div>
    }
    try {
      const root = render(
        <TestErrorBoundary>
          <View current={first} includeShared={false} />
        </TestErrorBoundary>,
      )
      await act(async () => {})
      root.rerender(
        <TestErrorBoundary>
          <View current={replacement} includeShared={true} />
        </TestErrorBoundary>,
      )
      expect(root.getByText(`Rejected`)).toBeDefined()
      expect(syncStarts).toBe(0)
      const shared = client.collection(descriptor)
      const reader = renderHook(() => useLiveQuery(shared))
      await act(async () => {})
      expect(reader.result.current.data[0]?.value).toBe(`shared`)
      expect(syncStarts).toBe(1)
    } finally {
      consoleError.mockRestore()
    }
  })
})
