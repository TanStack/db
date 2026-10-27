// Ordinary React tests for source ID reuse: a rejected render releases the sync
// deferral it acquired, so a later reader can start a shared Collection. The reuse
// law is owned by source-id-reuse-oracle.test.tsx.
import { act, render, renderHook, waitFor } from '@testing-library/react'
import { DbClient, collectionOptions, eq } from '@tanstack/db'
import { describe, expect, it, vi } from 'vitest'
import { Suspense } from 'react'
import { DbProvider } from '../src/DbProvider'
import { useLiveQuery } from '../src/useLiveQuery'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import { TestErrorBoundary, source } from './source-id-reuse-support'
import type { Context, QueryBuilder } from '@tanstack/db'

import type { Row } from './source-id-reuse-support'

type Row = { id: string; value: string; rank: number }

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
})

describe(`React source ID reuse: useLiveInfiniteQuery`, () => {
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
