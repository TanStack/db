/**
 * Production driver for the shared mutation oracle
 * (`packages/db-adapter-conformance/src/mutation-oracle.ts`). It runs the real
 * TrailBase adapter in eager mode against a controlled RecordApi that acts as
 * a TrailBase service: it holds the table's rows, answers `list`, `createBulk`,
 * `update`, and `delete` by plan, and sends the change stream's events.
 *
 * The oracle's steps map onto TrailBase like this:
 *
 * - a record is a SQL row with every column, so an absent `note` is `NULL`
 *   (`undefinedField: 'null'`); the observed view maps `NULL` back to absent
 *   (`fromSqlRow`). The driver inserts an absent `note` as `null`, as a
 *   TrailBase application must (its record type has every column), and
 *   removes a held `note` by assigning `undefined`, the update API's
 *   removed field. Removing it by assigning `null` is not generated;
 * - the adapter sends each transaction as one `client.execute(operations,
 *   true)`, one TrailBase transaction (`atomic-transactions`). A write
 *   request is one of its operations: a create, an update, which carries
 *   only the changed fields and which the service merges into its row
 *   (`field-updates`), or a delete. Each is recorded as JSON, as the SDK
 *   sends it, and the next plan answers the call, committing all or none;
 * - a plan answers the next request: a rejection rejects the call with the
 *   plan's error, and a held request waits until `release`. An accepted
 *   write commits and sends its change event at once, or, with a held echo,
 *   only at `deliver`, as an event can trail the HTTP response
 *   (`held-echoes`). The change stream is in commit order, so a held event
 *   stalls it and later events wait behind it (`log-ordered-echoes`);
 *   TrailBase confirms each write through its change stream (the law set's
 *   `confirm-through-sync`). Its events carry no write identity, so the
 *   adapter counts them: the n-th answered write on a record settles at the
 *   n-th event on it, also another client's (`counted-echoes`, maintainer
 *   decision 2026-11-04);
 * - a rewrite (`server-rewrites`) is the service changing the stored row, as
 *   a column default, trigger, or check does; its event carries the stored
 *   row;
 * - a commit by another client changes the service's rows and sends its
 *   event at once, or behind a held event, also while a write is pending;
 * - a reload (`reloads`) subscribes again and lists the table: an event
 *   belongs to the stream open at its commit, so the retired stream's held
 *   events never arrive on the new one.
 *
 * Limits: the record API is a test double that bypasses the SDK's fetch and
 * SSE decoding, as `conformance-driver.ts` does; the key is the client's,
 * never server-generated.
 */
import { createCollection } from '@tanstack/db'
import { trailBaseCollectionOptions } from '../src/trailbase'
import {
  acceptAtOnce,
  fromSqlRow,
  observedView,
  rewriteRow,
  toSqlRow,
} from '../../db-adapter-conformance/src'
import { MockRecordApi } from './mock-record-api'
import type { Client, Event, RecordId } from 'trailbase'
import type {
  ConformanceRow,
  MutationDriver,
  MutationFixture,
  MutationProvider,
  ProviderChange,
  WritePlan,
  WriteRequest,
} from '../../db-adapter-conformance/src'

/**
 * A TrailBase record: a SQL row, so it has every column. The application
 * writes an absent `note` as `null`, and removes one by assigning
 * `undefined`, the update API's removed field (an own `undefined`).
 */
/** An operation from the mock record API's `createOp`, `updateOp`, or `deleteOp`. */
type Operation =
  | { kind: `create`; record: ConformanceRecord }
  | { kind: `update`; id: RecordId; record: Partial<ConformanceRecord> }
  | { kind: `delete`; id: RecordId }

type ConformanceRecord = {
  id: number
  title: string
  note: string | null | undefined
}

/** A value as the SDK sends it: JSON, so an `undefined` field is absent. */
const asSent = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** A request's record as the request log holds it; `null` is kept. */
const sentRow = (record: Partial<ConformanceRecord>) =>
  asSent(record) as Partial<ConformanceRow>

class TrailBaseMutationProvider implements MutationProvider {
  readonly api = new MockRecordApi<ConformanceRecord>()
  /** The service's table: SQL rows. */
  private readonly table = new Map<number, ConformanceRecord>()
  private readonly plans: Array<WritePlan> = []
  private readonly held: Array<() => void> = []
  /** Teardown: every request is answered at once, every copy sent. */
  private draining = false
  /** Events the stream holds at a held echo; `own` marks the holding one. */
  private readonly withheld: Array<{ send: () => void; own: boolean }> = []
  private readonly log: Array<WriteRequest> = []
  private controller: ReadableStreamDefaultController<Event> | undefined

  constructor(seed: ReadonlyArray<ConformanceRow>) {
    for (const row of seed) this.table.set(row.id, toSqlRow(row))
    this.api.subscribe.mockImplementation(() =>
      Promise.resolve(
        new ReadableStream<Event>({
          start: (controller) => {
            // A new subscription gets only later commits: the retired
            // stream's held events never arrive.
            this.controller = controller
            this.withheld.splice(0)
          },
          // Cleanup cancels the stream; later events have no reader.
          cancel: () => {
            this.controller = undefined
          },
        }),
      ),
    )
    this.api.list.mockImplementation(() =>
      Promise.resolve({ records: [...this.table.values()].map(asSent) }),
    )
  }

