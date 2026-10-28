import * as React from 'react'
import {
  Scripts,
  createMemoryHistory,
  createRootRouteWithContext,
  createRouter,
} from '@tanstack/react-router'
import {
  DbClient,
  Query,
  collectionOptions,
  useLiveQuery,
  useLiveSuspenseQuery,
} from '@tanstack/react-db'
import { routerWithDbClient } from '@tanstack/react-router-with-db'
import type {
  SsrStreamHistory,
  SsrStreamReaderView,
} from '../../../../../packages/db/tests/ssr-stream-view-oracle'

export type HostHistory = SsrStreamHistory & {
  browserPreload?: boolean
  discovery: `shell` | `boundary`
  delivery: `normal` | `held`
  transport: `owned` | `empty-close` | `empty-error` | `pending-close`
}
export type HostObservation = {
  type: string
  reader?: string
  view?: SsrStreamReaderView
  inRender?: boolean
  pending?: boolean
  message?: string
  version?: number
  at: number
}
declare global {
  interface Window {
    streamViews?: Array<HostObservation>
    streamFixture: {
      client: DbClient
      prepareBrowser: () => Promise<number | undefined>
      prepareBrowserSource: () => Promise<void>
    }
  }
}

/**
 * This fixture supplies host scheduling to the shared per-reader law. Server
 * and browser sources differ by authored input. Observations come from actual
 * hook returns; DB records never compute either side of the expected equality.
 */
export function makeFixture(
  runtime: `server` | `browser`,
  history: HostHistory,
  observe: (observation: HostObservation) => void,
  release: Promise<void> = Promise.resolve(),
) {
  let renderDepth = 0
  let gateReady = false
  let gate: Promise<void> | undefined
  const now = () =>
    typeof window === `undefined` ? Date.now() : performance.now()
  const client = new DbClient({ runtime })
  const source = collectionOptions(`router-stream-view`, () => ({
    id: `router-stream-view`,
    getKey: (row: { id: string; name: string }) => row.id,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        observe({ type: `source-start`, inRender: renderDepth > 0, at: now() })
        const publish = () => {
          begin()
          for (let index = 0; index < history.count; index++) {
            write({
              type: `insert`,
              value: {
                id: String(index),
                name: `${runtime === `server` || !history.browserWrite ? `server` : `browser`} ${index}`,
              },
            })
          }
          commit()
          markReady()
        }
        if (runtime === `server` && history.transport === `pending-close`) {
          void release.then(publish)
        } else publish()
      },
    },
  }))
  const query = new Query()
    .from({ row: source })
    .select(({ row }) => ({ name: row.name }))
  const record = (reader: string, view: SsrStreamReaderView) => {
    observe({ type: `view`, reader, view, at: now() })
    return (
      <output data-reader={reader} data-status={view.status}>
        {view.names.join(`,`)}
      </output>
    )
  }
  function Ordinary() {
    observe({ type: `attempt`, reader: `ordinary`, at: now() })
    renderDepth++
    try {
      const result = useLiveQuery({ query })
      return record(`ordinary`, {
        status: result.status,
        names: result.data.map((row) => row.name),
      })
    } finally {
      renderDepth--
    }
  }
  function SuspenseReader() {
    observe({ type: `attempt`, reader: `suspense`, at: now() })
    renderDepth++
    try {
      const result = useLiveSuspenseQuery({ query })
      return record(`suspense`, {
        status: `ready`,
        names: result.data.map((row) => row.name),
      })
    } finally {
      renderDepth--
    }
  }
  function Readers() {
    return (
      <>
        {history.ordinaryFirst && <Ordinary />}
        <SuspenseReader />
        {history.ordinaryLast && <Ordinary />}
      </>
    )
  }
  function Gate() {
    if (
      runtime === `server` &&
      history.discovery === `boundary` &&
      !gateReady
    ) {
      gate ??= new Promise<void>((resolve) =>
        setTimeout(() => {
          gateReady = true
          resolve()
        }, 150),
      )
      throw gate
    }
    return <Readers />
  }
  class FailureBoundary extends React.Component<
    { children: React.ReactNode },
    { failed: boolean }
  > {
    state = { failed: false }
    static getDerivedStateFromError() {
      return { failed: true }
    }
    componentDidCatch(error: unknown) {
      observe({ type: `boundary-error`, message: String(error), at: now() })
    }
    render() {
      return this.state.failed ? (
        <b data-stream-error>stream failed</b>
      ) : (
        this.props.children
      )
    }
  }
  function Document() {
    return (
      <html>
        <head>
          <title>Router stream view</title>
        </head>
        <body>
          <FailureBoundary>
            <React.Suspense fallback={<i data-stream-fallback>waiting</i>}>
              <Gate />
            </React.Suspense>
          </FailureBoundary>
          <Scripts />
        </body>
      </html>
    )
  }
  const routeTree = createRootRouteWithContext<{ dbClient: DbClient }>()({
    component: Document,
  })
  const router = createRouter({
    routeTree,
    context: { dbClient: client },
    ...(runtime === `server`
      ? {
          history: createMemoryHistory({ initialEntries: [`/`] }),
          isServer: true,
        }
      : {}),
  })
  if (runtime === `browser`) {
    const setStreaming = client._setSsrStreamingEnabled.bind(client)
    client._setSsrStreamingEnabled = (enabled) => {
      setStreaming(enabled)
      if (!enabled) observe({ type: `stream-ended`, at: now() })
    }
    const hydrate = client.hydrate.bind(client)
    client.hydrate = (state) => {
      observe({
        type: `db-hydrate`,
        version: state.liveQueries?.[0]?.dehydratedAt,
        pending: state.liveQueries?.some((transported) =>
          Boolean(transported.promise && !transported.snapshot),
        ),
        at: now(),
      })
      for (const transported of state.liveQueries ?? []) {
        void transported.promise?.then(
          () => observe({ type: `result-settled`, at: now() }),
          (error) =>
            observe({
              type: `result-rejected`,
              message: String(error),
              at: now(),
            }),
        )
      }
      hydrate(state)
    }
  }
  return {
    client,
    router: routerWithDbClient(router, client),
    async prepareBrowser() {
      observe({ type: `preload-start`, at: now() })
      try {
        await client.preloadLiveQuery({ query })
        const version = client.dehydrate({
          shouldDehydrateCollection: () => false,
        }).liveQueries?.[0]?.dehydratedAt
        observe({ type: `preload-settled`, version, at: now() })
        return version
      } catch (error) {
        observe({ type: `preload-rejected`, message: String(error), at: now() })
        throw error
      }
    },
    async prepareBrowserSource() {
      await client.collection(source).preload()
    },
    async prepareServer() {
      if (history.ordinaryFirst || history.ordinaryLast)
        await client.collection(source).preload()
    },
  }
}
