/**
 * Production driver for the shared mutation oracle
 * (`packages/db-adapter-conformance/src/mutation-oracle.ts`). It runs the real
 * Electric adapter in eager mode over the installed `@electric-sql/client`
 * `ShapeStream`, which fetches through a controlled `fetchClient` that
 * answers the Electric HTTP protocol, as `conformance-driver.ts` does.
 *
 * Electric does not persist writes: the application's handlers do, through
 * its own backend API, and confirm each through the shape stream with the
 * adapter's `awaitTxId`. The driver supplies such an application:
 *
 * - the provider is the backend and its Postgres table. Its API takes a
 *   write request, answers by plan, and on acceptance commits it in a new
 *   transaction and answers with that txid;
 * - each handler sends the complete row as a SQL row (an absent `note` is
 *   `NULL`, `undefinedField: 'null'`), then awaits `awaitTxId(txid)`. The
 *   adapter does not order the handlers (`application-handlers`), so each
 *   write's request goes out when it is made;
 * - each commit reaches the shape log as one batch: its change messages,
 *   carrying its txid, and `up-to-date`. An update carries the primary key
 *   and the changed columns, as in Electric's default replica mode. The log
 *   is in commit order (`log-ordered-echoes`); a held echo stalls it at that
 *   commit until `deliver` (`held-echoes`);
 * - a rewrite (`server-rewrites`) is the backend storing a changed row, as a
 *   trigger or column default does; its message carries the stored row;
 * - a commit by another client is a backend transaction that is not the
 *   application's.
 *
 * The application inserts an absent `note` as `null` and removes a held one
 * by assigning `undefined`, the update API's removed field. Limits: one sync
 * run; no reconnect or must-refetch while a write waits; `awaitMatch` is not
 * exercised.
 */
import { createCollection } from '@tanstack/db'
import { electricCollectionOptions } from '../src/electric'
import {
  acceptAtOnce,
  fromSqlRow,
  observedView,
  rewriteRow,
  settleWhenQuiet,
  toSqlRow,
} from '../../db-adapter-conformance/src'
import type {
  ConformanceRow,
  MutationDriver,
  MutationFixture,
  MutationProvider,
  ProviderChange,
  SettleCut,
  WritePlan,
  WriteRequest,
} from '../../db-adapter-conformance/src'

const SCHEMA = JSON.stringify({
  id: { type: `int4`, pk_index: 0 },
  title: { type: `text` },
  note: { type: `text` },
})

type ElectricRow = { id: number; title: string | null; note: string | null }
type Wire = Record<string, string | null>
type Batch = Array<Record<string, unknown>>

/** A row as Electric sends it: every column as text, `NULL` as null. */
function wire(row: ConformanceRow): Wire {
  const sql = toSqlRow(row)
  return { id: String(sql.id), title: sql.title, note: sql.note }
}

type Request = {
  url: URL
  respond: (response: Response) => void
}

class ElectricMutationProvider implements MutationProvider {
  /** The backend's table. */
  private readonly table = new Map<number, ConformanceRow>()
  private readonly plans: Array<WritePlan> = []
  private readonly held: Array<() => void> = []
  private readonly log: Array<WriteRequest> = []
  /** Committed batches the shape log has not sent, in commit order. */
  private readonly outbox: Array<Batch> = []
  /** Batches the log holds at a held echo; `own` marks the holding one. */
  private readonly stalled: Array<{ batch: Batch; own: boolean }> = []
  private waiting: Request | undefined
  private txid = 100
  private offset = 0
  /** Cleanup aborted the client's request: nothing more will arrive. */
  private closed = false

  constructor(seed: ReadonlyArray<ConformanceRow>) {
    for (const row of seed) this.table.set(row.id, row)
  }

  // The shape stream's side.

