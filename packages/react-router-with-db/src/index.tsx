import { Fragment } from 'react'
import { DbProvider } from '@tanstack/react-db'
import '@tanstack/router-core/ssr/client'
import type { AnyRouter } from '@tanstack/react-router'
import type { DbClient, DehydratedDbState } from '@tanstack/react-db'
import type { ReactNode } from 'react'

type AdditionalOptions = {
  WrapProvider?: (props: { children: ReactNode }) => React.JSX.Element
}

export type DehydratedRouterDbState = {
  dehydratedDbClient: DehydratedDbState
  dbStream: ReadableStream<DehydratedDbState>
}

export type ValidateRouter<TRouter extends AnyRouter> =
  NonNullable<TRouter[`options`][`context`]> extends { dbClient: DbClient }
    ? TRouter
    : never

export function routerWithDbClient<TRouter extends AnyRouter>(
  router: ValidateRouter<TRouter>,
  dbClient: DbClient,
  additionalOptions?: AdditionalOptions,
): TRouter {
  const originalOptions = router.options
  dbClient._setSsrStreamingEnabled(true)

  router.options = {
    ...router.options,
    context: {
      ...originalOptions.context,
      dbClient,
    },
    Wrap: ({ children }) => {
      const OuterWrapper = additionalOptions?.WrapProvider ?? Fragment
      const OriginalWrap = originalOptions.Wrap ?? Fragment

      return (
        <OuterWrapper>
          <DbProvider client={dbClient}>
            <OriginalWrap>{children}</OriginalWrap>
          </DbProvider>
        </OuterWrapper>
      )
    },
  }

  if (router.isServer) {
    const dbStream = createPushableStream<DehydratedDbState>()
    const bufferedQueryHashes = new Set<string>()
    const streamedQueryHashes = new Set<string>()
    let criticalStateCaptured = false
    let renderFinishRegistered = false

    const streamLiveQuery = (queryHash: string) => {
      if (streamedQueryHashes.has(queryHash)) return
      streamedQueryHashes.add(queryHash)

      const enqueued = dbStream.enqueue(
        dbClient.dehydrate({
          shouldDehydrateCollection: () => false,
          shouldDehydrateLiveQuery: (query) => query.queryHash === queryHash,
        }),
      )
      if (!enqueued) {
        console.warn(
          `Tried to stream live query ${queryHash} after the DB stream was closed.`,
        )
      }
    }

    const unsubscribe = dbClient.subscribe((event) => {
      if (event.type !== `liveQueryAdded`) return

      if (!criticalStateCaptured) {
        bufferedQueryHashes.add(event.query.queryHash)
        return
      }

      streamLiveQuery(event.query.queryHash)
    })

    router.options.dehydrate = async (): Promise<DehydratedRouterDbState> => {
      const originalDehydrated = await originalOptions.dehydrate?.()
      const dehydratedDbClient = dbClient.dehydrate({
        shouldDehydrateLiveQuery: () => true,
      })
      const criticalQueryHashes = new Set(
        dehydratedDbClient.liveQueries?.map((query) => query.queryHash),
      )
      criticalStateCaptured = true

      if (!renderFinishRegistered) {
        renderFinishRegistered = true
        router.serverSsr!.onRenderFinished(() => {
          unsubscribe()
          dbStream.close()
        })
      }

      for (const queryHash of bufferedQueryHashes) {
        if (!criticalQueryHashes.has(queryHash)) streamLiveQuery(queryHash)
      }
      bufferedQueryHashes.clear()

      return {
        ...originalDehydrated,
        dehydratedDbClient,
        dbStream: dbStream.stream,
      }
    }
  } else {
    router.options.hydrate = async (dehydrated: DehydratedRouterDbState) => {
      await originalOptions.hydrate?.(dehydrated)
      dbClient.hydrate(dehydrated.dehydratedDbClient)

      const reader = dehydrated.dbStream.getReader()
      void readDbStream(reader, dbClient)
        .catch((error) => console.error(`Error reading DB stream:`, error))
        .finally(() => {
          dbClient._setSsrStreamingEnabled(false)
        })
    }
  }

  return router
}

async function readDbStream(
  reader: ReadableStreamDefaultReader<DehydratedDbState>,
  dbClient: DbClient,
): Promise<void> {
  try {
    let entry = await reader.read()
    while (!entry.done) {
      dbClient.hydrate(entry.value)
      entry = await reader.read()
    }
  } catch (error) {
    dbClient._failPendingLiveQueries(error)
    throw error
  }
}

type PushableStream<T> = {
  stream: ReadableStream<T>
  enqueue: (chunk: T) => boolean
  close: () => void
  error: (error: unknown) => void
}

function createPushableStream<T>(): PushableStream<T> {
  let controllerRef!: ReadableStreamDefaultController<T>
  let state: `open` | `closed` | `errored` | `cancelled` = `open`
  const stream = new ReadableStream<T>({
    start(controller) {
      controllerRef = controller
    },
    cancel() {
      state = `cancelled`
    },
  })

  return {
    stream,
    enqueue: (chunk) => {
      if (state !== `open`) return false
      controllerRef.enqueue(chunk)
      return true
    },
    close: () => {
      if (state !== `open`) return
      state = `closed`
      controllerRef.close()
    },
    error: (error) => {
      if (state !== `open`) return
      state = `errored`
      controllerRef.error(error)
    },
  }
}
