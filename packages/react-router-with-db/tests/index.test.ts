import { describe, expect, it, vi } from 'vitest'
import { DbClient, collectionOptions } from '@tanstack/react-db'
import { routerWithDbClient } from '../src'
import type { AnyRouter } from '@tanstack/react-router'
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
  it(`streams live queries registered after critical dehydration`, async () => {
    const dbClient = new DbClient()
    const todos = dbClient.collection(createTodoDescriptor())
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
    let resolveQuery!: () => void
    const queryPromise = new Promise<void>((resolve) => {
      resolveQuery = resolve
    })
    dbClient._registerLiveQuery(`open-todos`, queryPromise)

    const reader = initialState!.dbStream.getReader()
    const streamedState = await reader.read()
    expect(streamedState.done).toBe(false)
    expect(streamedState.value?.collections).toEqual([])
    expect(streamedState.value?.liveQueries?.[0]?.queryHash).toBe(`open-todos`)

    dbClient.applyCollectionChunk({
      collectionId: todos.id,
      rows: [{ key: `1`, value: { id: `1`, text: `Streamed` } }],
    })
    resolveQuery()

    await expect(
      streamedState.value!.liveQueries![0]!.promise,
    ).resolves.toEqual({
      collections: [
        {
          collectionId: `todos`,
          rows: [{ key: `1`, value: { id: `1`, text: `Streamed` } }],
        },
      ],
    })

    finishRender()
    await expect(reader.read()).resolves.toEqual({
      done: true,
      value: undefined,
    })
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
