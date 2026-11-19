/**
 * Production driver for the shared eager live-source conformance oracle
 * (`packages/db-adapter-conformance`). It runs the real Convex adapter in
 * eager mode over the real Convex JavaScript client, whose WebSocket the
 * driver controls, as `sdk.test.ts` does: the client's query set, cache,
 * decoding of Convex values, and subscriptions are real, and the driver
 * answers the sync protocol.
 *
 * The oracle's steps map onto Convex like this:
 *
 * - every delivery is the query's complete result, a `QueryUpdated` in one
 *   `Transition`. A change batch folds onto the provider's rows and sends the
 *   new result, so the adapter commits it as one batch (`per-batch`). A
 *   result equal to the one the client holds sends no update, as a server
 *   would; after an error or a rejected result, the valid result is a
 *   change. The driver declares `complete-snapshot`;
 * - a failure before ready is a `QueryFailed` for the query. After ready, a
 *   `QueryFailed` is a delivery error (`delivery-error`): Convex keeps the
 *   subscription and its next result clears it. Convex has no terminal source
 *   end after ready, so the driver does not declare
 *   `source-failure-after-ready`. The client creates each reported error from
 *   the failure's message, so `matchesFailure` names the value by the
 *   injected failure's index;
 * - a complete result with two rows for one key (`duplicate-key-delivery`)
 *   is rejected by the adapter: before ready it fails the first load, after
 *   it the adapter reports it and keeps the run (`rejectedDelivery:
 *   reported`, the law set's default `errorMapping`). A rejected result does
 *   not replace the provider's rows;
 * - a provider subscription is one `onUpdate` registration, and its release
 *   is the adapter's call to the returned unsubscribe (LIFE-2, LIFE-10),
 *   observed at the client boundary because the client may merge a removal
 *   with a later subscription on the wire. The driver acknowledges a removal
 *   at once, as a server does, which drops the client's cached result; after
 *   a failure it acknowledges it only with its next transition, so a restart
 *   can find the failed query's cached error.
 *
 * `awaitSync` is the adapter's wait for the query's current result
 * (`await-sync`).
 *
 * A prompt restart (`prompt-after-restart`) sends the new run's first
 * transition before the client's `setTimeout` replay of a cached result, as
 * a server answer that is already queued on the socket arrives first.
 *
 * Rows are Convex values: `note` absent is a missing field, and typed fields
 * hold the Convex kinds (no Date, which Convex values do not have). The
 * driver never reads the Collection.
 */
import { createCollection } from '@tanstack/db'
import { ConvexClient } from 'convex/browser'
import { ConvexReactClient } from 'convex/react'
import { makeFunctionReference } from 'convex/server'
import { convexToJson } from 'convex/values'
import { convexCollectionOptions } from '../src/index'
import { observedView } from '../../db-adapter-conformance/src'
import type { Value } from 'convex/values'
import type {
  ConformanceRow,
  ControlledProvider,
  EagerLiveSourceDriver,
  EagerLiveSourceFixture,
  ProviderChange,
  ValueKind,
} from '../../db-adapter-conformance/src'

/** The kinds Convex values hold; Convex has no Date. */
const VALUE_KINDS: ReadonlyArray<ValueKind> = [
  `string`,
  `integer`,
  `float`,
  `negative-zero`,
  `boolean`,
  `null`,
  `bigint`,
  `array`,
  `object`,
]

export const rowsQuery = makeFunctionReference<
  `query`,
  Record<string, never>,
  Array<ConformanceRow>
>(`rows:list`)

/** The WebSocket the Convex client opens; the driver plays the server. */
class Socket {
  /**
   * The provider that the next socket serves. The React client opens its
   * socket lazily, so a socket takes its provider when it is created.
   */
  static provider: { bindSocket: (socket: Socket) => void } | undefined
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null
  readonly sent: Array<Record<string, unknown>> = []
  onSend: ((message: Record<string, unknown>) => void) | undefined
  constructor(_url: string) {
    Socket.provider?.bindSocket(this)
    // The client sets its handlers after construction; then it connects.
    queueMicrotask(() => this.onopen?.())
  }
  send(data: string) {
    const message = JSON.parse(data) as Record<string, unknown>
    this.sent.push(message)
    this.onSend?.(message)
  }
  close() {
    queueMicrotask(() => this.onclose?.({ code: 1000, reason: `` }))
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
}

function timestamp(value: number): string {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true)
  return btoa(String.fromCharCode(...bytes))
}

