import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { DbClient, collectionOptions } from '@tanstack/react-db'
import { routerWithDbClient } from '../src'
import type { AnyRouter } from '@tanstack/react-router'
import type { DehydratedDbState } from '@tanstack/react-db'
import type { DehydratedRouterDbState } from '../src'

type Todo = {
  id: string
  text: string
}

const adaptRouter = routerWithDbClient as unknown as (
  router: AnyRouter,
  dbClient: DbClient,
) => AnyRouter

function createTodoDescriptor() {
  return collectionOptions(`todos`, () => ({
    id: `todos`,
    getKey: (todo: Todo) => todo.id,
    sync: {
      sync: ({ markReady }) => markReady(),
    },
  }))
}

describe(`routerWithDbClient`, () => {
  it(`declares peer floors that contain the imported SSR APIs`, () => {
    const packageJson = JSON.parse(readFileSync(`package.json`, `utf8`)) as {
      peerDependencies: Record<string, string>
    }

    expect(packageJson.peerDependencies).toMatchObject({
      '@tanstack/react-db': `>=0.2.1`,
      '@tanstack/router-core': `>=1.127.0`,
    })
  })

  it(`leaves SSR streaming disabled in the browser until hydration starts`, () => {
    const dbClient = new DbClient()
    const router = {
      options: { context: { dbClient } },
      isServer: false,
    } as unknown as AnyRouter

    adaptRouter(router, dbClient)

    expect(dbClient._isSsrStreamingEnabled()).toBe(false)
  })

  it(`cleans up server collections when rendering finishes`, async () => {
    const cleanup = vi.fn()
    const dbClient = new DbClient()
    const collection = dbClient.collection(
      collectionOptions(`server-cleanup`, () => ({
        id: `server-cleanup`,
        getKey: (todo: Todo) => todo.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return cleanup
          },
        },
      })),
    )
    await collection.preload()
    let finishRender = () => {}
    const router = {
      options: { context: { dbClient } },
      isServer: true,
      serverSsr: {
        isDehydrated: () => false,
        onRenderFinished: (callback: () => void) => {
          finishRender = callback
        },
      },
    } as unknown as AnyRouter

    adaptRouter(router, dbClient)
    expect(dbClient._isSsrServerCleanupEnabled()).toBe(true)
    await router.options.dehydrate?.()
    finishRender()

    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce())
    expect(dbClient._isSsrServerCleanupEnabled()).toBe(false)
  })

  it(`streams live queries registered after critical dehydration`, async () => {
    const dbClient = new DbClient()
    let isDehydrated = false
    let finishRender = () => {}
    const router = {
      options: { context: { dbClient } },
      isServer: true,
      serverSsr: {
        isDehydrated: () => isDehydrated,
        onRenderFinished: (callback: () => void) => {
          finishRender = callback
        },
      },
    } as unknown as AnyRouter

    adaptRouter(router, dbClient)
    const initialState = (await router.options.dehydrate?.()) as
      | DehydratedRouterDbState
      | undefined
    expect(initialState).toBeDefined()
    expect(initialState!.dehydratedDbClient.liveQueries).toBeUndefined()

    isDehydrated = true
    let resolveQuery!: (snapshot: {
      rows: Array<{ key: string; value: Todo }>
    }) => void
    const queryPromise = new Promise<{
      rows: Array<{ key: string; value: Todo }>
    }>((resolve) => {
      resolveQuery = resolve
    })
    dbClient._registerLiveQuery(`open-todos`, queryPromise)

    const reader = initialState!.dbStream.getReader()
    const streamedState = await reader.read()
    expect(streamedState.done).toBe(false)
    expect(streamedState.value?.collections).toEqual([])
    expect(streamedState.value?.liveQueries?.[0]?.queryHash).toBe(`open-todos`)

    resolveQuery({
      rows: [{ key: `1`, value: { id: `1`, text: `Streamed` } }],
    })

    await expect(
      streamedState.value!.liveQueries![0]!.promise,
    ).resolves.toEqual({
      rows: [{ key: `1`, value: { id: `1`, text: `Streamed` } }],
    })

    finishRender()
    await expect(reader.read()).resolves.toEqual({
      done: true,
      value: undefined,
    })
  })

  it(`includes queries registered while critical dehydration is pending`, async () => {
    const dbClient = new DbClient()
    let releaseOriginalDehydrate!: () => void
    const originalDehydrate = new Promise<void>((resolve) => {
      releaseOriginalDehydrate = resolve
    })
    let finishRender = () => {}
    const router = {
      options: {
        context: { dbClient },
        dehydrate: () => originalDehydrate,
      },
      isServer: true,
      serverSsr: {
        isDehydrated: () => false,
        onRenderFinished: (callback: () => void) => {
          finishRender = callback
        },
      },
    } as unknown as AnyRouter

    adaptRouter(router, dbClient)
    const statePromise = router.options.dehydrate?.()
    dbClient._registerLiveQuery(
      `during-critical`,
      Promise.resolve({ rows: [] }),
    )
    releaseOriginalDehydrate()

    const state = (await statePromise) as DehydratedRouterDbState
    expect(
      state.dehydratedDbClient.liveQueries?.map((query) => query.queryHash),
    ).toEqual([`during-critical`])

    const reader = state.dbStream.getReader()
    finishRender()
    await expect(reader.read()).resolves.toEqual({
      done: true,
      value: undefined,
    })
  })

  it(`rejects pending live queries when the client stream fails`, async () => {
    const dbClient = new DbClient()
    const router = {
      options: { context: { dbClient } },
      isServer: false,
    } as unknown as AnyRouter
    const error = new Error(`transport failed`)
    const pendingSnapshot = new Promise<{ rows: [] }>(() => {})
    const dbStream = new ReadableStream<DehydratedDbState>({
      start(controller) {
        controller.error(error)
      },
    })
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})

    adaptRouter(router, dbClient)
    await router.options.hydrate?.({
      dehydratedDbClient: {
        collections: [],
        liveQueries: [
          {
            queryHash: `pending`,
            dehydratedAt: 1,
            promise: pendingSnapshot,
          },
        ],
      },
      dbStream,
    } satisfies DehydratedRouterDbState)

    await expect(dbClient._getLiveQuery(`pending`)?.promise).rejects.toBe(error)
    await vi.waitFor(() => {
      expect(dbClient._isSsrStreamingEnabled()).toBe(false)
    })
    consoleError.mockRestore()
  })

  it(`does not enqueue after the stream is cancelled`, async () => {
    const dbClient = new DbClient()
    let finishRender = () => {}
    const router = {
      options: { context: { dbClient } },
      isServer: true,
      serverSsr: {
        isDehydrated: () => true,
        onRenderFinished: (callback: () => void) => {
          finishRender = callback
        },
      },
    } as unknown as AnyRouter
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})

    adaptRouter(router, dbClient)
    const state =
      (await router.options.dehydrate?.()) as DehydratedRouterDbState
    await state.dbStream.cancel()

    expect(() =>
      dbClient._registerLiveQuery(`late`, Promise.resolve({ rows: [] })),
    ).not.toThrow()
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining(`after the DB stream was closed`),
    )

    finishRender()
    warning.mockRestore()
  })

  it(`hydrates every client stream entry`, async () => {
    const dbClient = new DbClient()
    const todoDescriptor = createTodoDescriptor()
    const originalHydrate = vi.fn()
    const router = {
      options: {
        context: { dbClient },
        hydrate: originalHydrate,
      },
      isServer: false,
    } as unknown as AnyRouter
    const dbStream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          collections: [
            {
              collectionId: `todos`,
              rows: [{ key: `1`, value: { id: `1`, text: `From the stream` } }],
            },
          ],
        })
        controller.close()
      },
    })

    adaptRouter(router, dbClient)
    await router.options.hydrate?.({
      dehydratedDbClient: { collections: [] },
      dbStream,
    } satisfies DehydratedRouterDbState)

    expect(originalHydrate).toHaveBeenCalledOnce()
    await vi.waitFor(() => {
      expect(dbClient.collection(todoDescriptor).get(`1`)).toMatchObject({
        id: `1`,
        text: `From the stream`,
      })
      expect(dbClient._isSsrStreamingEnabled()).toBe(false)
    })
  })
})
