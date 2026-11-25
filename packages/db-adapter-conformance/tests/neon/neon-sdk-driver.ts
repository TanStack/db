/**
 * Installed Neon SDK receiving path. A controlled WebSocket speaks the public
 * v2 protocol; the real client validates frames, decodes PostgreSQL JSONB and
 * emits raw subscription updates. The shared eager oracle supplies all row,
 * lifecycle and health judgments. This fixture supplies no Collection answer.
 *
 * One JSONB column carries the generated row, so the receiver's public
 * projection removes that column wrapper. No database service, authorization,
 * transport reconnect, capability refresh or durable-storage claim follows.
 */
import { createRealtimeClient } from '@neon/realtime/client'
import { createCollection } from '@tanstack/db'
import { jsonValueKinds, observedView } from '../../src'
import { realtimeCollectionOptions } from './vendor/collection-options'
import type {
  RealtimeClient,
  SealedLiveQuery,
  WebSocketLike,
} from '@neon/realtime/client'
import type {
  ConformanceRow,
  ControlledProvider,
  EagerLiveSourceDriver,
  ProviderChange,
} from '../../src'

type WireRow = { row: ConformanceRow }
type Command = { type: string; request_id?: string; live_id?: string }
const key = (id: number) => id.toString(16).padStart(64, `0`)
export const neonSDKQuery = <Row>(
  queryFingerprint = `11`.repeat(32),
): SealedLiveQuery<Row> => ({
  capability: `${btoa(JSON.stringify({ alg: `dir`, enc: `A256GCM`, v: 2 }))
    .replaceAll(`=`, ``)
    .replaceAll(`+`, `-`)
    .replaceAll(`/`, `_`)}..a.b.c`,
  queryFingerprint,
  expiresAt: Date.now() + 3_000_000,
})

class ProtocolSocket implements WebSocketLike {
  readyState = 1
  readonly commands: Array<Command> = []
  private readonly listeners = new Map<
    string,
    Array<(event: { data: unknown }) => void>
  >()
  constructor(private readonly command: (command: Command) => void) {}
  addEventListener(type: string, listener: (event: { data: unknown }) => void) {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }
  send(data: string) {
    const command = JSON.parse(data) as Command
    this.commands.push(command)
    queueMicrotask(() => this.command(command))
  }
  close() {
    this.readyState = 3
  }
  deliver(message: object) {
    for (const listener of this.listeners.get(`message`) ?? [])
      listener({ data: JSON.stringify(message) })
  }
}

export class NeonSDKProvider implements ControlledProvider {
  readonly client: RealtimeClient
  /** Raw removal IDs decoded and delivered by the actual SDK, before adapter entry. */
  readonly receivedRemovals: Array<string> = []
  private socket?: ProtocolSocket
  private readonly records: Array<{
    liveId: string
    releases: number
    ready: boolean
    epoch: number
    sequence: number
    liveKeys: Set<string>
  }> = []
  private publication = 0
  private committedThrough = 0n
  clientCloseCalls = 0
  private readonly actual: RealtimeClient
  private readonly listeners: Array<{
    name: string
    syncRun: number
    releases: number
  }> = []

