import { describe, expect, it, vi } from 'vitest'
import {
  act,
  render as renderComponent,
  renderHook,
  waitFor,
} from '@testing-library/react'
import {
  DbClient,
  collectionOptions,
  createCollection,
  createLiveQueryCollection,
  eq,
  getStableValueHash,
  gt,
} from '@tanstack/db'
import { Component, StrictMode, Suspense } from 'react'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import { useLiveQuery } from '../src/useLiveQuery'
import { DbProvider } from '../src/DbProvider'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import type { ReactNode } from 'react'

type Person = {
  id: string
  name: string
  age: number
  email: string
  isActive: boolean
  team: string
}

const initialPersons: Array<Person> = [
  {
    id: `1`,
    name: `John Doe`,
    age: 30,
    email: `john.doe@example.com`,
    isActive: true,
    team: `team1`,
  },
  {
    id: `2`,
    name: `Jane Doe`,
    age: 25,
    email: `jane.doe@example.com`,
    isActive: true,
    team: `team2`,
  },
  {
    id: `3`,
    name: `John Smith`,
    age: 35,
    email: `john.smith@example.com`,
    isActive: true,
    team: `team1`,
  },
]

// Wrapper component with Suspense
function SuspenseWrapper({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
}

class TestErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    return this.state.error ? (
      <div>Query failed: {this.state.error.message}</div>
    ) : (
      this.props.children
    )
  }
}