  /**
   * The client's `execute(operations, true)`: one TrailBase transaction.
   * Each operation is a request, recorded as JSON as the SDK sends it; the
   * next plan answers them together, committing all or none, and their
   * events go out together.
   */
  readonly client = {
    execute: (operations: Array<unknown>): Promise<Array<number>> => {
      const requests = (operations as Array<Operation>).map(
        (op): WriteRequest =>
          op.kind === `create`
            ? { type: `insert`, id: op.record.id, row: sentRow(op.record) }
            : op.kind === `update`
              ? {
                  type: `update`,
                  id: Number(op.id),
                  row: { id: Number(op.id), ...sentRow(op.record) },
                }
              : { type: `delete`, id: Number(op.id) },
      )
      this.log.push(...requests)
      const plan = this.plans.shift() ?? acceptAtOnce
      return new Promise((resolve, reject) => {
        const answer = () => {
          if (plan.outcome === `reject`) {
            reject(plan.error)
            return
          }
          // The first event is held with the plan's echo; the others queue
          // behind it, so the transaction's events arrive together.
          requests.forEach((request, at) =>
            this.commit(
              this.change(request, plan),
              at === 0 && plan.echoHeld && !this.draining,
            ),
          )
          resolve(requests.map((request) => request.id))
        }
        if (plan.held && !this.draining) this.held.push(answer)
        else answer()
      })
    },
  } as unknown as Client

  /** The change an accepted request makes to the service's table. */
  private change(request: WriteRequest, plan: WritePlan): ProviderChange {
    if (request.type === `delete`) return { type: `delete`, id: request.id }
    // An update merges the fields it sends into the stored row.
    const merged = {
      ...(request.type === `update` ? this.table.get(request.id) : {}),
      ...request.row,
    } as Partial<ConformanceRecord>
    return {
      type: `upsert`,
      row: rewriteRow(fromSqlRow({ note: null, ...merged }), plan.rewrite),
    }
  }

  /** Commits a change and sends its event, at once or at `deliver`. */
  private commit(change: ProviderChange, withhold = false): void {
    let event: Event
    if (change.type === `delete`) {
      const record = this.table.get(change.id)
      // Deleting a row the table lacks changes nothing and sends no event.
      if (!record) return
      this.table.delete(change.id)
      event = { Delete: asSent(record) }
    } else {
      const record = toSqlRow(change.row)
      const held = this.table.has(change.row.id)
      this.table.set(change.row.id, record)
      event = held ? { Update: asSent(record) } : { Insert: asSent(record) }
    }
    // An event belongs to the stream open at its commit; a reload's new
    // stream does not carry it.
    const stream = this.controller
    const send = () => {
      if (stream && stream === this.controller) stream.enqueue(event)
    }
    // The change stream is in commit order: an event waits behind a held one.
    if (withhold || this.withheld.length > 0)
      this.withheld.push({ send, own: withhold })
    else send()
  }

  plan(plan: WritePlan): void {
    this.plans.push(plan)
  }

  release(): void {
    this.held.shift()?.()
  }

  /**
   * Answers every held request and sends every withheld event, and from now
   * on answers each request at once and holds no event, also for a request
   * the adapter's queue sends only after these answers.
   */
  drain(): void {
    this.draining = true
    for (const answer of this.held.splice(0)) answer()
    for (const { send } of this.withheld.splice(0)) send()
  }

  deliver(): void {
    this.withheld.shift()?.send()
    while (this.withheld[0] && !this.withheld[0].own)
      this.withheld.shift()!.send()
  }

  foreignCommit(change: ProviderChange): void {
    this.commit(change)
  }

  rows(): ReadonlyArray<ConformanceRow> {
    return [...this.table.values()].map(fromSqlRow)
  }

  requests(): ReadonlyArray<WriteRequest> {
    return this.log
  }
}

/**
 * Replaces a held record's fields; a `NULL` note is already absent, so only
 * a held one is removed.
 */
function edit(draft: ConformanceRecord, row: ConformanceRow): void {
  draft.title = row.title
  if (Object.hasOwn(row, `note`)) draft.note = row.note
  else if (typeof draft.note === `string`) draft.note = undefined
}

export function trailBaseMutationDriver(): MutationDriver {
  return {
    adapter: `@tanstack/trailbase-db-collection (eager)`,
    capabilities: new Set([
      `write-rejection`,
      `held-writes`,
      `foreign-commits`,
      `server-rewrites`,
      `field-updates`,
      `held-echoes`,
      `log-ordered-echoes`,
      `counted-echoes`,
      `reloads`,
      // Each transaction is one `client.execute(operations, true)`.
      `atomic-transactions`,
    ]),
    undefinedField: `null`,
    create(seed): MutationFixture {
      const provider = new TrailBaseMutationProvider(seed)
      const collection = createCollection(
        trailBaseCollectionOptions({
          client: provider.client,
          recordApi: provider.api,
          getKey: (row: ConformanceRecord) => row.id,
          syncMode: `eager`,
          parse: {},
          serialize: {},
        }),
      )
      return {
        collection: observedView(collection, {
          row: fromSqlRow,
          key: (key) => key as number,
        }),
        base: () => [...collection.base.values()].map(fromSqlRow),
        writer: {
          insert: (row) => collection.insert(toSqlRow(row)),
          update: (row) =>
            collection.update(row.id, (draft) => edit(draft, row)),
          delete: (id) => collection.delete(id),
          batch: (type, rows) => {
            const ids = rows.map((row) => row.id)
            return type === `insert`
              ? collection.insert(rows.map(toSqlRow))
              : type === `update`
                ? collection.update(ids, (drafts) =>
                    drafts.forEach((draft, at) => edit(draft, rows[at]!)),
                  )
                : collection.delete(ids)
          },
        },
        provider,
        drain: () => provider.drain(),
        reload: () => collection.reload(),
        dispose: () => collection.cleanup(),
      }
    },
  }
}