  readonly fetchClient: typeof fetch = (input, init) =>
    new Promise<Response>((resolve, reject) => {
      const url = new URL(String(input))
      const signal = init?.signal ?? undefined
      const request: Request = { url, respond: resolve }
      signal?.addEventListener(
        `abort`,
        () => {
          if (this.waiting === request) this.waiting = undefined
          this.closed = true
          reject(
            signal.reason ?? new DOMException(`request aborted`, `AbortError`),
          )
        },
        { once: true },
      )
      if (url.searchParams.get(`offset`) === `-1`) {
        this.respond(request, [
          ...[...this.table.values()].map((row) => ({
            key: String(row.id),
            value: wire(row),
            headers: { operation: `insert` },
          })),
        ])
        return
      }
      this.waiting = request
      this.flush()
    })

  private respond(request: Request, messages: Batch): void {
    this.offset++
    request.respond(
      new Response(
        JSON.stringify([
          ...messages,
          {
            headers: {
              control: `up-to-date`,
              global_last_seen_lsn: String(this.offset),
            },
          },
        ]),
        {
          headers: {
            'electric-handle': `mutations`,
            'electric-offset': `${this.offset}_0`,
            'electric-cursor': String(this.offset),
            'electric-schema': SCHEMA,
            'electric-up-to-date': `true`,
          },
        },
      ),
    )
  }

  /** Sends the next unsent batch to the client's waiting live request. */
  private flush(): void {
    const request = this.waiting
    if (!request || this.outbox.length === 0) return
    this.waiting = undefined
    this.respond(request, this.outbox.shift()!)
  }

  /** Commits a change in a new transaction and queues its batch. */
  private commit(change: ProviderChange, holdEcho: boolean): number {
    const txid = ++this.txid
    let message: Record<string, unknown> | undefined
    if (change.type === `delete`) {
      if (this.table.delete(change.id))
        message = {
          key: String(change.id),
          value: { id: String(change.id) },
          headers: { operation: `delete`, txids: [txid] },
        }
    } else {
      const held = this.table.get(change.row.id)
      this.table.set(change.row.id, change.row)
      const after = wire(change.row)
      const before = held && wire(held)
      message = {
        key: String(change.row.id),
        // Default replica mode: the key and the changed columns.
        value: before
          ? Object.fromEntries(
              Object.entries(after).filter(
                ([name, value]) => name === `id` || before[name] !== value,
              ),
            )
          : after,
        headers: { operation: before ? `update` : `insert`, txids: [txid] },
      }
    }
    const batch = message ? [message] : []
    // The log is in commit order: a batch waits behind a held echo.
    if (holdEcho || this.stalled.length > 0)
      this.stalled.push({ batch, own: holdEcho })
    else this.outbox.push(batch)
    this.flush()
    return txid
  }

  // The application's side: its backend API.

  /** One write request; answers with the commit's txid. */
  api(request: WriteRequest): Promise<{ txid: number }> {
    this.log.push(JSON.parse(JSON.stringify(request)) as WriteRequest)
    const plan = this.plans.shift() ?? acceptAtOnce
    return new Promise((resolve, reject) => {
      const answer = () => {
        if (plan.outcome === `reject`) {
          reject(plan.error)
          return
        }
        const change: ProviderChange =
          request.type === `delete`
            ? { type: `delete`, id: request.id }
            : {
                type: `upsert`,
                row: rewriteRow(fromSqlRow({ ...request.row }), plan.rewrite),
              }
        resolve({ txid: this.commit(change, plan.echoHeld) })
      }
      if (plan.held) this.held.push(answer)
      else answer()
    })
  }

  // The oracle's side.

  plan(plan: WritePlan): void {
    this.plans.push(plan)
  }

  release(): void {
    this.held.shift()?.()
  }

  /** The log resumes at the oldest held echo, up to the next one. */
  deliver(): void {
    const first = this.stalled.shift()
    if (!first) return
    this.outbox.push(first.batch)
    while (this.stalled[0] && !this.stalled[0].own)
      this.outbox.push(this.stalled.shift()!.batch)
    this.flush()
  }

  /** Answers every held request and resumes the log. */
  drain(): void {
    for (const answer of this.held.splice(0)) answer()
    while (this.stalled.length > 0) this.deliver()
  }

