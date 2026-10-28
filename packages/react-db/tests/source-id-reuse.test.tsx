// Ordinary React tests for source ID reuse: a rejected render releases the sync
// deferral it acquired, so a later reader can start a shared Collection. The reuse
// law is owned by source-id-reuse-oracle.test.tsx.
import { act, render, renderHook, waitFor } from '@testing-library/react'
import {
  DbClient,
  SourceCollectionIdReuseError,
  collectionOptions,
  createCollection,
  eq,
} from '@tanstack/db'
import { describe, expect, it, vi } from 'vitest'
import { Suspense } from 'react'
import { DbProvider } from '../src/DbProvider'
import { useLiveQuery } from '../src/useLiveQuery'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import { TestErrorBoundary, source } from './source-id-reuse-support'
import type { Context, QueryBuilder } from '@tanstack/db'

import type { Row } from './source-id-reuse-support'

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
    const View = ({
      current,
    }: {
      current: typeof first | typeof replacement
    }) => {
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
})
