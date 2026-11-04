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
 * - a write request is one record of a `createBulk` call, one `update` call,
 *   which carries only the changed fields and which the service merges into
 *   its row (`field-updates`), or one `delete` call. Each request is
 *   recorded as JSON, as the SDK sends it;
 * - a plan answers the next request: a rejection rejects the call with the
 *   plan's error, and a held request waits until `release`. An accepted
 *   write commits and sends its change event at once, or, with a held echo,
 *   only at `deliver`, as an event can trail the HTTP response
 *   (`held-echoes`). The change stream is in commit order, so a held event
 *   stalls it and later events wait behind it (`log-ordered-echoes`);
 *   TrailBase confirms each write through its change stream (the law set's
 *   `confirm-through-sync`);
 * - a rewrite (`server-rewrites`) is the service changing the stored row, as
 *   a column default, trigger, or check does; its event carries the stored
 *   row;
 * - a commit by another client changes the service's rows and sends its
 *   event at once.
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
import type { Event } from 'trailbase'
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
            this.controller = controller
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
    this.api.createBulk.mockImplementation((records) =>
      Promise.all(
        records.map((record) =>
          this.request({ type: `insert`, id: record.id, row: sentRow(record) }),
        ),
      ).then(() => records.map((record) => record.id)),
    )
    this.api.update.mockImplementation((id, record) =>
      this.request({
        type: `update`,
        id: Number(id),
        row: { id: Number(id), ...sentRow(record) },
      }),
    )
    this.api.delete.mockImplementation((id) =>
      this.request({ type: `delete`, id: Number(id) }),
    )
  }

  /** One write request: recorded, then answered by the next plan. */
  private request(request: WriteRequest): Promise<void> {
    this.log.push(request)
    const plan = this.plans.shift() ?? acceptAtOnce
    return new Promise<void>((resolve, reject) => {
      const answer = () => {
        if (plan.outcome === `reject`) {
          reject(plan.error)
          return
        }
        this.commit(this.change(request, plan), plan.echoHeld)
        resolve()
      }
      if (plan.held) this.held.push(answer)
      else answer()
    })
  }

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
    const send = () => this.controller?.enqueue(event)
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

  /** Answers every held request and sends every withheld event. */
  drain(): void {
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
    ]),
    undefinedField: `null`,
    create(seed): MutationFixture {
      const provider = new TrailBaseMutationProvider(seed)
      const collection = createCollection(
        trailBaseCollectionOptions({
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
            collection.update(row.id, (draft) => {
              draft.title = row.title
              if (Object.hasOwn(row, `note`)) draft.note = row.note
              // A `NULL` note is already absent; only a held one is removed.
              else if (typeof draft.note === `string`) draft.note = undefined
            }),
          delete: (id) => collection.delete(id),
        },
        provider,
        drain: () => provider.drain(),
        dispose: () => collection.cleanup(),
      }
    },
  }
}