  foreignCommit(change: ProviderChange): void {
    this.commit(change, false)
  }

  rows(): ReadonlyArray<ConformanceRow> {
    return [...this.table.values()]
  }

  requests(): ReadonlyArray<WriteRequest> {
    return this.log
  }

  /**
   * The propagation step: every batch sent and the client asking again,
   * and every write's receipt settled; while a request or an echo is held,
   * until the request log, the sent batches, and the receipts are quiet.
   */
  settle = ({ unsettled }: SettleCut) => {
    const delivered = () =>
      this.outbox.length === 0 && this.waiting !== undefined
    return settleWhenQuiet({
      done: () => delivered() && unsettled() === 0,
      blocked: () =>
        delivered() && (this.held.length > 0 || this.stalled.length > 0),
      activity: () =>
        `${this.log.length} ${this.offset} ${unsettled()} ${this.outbox.length}`,
      stopped: () => this.closed,
    })
  }
}

let sequence = 0

export function electricMutationDriver(): MutationDriver {
  return {
    adapter: `@tanstack/electric-db-collection (eager)`,
    capabilities: new Set([
      `write-rejection`,
      `held-writes`,
      `foreign-commits`,
      `server-rewrites`,
      `held-echoes`,
      `log-ordered-echoes`,
      `application-handlers`,
    ]),
    undefinedField: `null`,
    create(seed): MutationFixture {
      const provider = new ElectricMutationProvider(seed)
      // The application's handlers: write through its API, then wait for the
      // write's transaction in the shape stream.
      const persist = async (
        collection: {
          utils: { awaitTxId: (txid: number) => Promise<boolean> }
        },
        requests: Array<WriteRequest>,
      ) => {
        for (const request of requests) {
          const { txid } = await provider.api(request)
          await collection.utils.awaitTxId(txid)
        }
      }
      const collection = createCollection(
        electricCollectionOptions<ElectricRow>({
          id: `electric-mutations-${++sequence}`,
          shapeOptions: {
            url: `http://conformance/mutations-${sequence}`,
            params: { table: `rows` },
            fetchClient: provider.fetchClient,
          },
          getKey: (row) => row.id,
          onInsert: ({ transaction, collection: target }) =>
            persist(
              target,
              transaction.mutations.map((mutation) => ({
                type: `insert`,
                id: mutation.modified.id,
                // A SQL row has every column: an absent `note` is `NULL`.
                row: toSqlRow(
                  fromSqlRow(mutation.modified),
                ) as Partial<ConformanceRow>,
              })),
            ),
          onUpdate: ({ transaction, collection: target }) =>
            persist(
              target,
              transaction.mutations.map((mutation) => ({
                type: `update`,
                id: mutation.modified.id,
                // The complete row: a removed field is `NULL`.
                row: {
                  id: mutation.modified.id,
                  title: mutation.modified.title,
                  note: mutation.modified.note ?? null,
                } as Partial<ConformanceRow>,
              })),
            ),
          onDelete: ({ transaction, collection: target }) =>
            persist(
              target,
              transaction.mutations.map((mutation) => ({
                type: `delete`,
                id: mutation.original.id,
              })),
            ),
        }),
      )
      return {
        collection: observedView(collection, {
          row: fromSqlRow,
          key: (key) => key as number,
        }),
        base: () => [...collection.base.values()].map(fromSqlRow),
        writer: {
          insert: (row) => {
            const { id, title, note } = toSqlRow(row)
            return collection.insert({ id, title, note })
          },
          update: (row) =>
            collection.update(row.id, (draft) => {
              draft.title = row.title
              if (Object.hasOwn(row, `note`)) draft.note = row.note!
              // A `NULL` note is already absent; only a held one is removed.
              else if (typeof draft.note === `string`)
                (draft as { note?: string | null }).note = undefined
            }),
          delete: (id) => collection.delete(id),
        },
        provider,
        settle: provider.settle,
        drain: () => provider.drain(),
        dispose: () => collection.cleanup(),
      }
    },
  }
}