const turn = () => new Promise((resolve) => setTimeout(resolve, 0))

/** A result with two rows for one key: the adapter rejects it. */
const hasDuplicateKey = (rows: ReadonlyArray<ConformanceRow>) =>
  new Set(rows.map((row) => row.id)).size !== rows.length

export class ConvexProvider implements ControlledProvider {
  readonly client: ConvexClient | ConvexReactClient
  private socketOrUndefined: Socket | undefined
  private readonly registrations: Array<{ releases: number }> = []
  private rows = new Map<number, ConformanceRow>()
  private time = 0
  private querySet = 0
  private ackLate = false
  private pendingAcks: Array<unknown> = []
  // The result the client holds, encoded; undefined after a failure.
  private sent: string | undefined

  constructor(kind: ClientKind) {
    Socket.provider = this
    const options = {
      webSocketConstructor: Socket as unknown as typeof WebSocket,
      unsavedChangesWarning: false,
      logger: false as const,
    }
    const url = `https://conformance.convex.cloud`
    this.client =
      kind === `react`
        ? new ConvexReactClient(url, options)
        : new ConvexClient(url, options)
    this.onSend = (message) => {
      const modifications = (message.modifications ?? []) as Array<{
        type: string
        queryId: number
      }>
      if (
        message.type !== `ModifyQuerySet` ||
        modifications.length === 0 ||
        modifications.some((modification) => modification.type !== `Remove`)
      ) {
        return
      }
      const removed = modifications.map(({ queryId }) => ({
        type: `QueryRemoved`,
        queryId,
      }))
      // While the client's result is a failure, the acknowledgement comes
      // with the next transition, so a restart can come first: the client
      // then holds the failed query's cached error. A server that re-runs
      // the query may now succeed; a cached result, valid or rejected, is
      // what it would send again.
      if (this.ackLate) this.pendingAcks.push(...removed)
      else queueMicrotask(() => this.transition(removed))
    }
    // Count each registration and the adapter's unsubscribe: `onUpdate`
    // for the JavaScript client, a watch's `onUpdate` for the React one.
    const counted = (unsubscribe: () => void) => {
      const registration = { releases: 0 }
      this.registrations.push(registration)
      return () => {
        registration.releases++
        unsubscribe()
      }
    }
    const client = this.client
    if (client instanceof ConvexClient) {
      const onUpdate = client.onUpdate.bind(client)
      client.onUpdate = ((...args: Parameters<typeof onUpdate>) => {
        const subscription = onUpdate(...args)
        const release = counted(subscription)
        // The handle keeps its own fields; only its release is counted.
        return Object.assign(release, subscription, { unsubscribe: release })
      }) as typeof onUpdate
    } else {
      const watchQuery = client.watchQuery.bind(client) as (
        ...args: Array<unknown>
      ) => ReturnType<ConvexReactClient[`watchQuery`]>
      client.watchQuery = ((...args: Array<unknown>) => {
        const watch = watchQuery(...args)
        const onUpdate = watch.onUpdate.bind(watch)
        watch.onUpdate = (callback: () => void) => counted(onUpdate(callback))
        return watch
      }) as typeof watchQuery
    }
  }

  private onSend: (message: Record<string, unknown>) => void = () => {}

  bindSocket(socket: Socket): void {
    this.socketOrUndefined = socket
    socket.onSend = (message) => this.onSend(message)
  }

  private get socket(): Socket {
    if (!this.socketOrUndefined) throw new Error(`the client has no socket`)
    return this.socketOrUndefined
  }

  /** The query the client subscribed most recently and has not removed. */
  private queryId(): number {
    const changes = this.socket.sent.filter(
      (message) => message.type === `ModifyQuerySet`,
    )
    const live = new Set<number>()
    for (const change of changes) {
      for (const modification of change.modifications as Array<{
        type: string
        queryId: number
      }>) {
        if (modification.type === `Add`) live.add(modification.queryId)
        else live.delete(modification.queryId)
      }
    }
    const id = [...live].at(-1)
    if (id === undefined) throw new Error(`the client holds no query`)
    return id
  }