  constructor(
    columns: ReadonlyArray<{
      name: string
      type_oid: number
      typmod: number
      codec: string
    }> = [{ name: `row`, type_oid: 3802, typmod: -1, codec: `pg_text` }],
    private readonly ordered = false,
  ) {
    this.actual = createRealtimeClient({
      url: `ws://localhost/neon-oracle`,
      webSocketFactory: () => {
        const socket = new ProtocolSocket((command) => {
          if (command.type === `subscribe`) {
            const record = this.records.find((entry) => !entry.ready)!
            socket.deliver({
              type: `subscribed`,
              request_id: command.request_id,
              live_id: record.liveId,
              epoch: `1`,
              first_sequence: `1`,
              columns,
            })
            record.ready = true
          }
        })
        this.socket = socket
        queueMicrotask(() => socket.deliver({ type: `ready` }))
        return socket
      },
    })
    this.client = {
      subscribe: ((
        query: SealedLiveQuery<WireRow>,
        options: { materialize: false },
      ) => {
        const record = {
          liveId: String(this.records.length + 1),
          releases: 0,
          ready: false,
          epoch: 1,
          sequence: 1,
          liveKeys: new Set<string>(),
        }
        this.records.push(record)
        const subscription = this.actual.subscribe(query, options)
        const track =
          <T>(name: string, install: (listener: T) => () => void) =>
          (listener: T) => {
            const resource = { name, syncRun: this.records.length, releases: 0 }
            this.listeners.push(resource)
            const release = install(listener)
            return () => {
              resource.releases++
              release()
            }
          }
        return {
          getState: subscription.getState.bind(subscription),
          onUpdate: track(
            `update listener`,
            (listener: Parameters<typeof subscription.onUpdate>[0]) =>
              subscription.onUpdate((update) => {
                if (update.type === `changes`)
                  for (const change of update.changes)
                    if (change.type === `remove`)
                      this.receivedRemovals.push(change.rowId)
                listener(update)
              }),
          ),
          onStateChange: track(
            `state listener`,
            subscription.onStateChange.bind(subscription),
          ),
          awaitTxId: subscription.awaitTxId.bind(subscription),
          renew: subscription.renew.bind(subscription),
          unsubscribe: () => {
            record.releases++
            subscription.unsubscribe()
          },
        }
      }) as RealtimeClient[`subscribe`],
      close: () => {
        this.clientCloseCalls++
        this.actual.close()
      },
    }
  }
  releases = () => this.records.map((record) => record.releases)
  resources = () => [
    ...this.records.map((record, index) => ({
      name: `raw subscription`,
      syncRun: index + 1,
      releases: record.releases,
    })),
    ...this.listeners.map((resource) => ({ ...resource })),
  ]
  dispose = () => this.actual.close()
  private async current(index = this.records.length - 1) {
    // The transport's subscribe reply is queued independently of Collection
    // behavior. Waiting here establishes admission, never expected row truth.
    for (let turn = 0; turn < 20 && !this.records[index]?.ready; turn++)
      await new Promise((resolve) => setTimeout(resolve, 0))
    const record = this.records[index]
    if (!record?.ready || !this.socket)
      throw new Error(`Neon SDK did not admit the subscription`)
    return { record, socket: this.socket }
  }
  deliverSnapshot = async (
    rows: ReadonlyArray<ConformanceRow>,
    index?: number,
  ) => {
    await this.deliverWireRows(
      rows.map((row) => ({
        row_key: key(row.id),
        values: [JSON.stringify(row)],
      })),
      index,
    )
  }
  deliverWireRows = async (
    rows: ReadonlyArray<{
      row_key: string
      values: ReadonlyArray<string | null>
    }>,
    index?: number,
  ) => {
    const { record, socket } = await this.current(index)
    record.liveKeys.clear()
    for (const row of rows) record.liveKeys.add(row.row_key)
    if (record.sequence > 1) {
      const publication_id = `reset-${++this.publication}`
      socket.deliver({ type: `open`, publication_id })
      socket.deliver({
        type: `reset_required`,
        publication_id,
        index: 0,
        targets: [
          {
            live_id: record.liveId,
            epoch: String(++record.epoch),
            first_sequence: `1`,
          },
        ],
      })
      socket.deliver({
        type: `commit`,
        publication_id,
        body_count: 1,
        frontier: { lsn: `0/${this.publication.toString(16).toUpperCase()}` },
      })
    }
    record.sequence = 1
    const target = {
      live_id: record.liveId,
      epoch: String(record.epoch),
      baseline_sync_attempt: `1`,
    }
    socket.deliver({
      type: `baseline_sync_start`,
      ...target,
      // The fixture's backend commits changes in txid order. A later
      // baseline is taken after those commits; actual SDK MVCC processing
      // must supply their evidence to a newly opened raw subscription.
      mvcc: {
        xmin: String(this.committedThrough + 1n),
        xmax: String(this.committedThrough + 1n),
        xip: [],
      },
    })
    socket.deliver({ type: `baseline_sync_batch`, ...target, index: 0, rows })
    socket.deliver({ type: `baseline_sync_end`, ...target, batch_count: 1 })
    record.sequence++
  }
  deliverChanges = async (
    changes: ReadonlyArray<ProviderChange>,
    txid: string,
    index?: number,
  ) => {
    const { record, socket } = await this.current(index)
    this.committedThrough =
      BigInt(txid) > this.committedThrough
        ? BigInt(txid)
        : this.committedThrough
    for (const change of changes) {
      if (change.type === `upsert`) record.liveKeys.add(key(change.row.id))
      else record.liveKeys.delete(key(change.id))
    }
    // A legal ordered publication moves each final row once, after all
    // content changes. Ordering changes no keyed Collection membership.
    const rowKeys = [...record.liveKeys].sort()
    const moves = this.ordered
      ? rowKeys.map((row_key, moveIndex) => ({
          op: `move`,
          row_key,
          after_row_key: rowKeys[moveIndex - 1] ?? null,
        }))
      : []
    // The shared history describes one atomic final result. Ordered Neon wire
    // programs permit only one content operation per key, so encode its final
    // authored operation. Plain batches retain their legal sequential form.
    const contents = this.ordered
      ? [
          ...new Map(
            changes.map((change) => [
              change.type === `upsert` ? change.row.id : change.id,
              change,
            ]),
          ).values(),
        ]
      : changes
    const publication_id = `changes-${++this.publication}`
    socket.deliver({ type: `open`, publication_id })
    socket.deliver({
      type: `keyed_results`,
      publication_id,
      index: 0,
      txids: [txid],
      targets: [
        {
          live_id: record.liveId,
          epoch: String(record.epoch),
          sequence: String(record.sequence++ - 1),
        },
      ],
      changes: [
        ...contents.map((change) =>
          change.type === `upsert`
            ? {
                op: `upsert`,
                row_key: key(change.row.id),
                values: [JSON.stringify(change.row)],
              }
            : { op: `remove`, row_key: key(change.id) },
        ),
        ...moves,
      ],
    })
    socket.deliver({
      type: `commit`,
      publication_id,
      body_count: 1,
      frontier: { lsn: `0/${this.publication.toString(16).toUpperCase()}` },
    })
  }
  fail = async (error: Error) => {
    const { record, socket } = await this.current()
    socket.deliver({
      type: `subscription_error`,
      live_id: record.liveId,
      code: `protocol_error`,
      message: error.message,
    })
  }
}

export function neonSDKDriver(ordered = false): EagerLiveSourceDriver {
  return {
    adapter: `@neon/realtime-tanstack 0.1.1 / real @neon/realtime 0.2.0`,
    capabilities: new Set([
      `complete-snapshot`,
      `source-failure-after-ready`,
      `await-evidence`,
    ]),
    valueKinds: jsonValueKinds,
    changeCommits: `per-batch`,
    matchesFailure: (reported, failure) =>
      reported instanceof Error &&
      reported.message === `conformance provider failure ${failure}`,
    create() {
      const provider = new NeonSDKProvider(undefined, ordered)
      const collection = createCollection(
        realtimeCollectionOptions({
          id: `neon-sdk-conformance`,
          client: provider.client,
          query: neonSDKQuery<WireRow>(),
          getKey: (row: WireRow) => row.row.id,
        }),
      )
      return {
        collection: observedView(collection, {
          row: (value) => value.row,
          key: (value) => value as number,
        }),
        provider,
        awaitTxId: (txid, timeout) => collection.utils.awaitTxId(txid, timeout),
        dispose: provider.dispose,
      }
    },
  }
}
