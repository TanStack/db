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
 *   at once, as a server does, which drops the client's cached result.
 *
 * Rows are Convex values: `note` absent is a missing field, and typed fields
 * hold the Convex kinds (no Date, which Convex values do not have). The
 * driver never reads the Collection.
 */
import { createCollection } from '@tanstack/db'
import { ConvexClient } from 'convex/browser'
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

const rowsQuery = makeFunctionReference<
  `query`,
  Record<string, never>,
  Array<ConformanceRow>
>(`rows:list`)

/** The WebSocket the Convex client opens; the driver plays the server. */
class Socket {
  static latest: Socket | undefined
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null
  readonly sent: Array<Record<string, unknown>> = []
  onSend: ((message: Record<string, unknown>) => void) | undefined
  constructor(_url: string) {
    Socket.latest = this
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
  const bytes = Buffer.alloc(8)
  bytes.writeBigUInt64LE(BigInt(value))
  return bytes.toString(`base64`)
}

const turn = () => new Promise((resolve) => setTimeout(resolve, 0))

/** A result with two rows for one key: the adapter rejects it. */
const hasDuplicateKey = (rows: ReadonlyArray<ConformanceRow>) =>
  new Set(rows.map((row) => row.id)).size !== rows.length

class ConvexProvider implements ControlledProvider {
  readonly client: ConvexClient
  private readonly socket: Socket
  private readonly registrations: Array<{ releases: number }> = []
  private rows = new Map<number, ConformanceRow>()
  private time = 0
  private querySet = 0
  // The result the client holds, encoded; undefined after a failure.
  private sent: string | undefined

  constructor() {
    this.client = new ConvexClient(`https://conformance.convex.cloud`, {
      webSocketConstructor: Socket as unknown as typeof WebSocket,
      unsavedChangesWarning: false,
      logger: false,
    })
    this.socket = Socket.latest!
    this.socket.onopen?.()
    // A server acknowledges a removal promptly, which drops the client's
    // cached result for that query.
    this.socket.onSend = (message) => {
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
      queueMicrotask(() =>
        this.transition(
          modifications.map(({ queryId }) => ({
            type: `QueryRemoved`,
            queryId,
          })),
        ),
      )
    }
    // Count each `onUpdate` registration and the adapter's unsubscribe.
    const onUpdate = this.client.onUpdate.bind(this.client)
    this.client.onUpdate = ((...args: Parameters<typeof onUpdate>) => {
      const registration = { releases: 0 }
      this.registrations.push(registration)
      const subscription = onUpdate(...args)
      return Object.assign(
        () => {
          registration.releases++
          subscription()
        },
        { getCurrentValue: () => subscription.getCurrentValue() },
      )
    }) as typeof onUpdate
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
      modifications,
    })
    this.querySet = version
  }

  private sendResult(rows: ReadonlyArray<ConformanceRow>): void {
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

  fail = (error: Error) => this.sendFailure(error)

  deliveryError = (error: Error) => this.sendFailure(error)

  /** The client applies a transition and calls back within a few turns. */
  settle = async () => {
    for (let index = 0; index < 3; index++) await turn()
  }

  dispose = () => this.client.close()
}

let sequence = 0

export function convexConformanceDriver(): EagerLiveSourceDriver {
  return {
    adapter: `@tanstack/convex-db-collection (eager)`,
    capabilities: new Set([
      `complete-snapshot`,
      `delivery-error`,
      `duplicate-key-delivery`,
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
      const provider = new ConvexProvider()
      const collection = createCollection(
        convexCollectionOptions({
          id: `convex-conformance-${++sequence}`,
          client: provider.client,
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
        settle: provider.settle,
        dispose: provider.dispose,
      }
    },
  }
}
