/** Receiving premise for lazy-paging-model-oracle.ts: a Convex query transition
 * installs all changed query caches before dispatching any listener. The pager
 * reads those caches to publish a coherent prefix. Real SDKs receive two legal
 * multi-query wire transitions; the shared row/publication model rejects a mix
 * of their authored revisions at every callback. This checks SDK scheduling,
 * not server cursor correctness, which the local-backend receiver supplies. */
import { Buffer } from 'node:buffer'
import { ConvexClient } from 'convex/browser'
import { ConvexReactClient } from 'convex/react'
import { makeFunctionReference } from 'convex/server'
import { expect, it } from 'vitest'
import {
  assertLazyPublications,
  expectedLazyRows,
} from './lazy-paging-model-oracle'
import { withTestCleanup } from './helpers'
import type { LazyRow } from './lazy-paging-model-oracle'
import type { PaginationOptions, PaginationResult } from 'convex/server'

type Outgoing = {
  type: string
  newVersion: number
  modifications: Array<{ type: string; queryId: number }>
}
class Socket {
  static instances: Array<Socket> = []
  sent: Array<Outgoing> = []
  onopen?: () => void
  onclose?: (event: { code: number; reason: string }) => void
  onmessage?: (event: { data: string }) => void
  constructor() {
    Socket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as Outgoing)
  }
  close() {
    queueMicrotask(() => this.onclose?.({ code: 1000, reason: `` }))
  }
  open() {
    this.onopen?.()
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
}
const timestamp = (value: number) => {
  const bytes = Buffer.alloc(8)
  bytes.writeBigUInt64LE(BigInt(value))
  return bytes.toString(`base64`)
}

it.each([`javascript`, `react`] as const)(
  `reads coherent range caches before every %s SDK callback`,
  async (kind) => {
    const options = {
      webSocketConstructor: Socket as unknown as typeof WebSocket,
      unsavedChangesWarning: false,
      logger: false as const,
    }
    const client =
      kind === `javascript`
        ? new ConvexClient(`https://test.convex.cloud`, options)
        : new ConvexReactClient(`https://test.convex.cloud`, options)
    const query = makeFunctionReference<
      `query`,
      { paginationOpts: PaginationOptions },
      PaginationResult<LazyRow>
    >(`tasks:list`)
    const handles: Array<{
      read: () => PaginationResult<LazyRow> | undefined
      release: () => void
    }> = []
    const trace: Array<Array<LazyRow>> = []
    const record = () =>
      trace.push(handles.flatMap((handle) => handle.read()?.page ?? []))
    await withTestCleanup(
      () => {
        for (const cursor of [null, `boundary`]) {
          const args = { paginationOpts: { cursor, numItems: 1 } }
          if (`onUpdate` in client) {
            const sub = client.onUpdate(query, args, record)
            handles.push({ read: () => sub.getCurrentValue(), release: sub })
          } else {
            const watch = client.watchQuery(query, args)
            handles.push({
              read: () => watch.localQueryResult(),
              release: watch.onUpdate(record),
            })
          }
        }
        const socket = Socket.instances.at(-1)!
        socket.open()
        const messages = socket.sent.filter(
          (message) => message.type === `ModifyQuerySet`,
        )
        const version = messages.at(-1)!.newVersion
        const adds = messages
          .flatMap((message) => message.modifications)
          .filter((item) => item.type === `Add`)
        expect(adds).toHaveLength(2)
        let prior: Array<LazyRow> = []
        for (let revision = 1; revision <= 2; revision++) {
          const authored = [0, 1].map((rank) => ({
            id: String(rank),
            rank,
            text: `revision ${revision}`,
          }))
          const start = trace.length
          socket.receive({
            type: `Transition`,
            startVersion: {
              querySet: revision === 1 ? 0 : version,
              ts: timestamp(revision - 1),
              identity: 0,
            },
            endVersion: {
              querySet: version,
              ts: timestamp(revision),
              identity: 0,
            },
            modifications: adds.map((item, index) => ({
              type: `QueryUpdated`,
              queryId: item.queryId,
              value: {
                page: [authored[index]],
                isDone: index === 1,
                continueCursor: `end-${index}`,
              },
              logLines: [],
              journal: null,
            })),
          })
          expect(trace.length).toBeGreaterThan(start)
          const expected = expectedLazyRows(authored, {})
          assertLazyPublications(trace.slice(start), prior, expected)
          expect(trace.at(-1)).toEqual(expected)
          prior = expected
        }
      },
      () => {
        for (const handle of handles) handle.release()
      },
      () => client.close(),
    )
  },
)
