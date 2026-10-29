/**
 * Production driver for the shared eager live-source conformance oracle
 * (`packages/db-adapter-conformance`). It runs the real TrailBase adapter in
 * eager mode against a controlled RecordApi, as `lifecycle-oracle` does: the
 * driver supplies `subscribe` and `list` results and already-decoded events,
 * and bypasses the SDK's fetch and SSE decoding.
 *
 * The oracle's steps map onto TrailBase like this:
 *
 * - a complete delivery before ready is the eager `list` page. TrailBase lists
 *   once per sync run and does not re-deliver a complete result, so the
 *   driver does not declare `complete-snapshot`;
 * - a change batch is one change event per change: `Insert` for a key the
 *   provider does not hold, `Update` for one it does, `Delete` otherwise.
 *   TrailBase carries no txid, so the driver does not declare
 *   `await-evidence`;
 * - a failure before ready rejects the pending `list`; after ready it errors
 *   the change stream;
 * - TrailBase commits each change event on its own, so the driver declares
 *   `per-change` commits (PUB-1);
 * - a release is the adapter cancelling the stream or releasing its reader
 *   lock (LIFE-2, LIFE-10). An errored stream does not call its source's
 *   `cancel`, so for it only the lock release is seen.
 *
 * The provider's own rows decide `Insert` versus `Update`, as a real service
 * would. A record is a SQL row with every column, so an absent `note` is
 * `NULL` (`toSqlRow`), and the observed view maps `NULL` back to absent
 * (`fromSqlRow`). The driver never reads the Collection.
 */
import { createCollection } from '@tanstack/db'
import { trailBaseCollectionOptions } from '../src/trailbase'
import {
  fromSqlRow,
  jsonValueKinds,
  observedView,
  toSqlRow,
} from '../../db-adapter-conformance/src'
import { MockRecordApi } from './mock-record-api'
import type { Event, ListResponse } from 'trailbase'
import type {
  ConformanceRow,
  ControlledProvider,
  EagerLiveSourceDriver,
  EagerLiveSourceFixture,
  ProviderChange,
} from '../../db-adapter-conformance/src'

/** A TrailBase record: a SQL row, so an absent `note` is `NULL`. */
type ConformanceRecord = {
  id: number
  title: string
  note: string | null
  // Every row carries a value, since the driver declares value kinds.
  value: unknown
}

const toRecord = (row: ConformanceRow) => toSqlRow(row) as ConformanceRecord

interface ProviderSession {
  stream: ReadableStream<Event>
  controller: ReadableStreamDefaultController<Event>
  cancels: number
  locked: boolean
  list?: {
    resolve: (response: ListResponse<ConformanceRecord>) => void
    reject: (error: unknown) => void
  }
}

class TrailBaseProvider implements ControlledProvider {
  readonly api = new MockRecordApi<ConformanceRecord>()
  readonly sessions: Array<ProviderSession> = []
  private rows = new Map<number, ConformanceRow>()

  constructor() {
    this.api.subscribe.mockImplementation(() => {
      let controller!: ReadableStreamDefaultController<Event>
      const session = { cancels: 0, locked: false } as ProviderSession
      const stream = new ReadableStream<Event>({
        start: (value) => {
          controller = value
        },
        cancel: () => {
          session.cancels += 1
        },
      })
      session.stream = stream
      session.controller = controller
      this.sessions.push(session)
      // A new sync run lists the source again from its current rows.
      this.rows = new Map()
      return Promise.resolve(stream)
    })
    this.api.list.mockImplementation(
      () =>
        new Promise<ListResponse<ConformanceRecord>>((resolve, reject) => {
          this.latest().list = { resolve, reject }
        }),
    )
  }

  private latest(): ProviderSession {
    const session = this.sessions.at(-1)
    if (!session) throw new Error(`the adapter has not subscribed`)
    return session
  }

  private pendingList() {
    const list = this.latest().list
    if (!list) throw new Error(`the adapter has not requested its list`)
    this.latest().list = undefined
    return list
  }

  // A session counts as released once the adapter cancelled it, or once it
  // held the reader lock and gave it back.
  releases = () =>
    this.sessions.map((session) => {
      if (session.stream.locked) session.locked = true
      const unlocked = session.locked && !session.stream.locked
      return Math.max(session.cancels, unlocked ? 1 : 0)
    })

  deliverSnapshot = (rows: ReadonlyArray<ConformanceRow>) => {
    this.rows = new Map(rows.map((row) => [row.id, row]))
    // One short page drains TrailBase's paged list.
    this.pendingList().resolve({ records: rows.map(toRecord) })
  }

  deliverChanges = (changes: ReadonlyArray<ProviderChange>) => {
    const { controller } = this.latest()
    for (const change of changes) {
      if (change.type === `upsert`) {
        const held = this.rows.has(change.row.id)
        this.rows.set(change.row.id, change.row)
        const record = toRecord(change.row)
        controller.enqueue(held ? { Update: record } : { Insert: record })
      } else {
        const row = this.rows.get(change.id)
        if (!row) throw new Error(`provider does not hold row ${change.id}`)
        this.rows.delete(change.id)
        controller.enqueue({ Delete: toRecord(row) })
      }
    }
  }

  fail = (error: Error) => {
    const session = this.latest()
    if (session.list) {
      this.pendingList().reject(error)
    } else {
      session.controller.error(error)
    }
  }
}

export function trailBaseConformanceDriver(): EagerLiveSourceDriver {
  return {
    adapter: `@tanstack/trailbase-db-collection (eager)`,
    capabilities: new Set(),
    changeCommits: `per-change`,
    valueKinds: jsonValueKinds,
    create(): EagerLiveSourceFixture {
      const provider = new TrailBaseProvider()
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
        provider,
      }
    },
  }
}