describe(`useLiveSuspenseQuery`, () => {
  it(`sends a persisted query-only preload failure to the error boundary`, async () => {
    const source = createCollection<Person>({
      id: `suspense-query-only-error-source`,
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
    const failure = new Error(`query failed independently of its source`)
    const preload = vi.spyOn(query, `preload`).mockRejectedValue(failure)
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})

    function View() {
      useLiveSuspenseQuery(query)
      return <div>Query ready</div>
    }

    const view = renderComponent(
      <TestErrorBoundary>
        <Suspense fallback={<div>Loading query</div>}>
          <View />
        </Suspense>
      </TestErrorBoundary>,
    )
    try {
      await waitFor(() =>
        expect(view.getByText(`Query failed: ${failure.message}`)).toBeTruthy(),
      )
      expect(view.queryByText(`Query ready`)).toBeNull()
    } finally {
      view.unmount()
      consoleError.mockRestore()
      preload.mockRestore()
      await query.cleanup()
      await source.cleanup()
    }
  })

  it.each([
    { name: `without a client stream`, failedClientStream: false },
    { name: `with an already failed client stream`, failedClientStream: true },
  ])(
    `sends a derived query load error to the boundary $name`,
    async ({ failedClientStream }) => {
      const failure = new Error(`derived query load failed`)
      const source = createCollection<Person>({
        id: `suspense-derived-query-error-source`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => {
                throw failure
              },
            }
          },
        },
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
      const query = createLiveQueryCollection((q) =>
        q.from({ person: source }).where(({ person }) => gt(person.age, 20)),
      )
      const client = failedClientStream ? new DbClient() : undefined
      if (client) {
        await expect(query.preload()).rejects.toBe(failure)
        const queryHash = getStableValueHash(
          [`collection`, query.id],
          `queryKey`,
        )
        const streamFailure = new Error(`client stream failed`)
        await expect(
          client._registerLiveQuery(queryHash, Promise.reject(streamFailure)),
        ).rejects.toBe(streamFailure)
      }
      const consoleError = vi
        .spyOn(console, `error`)
        .mockImplementation(() => {})

      function View() {
        useLiveSuspenseQuery(query)
        return <div>Query ready</div>
      }

      const content = (
        <TestErrorBoundary>
          <Suspense fallback={<div>Loading query</div>}>
            <View />
          </Suspense>
        </TestErrorBoundary>
      )
      const view = renderComponent(
        client ? <DbProvider client={client}>{content}</DbProvider> : content,
      )
      try {
        await waitFor(() =>
          expect(
            view.getByText(
              `Query failed: ${failedClientStream ? `client stream failed` : failure.message}`,
            ),
          ).toBeTruthy(),
        )
        expect(source.status).toBe(`ready`)
        expect(query.status).toBe(`error`)
      } finally {
        view.unmount()
        consoleError.mockRestore()
        await query.cleanup()
        await source.cleanup()
      }
    },
  )

  it(`does not share an initial-render failure between DbClients`, async () => {
    const source = createCollection<Person>({
      id: `suspense-client-error-source`,
      getKey: (row) => row.id,
      sync: { sync: () => ({}) },
    })
    // Neither client has a configured persisted fallback, so A's failure
    // must reach its boundary while B remains suspended on its own request.
    const query = createLiveQueryCollection((q) => q.from({ person: source }))
    const clientA = new DbClient()
    const clientB = new DbClient()
    const queryHash = getStableValueHash([`collection`, query.id], `queryKey`)
    let rejectClientA!: (error: Error) => void
    const clientALoad = new Promise<{
      rows: Array<{ key: string; value: Person }>
    }>((_, reject) => {
      rejectClientA = reject
    })
    void clientA._registerLiveQuery(queryHash, clientALoad).catch(() => {})
    const pendingQueryLoad = new Promise<void>(() => {})
    const preload = vi.spyOn(query, `preload`).mockReturnValue(pendingQueryLoad)
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})

    function View() {
      useLiveSuspenseQuery(query)
      return <div>Query ready</div>
    }

    const viewA = renderComponent(
      <DbProvider client={clientA}>
        <TestErrorBoundary>
          <Suspense fallback={<div>Client A loading</div>}>
            <View />
          </Suspense>
        </TestErrorBoundary>
      </DbProvider>,
    )
    let viewB: ReturnType<typeof renderComponent> | undefined
    try {
      expect(viewA.getByText(`Client A loading`)).toBeTruthy()
      await act(async () => {
        rejectClientA(new Error(`Client A failed`))
        await clientALoad.catch(() => {})
      })
      await waitFor(() =>
        expect(viewA.getByText(`Query failed: Client A failed`)).toBeTruthy(),
      )

      let resolveClientB!: (result: {
        rows: Array<{ key: string; value: Person }>
      }) => void
      const clientBLoad = new Promise<{
        rows: Array<{ key: string; value: Person }>
      }>((resolve) => {
        resolveClientB = resolve
      })
      void clientB._registerLiveQuery(queryHash, clientBLoad)
      viewB = renderComponent(
        <DbProvider client={clientB}>
          <TestErrorBoundary>
            <Suspense fallback={<div>Client B loading</div>}>
              <View />
            </Suspense>
          </TestErrorBoundary>
        </DbProvider>,
      )
      expect(viewB.getByText(`Client B loading`)).toBeTruthy()
      expect(viewB.container.textContent).not.toContain(`Client A failed`)
      await act(() => resolveClientB({ rows: [] }))
      await waitFor(() => expect(viewB!.getByText(`Query ready`)).toBeTruthy())
      expect(viewA.getByText(`Query failed: Client A failed`)).toBeTruthy()
    } finally {
      viewA.unmount()
      viewB?.unmount()
      consoleError.mockRestore()
      preload.mockRestore()
      await query.cleanup()
      await source.cleanup()
    }
  })

  it(`does not retain an initial-render failure after collection cleanup`, async () => {
    const source = createCollection<Person>({
      id: `suspense-restart-error-source`,
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
    const failure = new Error(`first query run failed`)
    const pendingRetry = new Promise<void>(() => {})
    const preload = vi
      .spyOn(query, `preload`)
      .mockRejectedValueOnce(failure)
      .mockReturnValue(pendingRetry)
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})

    function View() {
      useLiveSuspenseQuery(query)
      return <div>Query ready</div>
    }

    const renderView = () =>
      renderComponent(
        <TestErrorBoundary>
          <Suspense fallback={<div>Loading query</div>}>
            <View />
          </Suspense>
        </TestErrorBoundary>,
      )
    const first = renderView()
    let second: ReturnType<typeof renderView> | undefined
    try {
      await waitFor(() =>
        expect(
          first.getByText(`Query failed: ${failure.message}`),
        ).toBeTruthy(),
      )
      first.unmount()
      await query.cleanup()

      second = renderView()
      expect(second.getByText(`Loading query`)).toBeTruthy()
      expect(second.container.textContent).not.toContain(failure.message)
    } finally {
      first.unmount()
      second?.unmount()
      consoleError.mockRestore()
      preload.mockRestore()
      await query.cleanup()
      await source.cleanup()
    }
  })

  it.each([
    {
      name: `immediate persisted fallback`,
      networkTimeoutMs: 0,
      outcome: `pending`,
    },
    {
      name: `persisted fallback after the deadline`,
      networkTimeoutMs: 30,
      outcome: `timeout`,
    },
    { name: `network readiness`, networkTimeoutMs: 60_000, outcome: `ready` },
    {
      name: `early network failure`,
      networkTimeoutMs: 60_000,
      outcome: `error`,
    },
  ] as const)(
    `gates the first render: $name`,
    async ({ networkTimeoutMs, outcome }) => {
      let sync:
        | {
            begin: () => void
            write: (row: Person) => void
            commit: () => void
            markReady: () => void
            markError: (error: unknown) => void
          }
        | undefined
      const source = createCollection<Person>({
        id: `suspense-persisted-${outcome}`,
        getKey: (row) => row.id,
        sync: {
          sync: ({ begin, write, commit, markReady, markError }) => {
            sync = {
              begin,
              write: (row) => write({ type: `insert`, value: row }),
              commit: () => {
                commit()
              },
              markReady,
              markError,
            }
            return {}
          },
        },
      })
      let persistedStatus: `loading` | `ready` = `loading`
      let networkDeadlineAt: number | undefined
      const listeners = new Set<() => void>()
      Object.defineProperty(
        source.config,
        Symbol.for(`@tanstack/db.persistedReadiness`),
        {
          value: {
            networkTimeoutMs,
            getOrStartNetworkDeadline: () =>
              (networkDeadlineAt ??= Date.now() + networkTimeoutMs),
            getSnapshot: () => ({ status: persistedStatus }),
            subscribe: (listener: () => void) => {
              listeners.add(listener)
              return () => listeners.delete(listener)
            },
          },
        },
      )
      let cleanupQuery: (() => Promise<void>) | undefined

      function LocalPerson() {
        const result = useLiveSuspenseQuery((q) => q.from({ person: source }))
        cleanupQuery = () => result.collection.cleanup()
        const { data } = result
        return <div>{data[0]?.name}</div>
      }
      const statusView = renderHook(() => useLiveQuery(source))
      const view = renderComponent(
        <Suspense fallback={<div>Waiting for network</div>}>
          <LocalPerson />
        </Suspense>,
      )
      try {
        expect(view.getByText(`Waiting for network`)).toBeTruthy()
        await waitFor(() => expect(sync).toBeDefined())
        await act(() => {
          sync!.begin()
          sync!.write(initialPersons[0]!)
          sync!.commit()
          persistedStatus = `ready`
          for (const listener of listeners) listener()
        })
        await waitFor(() =>
          expect(statusView.result.current.persistedStatus).toBe(`ready`),
        )
        if (outcome === `pending` || outcome === `timeout`) {
          await waitFor(() => expect(view.getByText(`John Doe`)).toBeTruthy())
          expect(source.status).toBe(`loading`)
        } else {
          expect(view.getByText(`Waiting for network`)).toBeTruthy()
          await act(() => {
            if (outcome === `ready`) sync!.markReady()
            else sync!.markError(new Error(`network failed`))
          })
          await waitFor(() => expect(view.getByText(`John Doe`)).toBeTruthy())
          expect(source.status).toBe(outcome)
        }
      } finally {
        view.unmount()
        statusView.unmount()
        await cleanupQuery?.()
        await source.cleanup()
      }
    },
  )

  it(`renders a streamed query snapshot until browser sync is authoritative`, async () => {
    let resolveServerLoad!: () => void
    const serverLoad = new Promise<void>((resolve) => {
      resolveServerLoad = resolve
    })
    let resolveBrowserLoad!: () => void
    let finishBrowserLoad!: () => void
    const browserLoadPromise = new Promise<void>((resolve) => {
      finishBrowserLoad = resolve
    })
    const browserLoad = vi.fn()
    const descriptor = collectionOptions(`streamed-people`, (client) => {
      const runtime = client.requireDependency<`server` | `browser`>(`runtime`)

      return {
        id: `streamed-people`,
        getKey: (person: Person) => person.id,
        syncMode: `on-demand` as const,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            return {
              loadSubset:
                runtime === `server`
                  ? async () => {
                      await serverLoad
                      begin({ immediate: true })
                      write({ type: `insert`, value: initialPersons[0]! })
                      commit()
                    }
                  : () => {
                      browserLoad()
                      resolveBrowserLoad = () => {
                        begin({ immediate: true })
                        write({
                          type: `insert`,
                          value: initialPersons[1]!,
                        })
                        commit()
                        finishBrowserLoad()
                      }
                      return browserLoadPromise
                    },
            }
          },
        },
      }
    })
    const serverClient = new DbClient({ runtime: `server` })
    serverClient._setSsrStreamingEnabled(true)
    const serverWrapper = ({ children }: { children: ReactNode }) => (
      <DbProvider client={serverClient}>
        <Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
      </DbProvider>
    )
    const serverHook = renderHook(
      () =>
        useLiveSuspenseQuery({
          query: (q) => q.from({ people: descriptor }),
        }),
      { wrapper: serverWrapper },
    )

    const dehydrated = serverClient.dehydrate({
      shouldDehydrateCollection: () => false,
      shouldDehydrateLiveQuery: () => true,
    })
    const dehydratedQuery = dehydrated.liveQueries?.[0]
    expect(dehydratedQuery).toBeDefined()

    const browserClient = new DbClient({ runtime: `browser` })
    browserClient._setSsrStreamingEnabled(true)
    browserClient.hydrate(dehydrated)
    const browserWrapper = ({ children }: { children: ReactNode }) => (
      <DbProvider client={browserClient}>
        <Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
      </DbProvider>
    )
    const browserHook = renderHook(
      () =>
        useLiveSuspenseQuery({
          query: (q) => q.from({ people: descriptor }),
        }),
      { wrapper: browserWrapper },
    )

    expect(browserLoad).not.toHaveBeenCalled()

    await act(async () => {
      resolveServerLoad()
      await browserClient._getLiveQuery(dehydratedQuery!.queryHash)?.promise
    })

    await waitFor(() => {
      expect(browserHook.result.current.data).toHaveLength(1)
      expect(browserHook.result.current.data[0]).toMatchObject(
        initialPersons[0]!,
      )
    })
    expect(browserLoad).toHaveBeenCalled()

    await act(async () => resolveBrowserLoad())

    await waitFor(() => {
      expect(browserHook.result.current.data).toHaveLength(1)
      expect(browserHook.result.current.data[0]).toMatchObject(
        initialPersons[1]!,
      )
    })
    serverHook.unmount()
    browserHook.unmount()
  })

  it(`requires queryKey for an opaque query during SSR streaming`, () => {
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const descriptor = collectionOptions(`streamed-people`, () => ({
      id: `streamed-people`,
      getKey: (person: Person) => person.id,
      syncMode: `on-demand` as const,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return { loadSubset: () => new Promise<void>(() => {}) }
        },
      },
    }))
    const client = new DbClient()
    client._setSsrStreamingEnabled(true)
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DbProvider client={client}>{children}</DbProvider>
    )

    expect(() =>
      renderHook(
        () =>
          useLiveSuspenseQuery({
            query: (q) =>
              q
                .from({ people: descriptor })
                .fn.where(({ people }) => people.age > 20),
          }),
        { wrapper },
      ),
    ).toThrow(/Provide an explicit serializable queryKey/)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`cannot derive a stable identity`),
    )
    warn.mockRestore()
  })

  it(`throws the original streamed query error`, async () => {
    const error = new Error(`Server load failed`)
    const queryKey = [`streamed-people-error`] as const
    const queryHash = getStableValueHash([`queryKey`, queryKey], `queryKey`)
    const descriptor = collectionOptions(`streamed-people-error`, () => ({
      id: `streamed-people-error`,
      getKey: (person: Person) => person.id,
      syncMode: `on-demand` as const,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return { loadSubset: () => new Promise<void>(() => {}) }
        },
      },
    }))
    const client = new DbClient()
    client._setSsrStreamingEnabled(true)
    await expect(
      client._registerLiveQuery(queryHash, Promise.reject(error)),
    ).rejects.toBe(error)
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DbProvider client={client}>{children}</DbProvider>
    )
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})

    expect(() =>
      renderHook(
        () =>
          useLiveSuspenseQuery({
            queryKey,
            query: (q) => q.from({ people: descriptor }),
          }),
        { wrapper },
      ),
    ).toThrow(error)

    consoleError.mockRestore()
  })

  it(`should suspend while loading and return data when ready`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-1`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    const { result } = renderHook(
      () => {
        return useLiveSuspenseQuery((q) =>
          q
            .from({ persons: collection })
            .where(({ persons }) => gt(persons.age, 30))
            .select(({ persons }) => ({
              id: persons.id,
              name: persons.name,
              age: persons.age,
            })),
        )
      },
      {
        wrapper: SuspenseWrapper,
      },
    )

    // Wait for data to load
    await waitFor(() => {
      expect(result.current.state.size).toBe(1)
    })

    expect(result.current.data).toHaveLength(1)
    const johnSmith = result.current.data[0]
    expect(johnSmith).toMatchObject({
      id: `3`,
      name: `John Smith`,
      age: 35,
    })
  })

  it(`should return data that is always defined (type-safe)`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-2`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    const { result } = renderHook(
      () => {
        return useLiveSuspenseQuery((q) => q.from({ persons: collection }))
      },
      {
        wrapper: SuspenseWrapper,
      },
    )

    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })

    // Data is always defined - no optional chaining needed
    expect(result.current.data.length).toBe(3)
    // TypeScript will guarantee data is Array<Person>, not Array<Person> | undefined
  })

  it(`should work with single result queries`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-3`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    const { result } = renderHook(
      () => {
        return useLiveSuspenseQuery((q) =>
          q
            .from({ collection })
            .where(({ collection: c }) => eq(c.id, `3`))
            .findOne(),
        )
      },
      {
        wrapper: SuspenseWrapper,
      },
    )

    await waitFor(() => {
      expect(result.current.state.size).toBe(1)
    })

    expect(result.current.data).toMatchObject({
      id: `3`,
      name: `John Smith`,
      age: 35,
    })
  })

  it(`should work with pre-created live query collection`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-4`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    const liveQuery = createLiveQueryCollection((q) =>
      q
        .from({ persons: collection })
        .where(({ persons }) => gt(persons.age, 30)),
    )

    const { result } = renderHook(() => useLiveSuspenseQuery(liveQuery), {
      wrapper: SuspenseWrapper,
    })

    await waitFor(() => {
      expect(result.current.data).toHaveLength(1)
    })

    expect(result.current.data[0]).toMatchObject({
      id: `3`,
      name: `John Smith`,
      age: 35,
    })
  })

  it(`should re-suspend when derived query identity changes`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-5`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    const { result, rerender } = renderHook(
      ({ minAge }) => {
        return useLiveSuspenseQuery({
          query: (q) =>
            q
              .from({ persons: collection })
              .where(({ persons }) => gt(persons.age, minAge)),
        })
      },
      {
        wrapper: SuspenseWrapper,
        initialProps: { minAge: 30 },
      },
    )

    // Initial load - age > 30
    await waitFor(() => {
      expect(result.current.data).toHaveLength(1)
    })
    expect(result.current.data[0]?.age).toBe(35)

    // Change derived identity - age > 20
    rerender({ minAge: 20 })

    // Should re-suspend and load new data
    await waitFor(() => {
      expect(result.current.data).toHaveLength(3)
    })
  })

  it(`should reactively update data after initial load`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-6`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    const { result } = renderHook(
      () => useLiveSuspenseQuery((q) => q.from({ persons: collection })),
      {
        wrapper: SuspenseWrapper,
      },
    )

    // Wait for initial data
    await waitFor(() => {
      expect(result.current.data).toHaveLength(3)
    })

    // Insert new person
    collection.insert({
      id: `4`,
      name: `New Person`,
      age: 40,
      email: `new@example.com`,
      isActive: true,
      team: `team1`,
    })

    // Should reactively update
    await waitFor(() => {
      expect(result.current.data).toHaveLength(4)
    })
  })

  it(`should throw error when query function returns undefined`, () => {
    expect(() => {
      renderHook(
        () => {
          return useLiveSuspenseQuery(() => undefined as any)
        },
        {
          wrapper: SuspenseWrapper,
        },
      )
    }).toThrow(/does not support disabled queries/)
  })

  it(`does not rebuild an explicitly keyed query after it commits`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `stable-keyed-suspense-query`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )
    let queryExecutions = 0

    const { result, rerender } = renderHook(
      ({ render }: { render: number }) => {
        void render
        return useLiveSuspenseQuery({
          queryKey: [collection.id, `stable`],
          query: (q) => {
            queryExecutions += 1
            return q.from({ people: collection })
          },
        })
      },
      {
        initialProps: { render: 0 },
        wrapper: SuspenseWrapper,
      },
    )

    await waitFor(() => expect(result.current.data).toHaveLength(3))
    const executionsAfterCommit = queryExecutions

    rerender({ render: 1 })

    expect(result.current.data).toHaveLength(3)
    expect(queryExecutions).toBe(executionsAfterCommit)
  })

  it(`should work with config object`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-7`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    const { result } = renderHook(
      () => {
        return useLiveSuspenseQuery({
          query: (q) => q.from({ persons: collection }),
        })
      },
      {
        wrapper: SuspenseWrapper,
      },
    )

    await waitFor(() => {
      expect(result.current.data).toHaveLength(3)
    })
  })

  it(`should keep stable data references when data hasn't changed`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-8`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    const { result, rerender } = renderHook(
      () => useLiveSuspenseQuery((q) => q.from({ persons: collection })),
      {
        wrapper: SuspenseWrapper,
      },
    )

    await waitFor(() => {
      expect(result.current.data).toHaveLength(3)
    })

    const data1 = result.current.data

    rerender()

    const data2 = result.current.data

    // Data objects should be stable
    expect(data1[0]).toBe(data2[0])
    expect(data1[1]).toBe(data2[1])
    expect(data1[2]).toBe(data2[2])
  })

  it(`should handle multiple queries in same component (serial execution)`, async () => {
    const personsCollection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-9`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    const { result } = renderHook(
      () => {
        const persons = useLiveSuspenseQuery((q) =>
          q.from({ persons: personsCollection }),
        )
        const johnDoe = useLiveSuspenseQuery((q) =>
          q
            .from({ persons: personsCollection })
            .where(({ persons: p }) => eq(p.id, `1`))
            .findOne(),
        )
        return { persons, johnDoe }
      },
      {
        wrapper: SuspenseWrapper,
      },
    )

    await waitFor(() => {
      expect(result.current.persons.data).toHaveLength(3)
      expect(result.current.johnDoe.data).toBeDefined()
    })

    expect(result.current.johnDoe.data).toMatchObject({
      id: `1`,
      name: `John Doe`,
    })
  })

  it(`should cleanup collection when unmounted`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-10`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    const { result, unmount } = renderHook(
      () =>
        useLiveSuspenseQuery({
          query: (q) => q.from({ persons: collection }),
          gcTime: 1,
        }),
      {
        wrapper: SuspenseWrapper,
      },
    )

    await waitFor(() => {
      expect(result.current.data).toHaveLength(3)
    })

    const liveQueryCollection = result.current.collection
    expect(liveQueryCollection.subscriberCount).toBeGreaterThan(0)

    unmount()

    // An explicit short gcTime still opts out of the Suspense grace period.
    await waitFor(
      () => {
        expect(liveQueryCollection.status).toBe(`cleaned-up`)
      },
      { timeout: 1000 },
    )
  })

  it(`should NOT re-suspend on live updates after initial load`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-11`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    let suspenseCount = 0
    const SuspenseCounter = ({ children }: { children: ReactNode }) => {
      return (
        <Suspense
          fallback={
            <div>
              {(() => {
                suspenseCount++
                return `Loading...`
              })()}
            </div>
          }
        >
          {children}
        </Suspense>
      )
    }

    const { result } = renderHook(
      () => useLiveSuspenseQuery((q) => q.from({ persons: collection })),
      {
        wrapper: SuspenseCounter,
      },
    )

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.data).toHaveLength(3)
    })

    const initialSuspenseCount = suspenseCount

    // Make multiple live updates
    collection.insert({
      id: `4`,
      name: `New Person 1`,
      age: 40,
      email: `new1@example.com`,
      isActive: true,
      team: `team1`,
    })

    await waitFor(() => {
      expect(result.current.data).toHaveLength(4)
    })

    collection.insert({
      id: `5`,
      name: `New Person 2`,
      age: 45,
      email: `new2@example.com`,
      isActive: true,
      team: `team2`,
    })

    await waitFor(() => {
      expect(result.current.data).toHaveLength(5)
    })

    collection.delete(`4`)

    await waitFor(() => {
      expect(result.current.data).toHaveLength(4)
    })

    // Verify suspense count hasn't increased (no re-suspension)
    expect(suspenseCount).toBe(initialSuspenseCount)
  })

  it(`should only suspend on deps change, not on every re-render`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-12`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    const { result, rerender } = renderHook(
      ({ minAge }) =>
        useLiveSuspenseQuery(
          (q) =>
            q
              .from({ persons: collection })
              .where(({ persons }) => gt(persons.age, minAge)),
          [minAge],
        ),
      {
        wrapper: SuspenseWrapper,
        initialProps: { minAge: 20 },
      },
    )

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.data).toHaveLength(3)
    })

    const dataAfterInitial = result.current.data

    // Re-render with SAME deps - should NOT suspend (data stays available)
    rerender({ minAge: 20 })
    expect(result.current.data).toHaveLength(3)
    expect(result.current.data).toBe(dataAfterInitial)

    rerender({ minAge: 20 })
    expect(result.current.data).toHaveLength(3)

    rerender({ minAge: 20 })
    expect(result.current.data).toHaveLength(3)

    // Change deps - SHOULD suspend and get new data
    rerender({ minAge: 30 })

    await waitFor(() => {
      expect(result.current.data).toHaveLength(1)
    })

    expect(result.current.data[0]?.age).toBe(35)
  })

  it(`should work with pre-created SingleResult collection`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-single`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    // Pre-create a SingleResult live query collection
    const singlePersonQuery = createLiveQueryCollection((q) =>
      q
        .from({ persons: collection })
        .where(({ persons }) => eq(persons.id, `1`))
        .findOne(),
    )

    const { result } = renderHook(
      () => useLiveSuspenseQuery(singlePersonQuery),
      {
        wrapper: SuspenseWrapper,
      },
    )

    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })

    expect(result.current.data).toMatchObject({
      id: `1`,
      name: `John Doe`,
      age: 30,
    })
  })

  it(`should handle StrictMode double-invocation correctly`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-strict`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    const StrictModeWrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
      </StrictMode>
    )

    const { result } = renderHook(
      () => useLiveSuspenseQuery((q) => q.from({ persons: collection })),
      {
        wrapper: StrictModeWrapper,
      },
    )

    await waitFor(() => {
      expect(result.current.data).toHaveLength(3)
    })

    // Verify data is correct despite double-invocation
    expect(result.current.data).toHaveLength(3)
    expect(result.current.data[0]).toMatchObject({
      id: `1`,
      name: `John Doe`,
    })
  })

  it(`should not re-suspend after hasBeenReady when isLoadingSubset changes`, async () => {
    // This test verifies that after the initial ready state is reached,
    // subsequent isLoadingSubset changes don't cause re-suspension
    // (stale-while-revalidate behavior, matching TanStack Query)

    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-on-demand`,
        getKey: (person: Person) => person.id,
        initialData: initialPersons,
      }),
    )

    let suspenseCount = 0

    const SuspenseTracker = ({ children }: { children: ReactNode }) => {
      return (
        <Suspense
          fallback={
            <div>
              {(() => {
                suspenseCount++
                return `Loading...`
              })()}
            </div>
          }
        >
          {children}
        </Suspense>
      )
    }

    const { result } = renderHook(
      () => {
        return useLiveSuspenseQuery((q) => q.from({ persons: collection }))
      },
      {
        wrapper: SuspenseTracker,
      },
    )

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.data).toHaveLength(3)
    })

    const initialSuspenseCount = suspenseCount

    // Now simulate on-demand loading by tracking a load promise on the live query collection
    // This mimics what happens when a new subset query is made in on-demand mode
    let resolveLoadPromise: () => void
    const loadPromise = new Promise<void>((resolve) => {
      resolveLoadPromise = resolve
    })

    // Track the load promise on the LIVE QUERY collection - this sets isLoadingSubset = true
    result.current.collection._sync.trackLoadPromise(loadPromise)

    // Verify isLoadingSubset is now true on the live query collection
    expect(result.current.collection.isLoadingSubset).toBe(true)

    // The collection is still ready, but isLoadingSubset is true
    expect(result.current.collection.status).toBe(`ready`)

    // Resolve the load promise to simulate data loading complete
    resolveLoadPromise!()

    // Wait for the loadingSubset:change event to propagate
    await waitFor(() => {
      expect(result.current.collection.isLoadingSubset).toBe(false)
    })

    // After hasBeenReadyRef is set, subsequent isLoadingSubset changes
    // should NOT cause re-suspension (stale-while-revalidate behavior)
    expect(suspenseCount).toBe(initialSuspenseCount)

    // Data should still be available
    expect(result.current.data).toHaveLength(3)
  })
})
