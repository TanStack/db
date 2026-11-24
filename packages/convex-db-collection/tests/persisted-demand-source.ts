/** Actual Convex SDK pagination over a controlled, browser-safe WebSocket. */
import { createCollection } from '@tanstack/db'
import { ConvexClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { convexToJson } from 'convex/values'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { convexPaginatedCollectionOptions } from '../src'
import type { PaginationOptions, PaginationResult } from 'convex/server'
import type { Value } from 'convex/values'
import type {
  DemandReceivingFactory,
  DemandRow,
} from '../../db-adapter-conformance/tests/persisted-demand-receiving-types'

type QueryChange = {
  type: string
  queryId: number
  args?: Array<{ paginationOpts: PaginationOptions }>
}
type WireMessage = {
  type: string
  newVersion?: number
  modifications?: Array<QueryChange>
}
const timestamp = (value: number) => {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true)
  return btoa(String.fromCharCode(...bytes))
}
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export const convexPersistedDemandSource: DemandReceivingFactory = async (
  input,
) => {
  let socket: Socket | undefined
  let mode: `held` | `answered` | `rejected` = `held`
  let rows: ReadonlyArray<DemandRow> = []
  let version = 0
  let previousVersion = 0
  let revision = 0
  let requests = 0
  let queued = false
  let closed = false
  const pending = new Map<number, PaginationOptions>()
  // A live Convex query receives later revisions without reacquisition.
  // Keep the actual SDK's active query arguments after the first answer.
  const activeQueries = new Map<number, PaginationOptions>()
  const removals: Array<{ type: string; queryId: number }> = []
  const flush = () => {
    if (queued || closed) return
    queued = true
    queueMicrotask(() => {
      queued = false
      if (!socket || closed) return
      const modifications: Array<unknown> = removals.splice(0)
      if (mode !== `held`) {
        for (const [queryId, options] of pending) {
          pending.delete(queryId)
          if (mode === `rejected`) {
            modifications.push({
              type: `QueryFailed`,
              queryId,
              errorMessage: `offline demand`,
              errorData: null,
              logLines: [],
              journal: null,
            })
            continue
          }
          const start =
            options.cursor === null
              ? 0
              : Number(options.cursor.slice(`row:`.length))
          const end =
            options.endCursor == null
              ? Math.min(rows.length, start + options.numItems)
              : Number(options.endCursor.slice(`row:`.length))
          const page = rows.slice(start, end).map((row) => ({ ...row }))
          input.events.push({
            type: `rows`,
            rows: page.map(({ id, ...value }) => [id, value] as const),
          })
          modifications.push({
            type: `QueryUpdated`,
            queryId,
            value: convexToJson({
              page,
              isDone: end >= rows.length,
              continueCursor: `row:${end}`,
            } as unknown as Value),
            logLines: [],
            journal: null,
          })
        }
      }
      if (!modifications.length) return
      socket.onmessage?.({
        data: JSON.stringify({
          type: `Transition`,
          startVersion: {
            querySet: previousVersion,
            ts: timestamp(revision),
            identity: 0,
          },
          endVersion: {
            querySet: version,
            ts: timestamp(++revision),
            identity: 0,
          },
          modifications,
        }),
      })
      previousVersion = version
    })
  }
  class Socket {
    onopen: (() => void) | null = null
    onmessage: ((event: { data: string }) => void) | null = null
    onclose: ((event: { code: number; reason: string }) => void) | null = null
    onerror: (() => void) | null = null
    constructor(_url: string) {
      socket = this
      queueMicrotask(() => this.onopen?.())
    }
    send(data: string) {
      const message = JSON.parse(data) as WireMessage
      if (message.type !== `ModifyQuerySet`) return
      version = message.newVersion!
      for (const change of message.modifications ?? []) {
        if (change.type === `Add`) {
          requests++
          pending.set(change.queryId, change.args![0]!.paginationOpts)
          activeQueries.set(change.queryId, change.args![0]!.paginationOpts)
        } else {
          pending.delete(change.queryId)
          activeQueries.delete(change.queryId)
          removals.push({ type: `QueryRemoved`, queryId: change.queryId })
        }
      }
      flush()
    }
    close() {
      queueMicrotask(() => this.onclose?.({ code: 1000, reason: `` }))
    }
  }
  const client = new ConvexClient(`https://demand-oracle.convex.cloud`, {
    webSocketConstructor: Socket as unknown as typeof WebSocket,
    unsavedChangesWarning: false,
    logger: false,
  })
  const query = makeFunctionReference<
    `query`,
    { paginationOpts: PaginationOptions },
    PaginationResult<DemandRow>
  >(`rows:demand`)
  const options = convexPaginatedCollectionOptions({
    id: input.id,
    client,
    query,
    queryArgs: {},
    pageSize: 2,
    syncMode: `on-demand`,
    queryOrder: { field: `rank`, direction: `asc` },
    getKey: (row) => row.id,
  })
  const persisted = persistedCollectionOptions({
    ...options,
    sync: input.wrapSync(options.sync),
    persistence: input.persistence,
    initialRender: {
      strategy: `network-first`,
      networkTimeoutMs: input.waitMs,
    },
  })
  const collection = createCollection({
    ...persisted,
    sync: input.wrapPersistedSync(persisted.sync),
  })
  const barrier = async () => {
    // Wire transitions and real SDK callbacks are synchronous; task turns drain
    // pager continuations. Storage is drained separately by the common recorder.
    for (let index = 0; index < 4; index++) await turn()
  }
  return {
    collection,
    answer: async (next) => {
      rows = [...next].sort(
        (a, b) => a.rank - b.rank || a.id.localeCompare(b.id),
      )
      mode = `answered`
      for (const [queryId, queryOptions] of activeQueries)
        pending.set(queryId, queryOptions)
      flush()
      await barrier()
    },
    hold: async () => {
      mode = `held`
      await barrier()
    },
    reject: async () => {
      mode = `rejected`
      flush()
      await barrier()
    },
    requests: () => requests,
    barrier,
    dispose: async () => {
      closed = true
      await client.close()
    },
  }
}
