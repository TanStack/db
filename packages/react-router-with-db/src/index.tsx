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
    let unsubscribe = () => {}

    router.options.dehydrate = async (): Promise<DehydratedRouterDbState> => {
      const originalDehydrated = await originalOptions.dehydrate?.()
      const dehydratedDbClient = dbClient.dehydrate({
        shouldDehydrateLiveQuery: () => true,
      })

      router.serverSsr!.onRenderFinished(() => {
        unsubscribe()
        dbStream.close()
      })

      return {
        ...originalDehydrated,
        dehydratedDbClient,
        dbStream: dbStream.stream,
      }
    }

    unsubscribe = dbClient.subscribe((event) => {
      if (!router.serverSsr!.isDehydrated()) {
        return
      }

      if (dbStream.isClosed()) {
        console.warn(
          `Tried to stream live query ${event.query.queryHash} after the DB stream was closed.`,
        )
        return
      }

      dbStream.enqueue(
        dbClient.dehydrate({
          shouldDehydrateCollection: () => false,
          shouldDehydrateLiveQuery: (query) =>
            query.queryHash === event.query.queryHash,
        }),
      )
    })
  } else {
    router.options.hydrate = async (dehydrated: DehydratedRouterDbState) => {
      await originalOptions.hydrate?.(dehydrated)
      dbClient.hydrate(dehydrated.dehydratedDbClient)

      const reader = dehydrated.dbStream.getReader()
      void readDbStream(reader, dbClient).finally(() => {
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
    console.error(`Error reading DB stream:`, error)
  }
}

type PushableStream<T> = {
  stream: ReadableStream<T>
  enqueue: (chunk: T) => void
  close: () => void
  isClosed: () => boolean
}

function createPushableStream<T>(): PushableStream<T> {
  let controllerRef!: ReadableStreamDefaultController<T>
  let closed = false
  const stream = new ReadableStream<T>({
    start(controller) {
      controllerRef = controller
    },
  })

  return {
    stream,
    enqueue: (chunk) => controllerRef.enqueue(chunk),
    close: () => {
      if (closed) {
        return
      }
      closed = true
      controllerRef.close()
    },
    isClosed: () => closed,
  }
}
