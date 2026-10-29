/**
 * Production driver for the Neon Realtime adapter (`@neon/realtime-tanstack`).
 *
 * The adapter source is vendored unchanged in `vendor/` from
 * `neondatabase/neon-pkgs` at commit 7ac55e3e7b9e491cc53fa6225bab29d700b729e2
 * (package version 0.1.1, Apache-2.0). It runs against this workspace's
 * TanStack DB and the published `@neon/realtime` client, so the refresh
 * controller is Neon's own.
 *
 * The provider is a controlled raw live-query subscription, in the shape of
 * the `RawLiveQuerySubscription` interface that the adapter consumes. It maps
 * the oracle's steps onto Neon's events:
 *
 * - a complete delivery is a `rows` update, with row ID `r<id>`;
 * - a change batch is a `changes` update that carries one txid;
 * - a provider failure is an `error` state, which also rejects pending txid
 *   waits, as the interface documents;
 * - a transport drop is a `connecting` state and its return is `live`;
 * - renewal: the initial capability expires 10 s after creation, so Neon's
 *   refresh controller asks for a replacement at once. The driver holds that
 *   request until `completeRenewal`, then waits for `renew` on the open
 *   subscription.
 *
 * A real client catches an exception thrown by an update or state listener.
 * The controlled subscription does the same and records it, so the oracle
 * judges the Collection's public state after such an exception.
 */
import { createCollection } from '@tanstack/db'
import { fromSqlRow, jsonValueKinds, observedView, toSqlRow } from '../../src'
import { realtimeCollectionOptions } from './vendor/collection-options'
import type {
  LiveQueryChange,
  LiveQueryState,
  RawLiveQueryOptions,
  RawLiveQueryRow,
  RawLiveQuerySubscription,
  RawLiveQueryUpdate,
  RealtimeClient,
  SealedLiveQuery,
} from '@neon/realtime/client'
import type {
  ConformanceRow,
  ControlledProvider,
  EagerLiveSourceDriver,
  EagerLiveSourceFixture,
  ProviderChange,
} from '../../src'

/** A Neon row is a Postgres row, so an absent `note` is `NULL`. */
type NeonRow = ReturnType<typeof toSqlRow>

class ControlledRawSubscription implements RawLiveQuerySubscription<NeonRow> {
  readonly renewals: Array<SealedLiveQuery<NeonRow>> = []
  readonly listenerErrors: Array<unknown> = []
  unsubscribed = false
  unsubscribes = 0
  private state: LiveQueryState = { status: `connecting`, error: undefined }
  private readonly updates = new Set<
    (update: RawLiveQueryUpdate<NeonRow>) => void
  >()
  private readonly states = new Set<(state: LiveQueryState) => void>()
  private readonly applied = new Set<string>()
  private readonly waits = new Map<
    string,
    Array<{ resolve: () => void; reject: (error: Error) => void }>
  >()

  getState = (): LiveQueryState => this.state

  onUpdate = (listener: (update: RawLiveQueryUpdate<NeonRow>) => void) => {
    this.updates.add(listener)
    return () => this.updates.delete(listener)
  }

  onStateChange = (listener: (state: LiveQueryState) => void) => {
    this.states.add(listener)
    return () => this.states.delete(listener)
  }

  // As the interface documents: a timeout rejects a wait that has no evidence.
  awaitTxId = (txid: string, timeout?: number): Promise<void> => {
    if (this.applied.has(txid)) return Promise.resolve()
    if (this.unsubscribed) {
      return Promise.reject(new Error(`Live-query subscription is closed`))
    }
    return new Promise((resolve, reject) => {
      const list = this.waits.get(txid) ?? []
      const wait = { resolve, reject }
      list.push(wait)
      this.waits.set(txid, list)
      if (timeout !== undefined) {
        setTimeout(() => {
          const index = list.indexOf(wait)
          if (index === -1) return
          list.splice(index, 1)
          reject(
            new Error(`Timed out waiting for live-query transaction ${txid}`),
          )
        }, timeout)
      }
    })
  }

  renew = (query: SealedLiveQuery<NeonRow>): Promise<void> => {
    this.renewals.push(query)
    return Promise.resolve()
  }

  unsubscribe = (): void => {
    this.unsubscribes += 1
    this.unsubscribed = true
    this.state = { status: `closed`, error: undefined }
    this.rejectWaits(new Error(`Live-query subscription is closed`))
  }

  deliver(
    update: RawLiveQueryUpdate<NeonRow>,
    txids: ReadonlyArray<string> = [],
  ) {
    for (const listener of this.updates) this.call(() => listener(update))
    for (const txid of txids) {
      this.applied.add(txid)
      for (const wait of this.waits.get(txid) ?? []) wait.resolve()
      this.waits.delete(txid)
    }
  }

  setState(state: LiveQueryState) {
    this.state = state
    for (const listener of this.states) this.call(() => listener(state))
    if (state.status === `error`) this.rejectWaits(state.error)
  }

  private call(run: () => void) {
    try {
      run()
    } catch (error) {
      this.listenerErrors.push(error)
    }
  }