  private transition(modifications: Array<unknown>): void {
    const changes = this.socket.sent.filter(
      (message) => message.type === `ModifyQuerySet`,
    )
    const version = (changes.at(-1)?.newVersion as number | undefined) ?? 0
    this.socket.receive({
      type: `Transition`,
      startVersion: {
        querySet: this.querySet,
        ts: timestamp(this.time),
        identity: 0,
      },
      endVersion: {
        querySet: version,
        ts: timestamp(++this.time),
        identity: 0,
      },
      modifications: [...this.pendingAcks.splice(0), ...modifications],
    })
    this.querySet = version
  }

  private sendResult(rows: ReadonlyArray<ConformanceRow>): void {
    this.ackLate = false
    this.sent = JSON.stringify(convexToJson(rows as unknown as Value))
    this.transition([
      {
        type: `QueryUpdated`,
        queryId: this.queryId(),
        value: convexToJson(rows as unknown as Value),
        logLines: [],
        journal: null,
      },
    ])
  }

  private sendFailure(error: Error): void {
    this.sent = undefined
    this.transition([
      {
        type: `QueryFailed`,
        queryId: this.queryId(),
        errorMessage: error.message,
        errorData: null,
        logLines: [],
        journal: null,
      },
    ])
  }

  releases = () =>
    this.registrations.map((registration) => registration.releases)

  deliverSnapshot = (rows: ReadonlyArray<ConformanceRow>) => {
    if (!hasDuplicateKey(rows)) this.rows = new Map(rows.map((r) => [r.id, r]))
    this.sendResult(rows)
  }

  deliverChanges = (changes: ReadonlyArray<ProviderChange>) => {
    for (const change of changes) {
      if (change.type === `upsert`) this.rows.set(change.row.id, change.row)
      else this.rows.delete(change.id)
    }
    const result = [...this.rows.values()].sort((a, b) => a.id - b.id)
    // A result equal to the one the client holds sends nothing.
    if (
      JSON.stringify(convexToJson(result as unknown as Value)) === this.sent
    ) {
      this.transition([])
      return
    }
    this.sendResult(result)
  }

  fail = (error: Error) => {
    this.ackLate = true
    this.sendFailure(error)
  }

  deliveryError = (error: Error) => this.sendFailure(error)

  /** The client applies a transition and calls back within a few turns. */
  settle = async () => {
    for (let index = 0; index < 3; index++) await turn()
  }

  dispose = () => this.client.close()
}

let sequence = 0

type ClientKind = `javascript` | `react` | `wrapped`

/**
 * `client` selects the Convex JavaScript client, the React client, or a
 * wrapper that exposes only the JavaScript client's `onUpdate`, as an app's
 * proxy may. Without the client's log accessor the adapter skips one
 * replayed error, so a prompt restart's failure can still be lost there:
 * the wrapper does not declare `prompt-after-restart`.
 */
export function convexConformanceDriver({
  client = `javascript`,
}: { client?: ClientKind } = {}): EagerLiveSourceDriver {
  return {
    adapter: `@tanstack/convex-db-collection (eager, ${client} client)`,
    capabilities: new Set([
      `complete-snapshot`,
      `delivery-error`,
      `duplicate-key-delivery`,
      `await-sync`,
      ...(client === `wrapped` ? [] : [`prompt-after-restart` as const]),
    ]),
    changeCommits: `per-batch`,
    duplicateInsert: `error`,
    rejectedDelivery: `reported`,
    // The client creates each error from the failure's message, which ends
    // with the injected failure's index.
    matchesFailure: (reported, failure) =>
      reported instanceof Error &&
      new RegExp(`(failure|error) ${failure}\\b`).test(reported.message),
    valueKinds: VALUE_KINDS,
    fieldKinds: VALUE_KINDS,
    create(): EagerLiveSourceFixture {
      const provider = new ConvexProvider(client)
      const collection = createCollection(
        convexCollectionOptions({
          id: `convex-conformance-${++sequence}`,
          client:
            client === `wrapped` && provider.client instanceof ConvexClient
              ? { onUpdate: provider.client.onUpdate.bind(provider.client) }
              : provider.client,
          query: rowsQuery,
          queryArgs: {},
          getKey: (row) => row.id,
        }),
      )
      return {
        collection: observedView(collection, {
          row: (row) => row,
          key: (key) => key as number,
        }),
        provider,
        awaitSync: () => collection.utils.awaitSync(),
        settle: provider.settle,
        dispose: provider.dispose,
      }
    },
  }
}
