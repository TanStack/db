import { Component, Suspense } from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  DbClient,
  createCollection,
  createLiveQueryCollection,
  getStableValueHash,
} from '@tanstack/db'
import { DbProvider } from '../src/DbProvider'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import type { ReactNode } from 'react'

type Person = { id: string }

class Boundary extends Component<
  { children: ReactNode },
  { error: unknown; failed: boolean }
> {
  state = { error: undefined as unknown, failed: false }
  static getDerivedStateFromError(error: unknown) {
    return { error, failed: true }
  }
  render() {
    return this.state.failed ? (
      <div>Failed: {String(this.state.error)}</div>
    ) : (
      this.props.children
    )
  }
}

function setup(id: string) {
  const source = createCollection<Person>({
    id: `${id}-source`,
    getKey: (row) => row.id,
    sync: { sync: () => ({}) },
  })
  Object.defineProperty(
    source.config,
    Symbol.for(`@tanstack/db.persistedReadiness`),
    {
      value: {
        networkTimeoutMs: 60_000,
        getOrStartNetworkDeadline: () => Date.now() + 60_000,
        getSnapshot: () => ({ status: `ready` }),
        subscribe: () => () => {},
      },
    },
  )
  const query = createLiveQueryCollection((q) => q.from({ person: source }))
  const client = new DbClient()
  const hash = getStableValueHash([`collection`, query.id], `queryKey`)
  const pendingNetwork = new Promise<void>(() => {})
  const preload = vi.spyOn(query, `preload`).mockReturnValue(pendingNetwork)
  const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
  function View() {
    useLiveSuspenseQuery(query)
    return <div>Ready</div>
  }
  function tree(key: number) {
    return (
      <DbProvider client={client}>
        <Boundary key={key}>
          <Suspense fallback={<div>Loading</div>}>
            <View />
          </Suspense>
        </Boundary>
      </DbProvider>
    )
  }
  async function cleanup() {
    consoleError.mockRestore()
    preload.mockRestore()
    await query.cleanup()
    await source.cleanup()
  }
  return { query, client, hash, tree, cleanup }
}

describe(`useLiveSuspenseQuery client preload recovery`, () => {
  it(`joins a replacement client query after an ErrorBoundary retry`, async () => {
    const fixture = setup(`review-retry`)
    let rejectFirst!: (error: unknown) => void
    const first = new Promise<{ rows: Array<never> }>((_, reject) => {
      rejectFirst = reject
    })
    void fixture.client._registerLiveQuery(fixture.hash, first).catch(() => {})
    const view = render(fixture.tree(0))
    try {
      expect(view.getByText(`Loading`)).toBeTruthy()
      await act(async () => {
        rejectFirst(new Error(`first stream failed`))
        await first.catch(() => {})
      })
      await waitFor(() =>
        expect(
          view.getByText(/Failed: Error: first stream failed/),
        ).toBeTruthy(),
      )
      expect(fixture.client._getLiveQuery(fixture.hash)?.status).toBe(`error`)

      let resolveSecond!: (value: { rows: Array<never> }) => void
      const second = new Promise<{ rows: Array<never> }>((resolve) => {
        resolveSecond = resolve
      })
      void fixture.client
        ._registerLiveQuery(fixture.hash, second)
        .catch(() => {})
      expect(fixture.client._getLiveQuery(fixture.hash)?.status).toBe(`pending`)
      view.rerender(fixture.tree(1))
      expect(view.getByText(`Loading`)).toBeTruthy()
      await act(() => resolveSecond({ rows: [] }))
      await waitFor(() => expect(view.getByText(`Ready`)).toBeTruthy())
    } finally {
      view.unmount()
      await fixture.cleanup()
    }
  })

  it(`does not replace a newer client error with an old rejection`, async () => {
    const fixture = setup(`newer-client-error`)
    let rejectOld!: (error: unknown) => void
    const old = new Promise<{ rows: Array<never> }>((_, reject) => {
      rejectOld = reject
    })
    void fixture.client._registerLiveQuery(fixture.hash, old).catch(() => {})
    let rejectNew!: (error: unknown) => void
    const newer = new Promise<{ rows: Array<never> }>((_, reject) => {
      rejectNew = reject
    })
    void old.catch(() => {
      void fixture.client
        ._registerLiveQuery(fixture.hash, newer)
        .catch(() => {})
    })
    const view = render(fixture.tree(0))
    try {
      expect(view.getByText(`Loading`)).toBeTruthy()
      await act(async () => {
        rejectOld(new Error(`old request failed`))
        await old.catch(() => {})
      })
      expect(fixture.client._getLiveQuery(fixture.hash)?.status).toBe(`pending`)
      expect(view.getByText(`Loading`)).toBeTruthy()
      await act(async () => {
        rejectNew(new Error(`new request failed`))
        await newer.catch(() => {})
      })
      await waitFor(() =>
        expect(
          view.getByText(/Failed: Error: new request failed/),
        ).toBeTruthy(),
      )
    } finally {
      view.unmount()
      await fixture.cleanup()
    }
  })

  it(`ignores an old client rejection after Collection cleanup and restart`, async () => {
    const fixture = setup(`review-stale`)
    let rejectOld!: (error: unknown) => void
    const old = new Promise<{ rows: Array<never> }>((_, reject) => {
      rejectOld = reject
    })
    void fixture.client._registerLiveQuery(fixture.hash, old).catch(() => {})
    const firstView = render(fixture.tree(0))
    try {
      expect(firstView.getByText(`Loading`)).toBeTruthy()
      firstView.unmount()
      await fixture.query.cleanup()
      fixture.query.startSyncImmediate()
      expect(fixture.query.status).toBe(`loading`)

      await act(async () => {
        rejectOld(new Error(`obsolete stream failed`))
        await old.catch(() => {})
      })
      await fixture.client._registerLiveQuery(
        fixture.hash,
        Promise.resolve({ rows: [] }),
      )
      expect(fixture.client._getLiveQuery(fixture.hash)?.status).toBe(`success`)
      const secondView = render(fixture.tree(1))
      try {
        await waitFor(() => expect(secondView.getByText(`Ready`)).toBeTruthy())
      } finally {
        secondView.unmount()
      }
    } finally {
      firstView.unmount()
      await fixture.cleanup()
    }
  })
})