  private rejectWaits(error: Error) {
    for (const list of this.waits.values()) {
      for (const wait of list) wait.reject(error)
    }
    this.waits.clear()
  }
}

function sealed(expiresInMs: number): SealedLiveQuery<NeonRow> {
  const header = Buffer.from(
    JSON.stringify({ alg: `dir`, enc: `A256GCM`, v: 1 }),
  ).toString(`base64url`)
  return {
    capability: `${header}..a.${Buffer.from(`conformance`).toString(`base64url`)}.c`,
    queryFingerprint: `11`.repeat(32),
    expiresAt: Date.now() + expiresInMs,
  }
}

function rawRow(row: ConformanceRow): RawLiveQueryRow<NeonRow> {
  return { rowId: `r${row.id}`, row: toSqlRow(row) }
}

function rawChange(change: ProviderChange): LiveQueryChange<NeonRow> {
  return change.type === `upsert`
    ? { type: `upsert`, rowId: `r${change.row.id}`, row: toSqlRow(change.row) }
    : { type: `remove`, rowId: `r${change.id}` }
}

class NeonProvider implements ControlledProvider {
  readonly subscriptions: Array<ControlledRawSubscription> = []
  private pendingRefresh:
    ((query: SealedLiveQuery<NeonRow>) => void) | undefined

  readonly client: RealtimeClient = {
    subscribe: ((
      _query: SealedLiveQuery<NeonRow>,
      options?: RawLiveQueryOptions,
    ) => {
      if (options?.materialize !== false) {
        throw new Error(
          `the Neon adapter is expected to open a raw subscription`,
        )
      }
      const subscription = new ControlledRawSubscription()
      this.subscriptions.push(subscription)
      return subscription
    }) as unknown as RealtimeClient[`subscribe`],
    close: () => {},
  }

  refreshQuery = () =>
    new Promise<SealedLiveQuery<NeonRow>>((resolve) => {
      this.pendingRefresh = resolve
    })

  private latest(): ControlledRawSubscription {
    const subscription = this.subscriptions.at(-1)
    if (!subscription) throw new Error(`no provider subscription`)
    return subscription
  }

  listenerErrors = () => this.subscriptions.flatMap((s) => s.listenerErrors)
  releases = () => this.subscriptions.map((s) => s.unsubscribes)
  deliverSnapshot = (rows: ReadonlyArray<ConformanceRow>) => {
    this.latest().setState({ status: `live`, error: undefined })
    this.latest().deliver({ type: `rows`, rows: rows.map(rawRow) })
  }
  deliverChanges = (changes: ReadonlyArray<ProviderChange>, txid: string) =>
    this.latest().deliver(
      {
        type: `changes`,
        changes: changes.map(rawChange),
        batch: { txids: [txid] },
      },
      [txid],
    )
  // Neon's error state carries a code and a retry flag. They are added to
  // the oracle's failure value itself, so its identity is kept.
  fail = (error: Error) =>
    this.latest().setState({
      status: `error`,
      error: Object.assign(error, {
        code: `CONFORMANCE_FAILURE`,
        retryable: false,
      }),
    })
  disconnect = () =>
    this.latest().setState({ status: `connecting`, error: undefined })
  reconnect = () => this.latest().setState({ status: `live`, error: undefined })
  completeRenewal = async () => {
    for (let turn = 0; turn < 20 && !this.pendingRefresh; turn++) {
      await new Promise((settle) => setTimeout(settle, 0))
    }
    const resolve = this.pendingRefresh
    if (!resolve)
      throw new Error(`the adapter did not request a replacement capability`)
    this.pendingRefresh = undefined
    const subscription = this.latest()
    const before = subscription.renewals.length
    resolve(sealed(3_000_000))
    for (
      let turn = 0;
      turn < 20 && subscription.renewals.length === before;
      turn++
    ) {
      await new Promise((settle) => setTimeout(settle, 0))
    }
  }
  renewals = () => this.subscriptions.at(-1)?.renewals.length ?? 0
}

export function neonRealtimeDriver(): EagerLiveSourceDriver {
  return {
    adapter: `@neon/realtime-tanstack 0.1.1`,
    changeCommits: `per-batch`,
    valueKinds: jsonValueKinds,
    capabilities: new Set([
      `complete-snapshot`,
      `await-evidence`,
      `transport-reconnect`,
      `capability-renewal`,
    ]),
    create(): EagerLiveSourceFixture {
      const provider = new NeonProvider()
      const collection = createCollection(
        realtimeCollectionOptions({
          id: `neon-conformance`,
          client: provider.client,
          // Expires within Neon's 10 s refresh lead, so a renewal is due at once.
          query: sealed(10_000),
          refreshQuery: provider.refreshQuery,
          getKey: (row: NeonRow) => row.id,
        }),
      )
      return {
        collection: observedView(collection, {
          row: fromSqlRow,
          key: (key) => key as number,
        }),
        provider,
        awaitTxId: (txid, timeout) => collection.utils.awaitTxId(txid, timeout),
      }
    },
  }
}
