import {
  DbClient,
  collectionOptions,
  eq,
  getStableValueHash,
} from '@tanstack/db'
import { Suspense, useLayoutEffect } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { createDeferred } from '../../db/src/deferred'
import { DbProvider } from '../src/DbProvider'
import { useLiveQuery } from '../src/useLiveQuery'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import type { StartupHistory, StartupTrace } from './suspense-startup-oracle'
import type { DehydratedLiveQueryResult } from '../../db/src/client'

// Both hosts run the public hooks. An inventory owns the source before the
// detail mounts. Its load is not the detail's acquisition, which the driver
// can hold even when the selected row is already locally visible.
export async function observeSuspenseStartup(
  history: StartupHistory,
): Promise<StartupTrace> {
  const commits: Array<string> = []
  const acquired = createDeferred<void>()
  const committed = createDeferred<void>()
  const result = history.pendingResult
    ? createDeferred<DehydratedLiveQueryResult>()
    : undefined
  const queryKey = result ? [`startup-detail`] : undefined
  let detail = false
  let acquiredDetail = false
  const client = new DbClient()
  const source = client.collection(
    collectionOptions({
      id: `startup-rows`,
      getKey: (row: { id: number }) => row.id,
      startSync: true,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const id of history.rows)
            write({ type: `insert`, value: { id } })
          commit()
          markReady()
          return {
            loadSubset: () => {
              if (!detail) return true
              acquiredDetail = true
              return history.held ? acquired.promise : true
            },
          }
        },
      },
    }),
  )

  function Inventory() {
    useLiveQuery((q) => q.from({ row: source }))
    return null
  }
  function Detail() {
    const { data } = useLiveSuspenseQuery({
      client: history.scope === `explicit` ? client : undefined,
      queryKey,
      query: (q) =>
        q
          .from({ row: source })
          .where(({ row }) => eq(row.id, history.selected))
          .findOne(),
    })
    const view = data ? `row:${data.id}` : `empty`
    useLayoutEffect(() => {
      commits.push(view)
      committed.resolve()
    }, [view])
    return <output>{view}</output>
  }
  function Fallback() {
    useLayoutEffect(() => {
      commits.push(`fallback`)
    }, [])
    return <p>Pending</p>
  }
  function App({ selected }: { selected: boolean }) {
    const children = (
      <>
        <Inventory />
        {selected && (
          <Suspense fallback={<Fallback />}>
            <Detail />
          </Suspense>
        )}
      </>
    )
    return history.scope === `provider` ? (
      <DbProvider client={client}>{children}</DbProvider>
    ) : (
      children
    )
  }

  const container = document.createElement(`div`)
  document.body.appendChild(container)
  const root = createRoot(container, {
    onUncaughtError(error) {
      commits.push(`error:${String(error)}`)
      committed.resolve()
    },
  })
  try {
    flushSync(() => root.render(<App selected={false} />))
    if (history.unrelatedStream) {
      client._setSsrStreamingEnabled(true)
      client.hydrate({
        collections: [],
        liveQueries: [
          {
            queryHash: `unrelated-route`,
            dehydratedAt: 1,
            snapshot: { rows: [] },
          },
        ],
      })
    }
    if (result) {
      client.hydrate({
        collections: [],
        liveQueries: [
          {
            queryHash: getStableValueHash([`queryKey`, queryKey], `queryKey`),
            dehydratedAt: 1,
            promise: result.promise,
          },
        ],
      })
    }
    detail = true
    flushSync(() => root.render(<App selected />))
    const initial = commits.slice()
    await Promise.resolve()
    const acquiredBeforeRelease = acquiredDetail
    if (result) {
      const id = history.selected
      result.resolve({
        rows: history.rows.includes(id) ? [{ key: id, value: { id } }] : [],
      })
    }
    acquired.resolve()
    await committed.promise
    return { initial, commits, acquiredBeforeRelease }
  } finally {
    root.unmount()
    container.remove()
    await client.cleanup()
  }
}
