/**
 * Production driver for the shared eager live-source conformance oracle
 * (`packages/db-adapter-conformance`). It runs the real RxDB adapter against a
 * controlled RxCollection. The controlled collection keeps the four parts the
 * adapter's sync reads: `schema.primaryPath`, `storageInstance.schema`,
 * `storageInstance.query`, and the `$` change stream. The schema is a real
 * `RxSchema`, and `query` answers the adapter's own prepared queries with
 * RxDB's query matcher and sort comparator, so the adapter's paged initial
 * fetch and its `_meta.lwt` cursor run against RxDB's query semantics.
 *
 * The oracle's steps map onto RxDB like this:
 *
 * - a complete delivery is the initial fetch. The adapter's first query of a
 *   sync run waits until the oracle delivers; the provider then holds exactly
 *   those documents and answers every page from them. RxDB reads storage
 *   once per sync run, so the driver does not declare `complete-snapshot`;
 * - a change batch is one change event per change on `$`: `INSERT` for a key
 *   the provider does not hold, `UPDATE` for one it does, `DELETE` otherwise.
 *   The adapter commits each event alone, so the driver declares `per-change`
 *   commits. RxDB events carry no txid, so the driver does not declare
 *   `await-evidence`;
 * - a failure before ready rejects the pending query; after ready it errors
 *   the `$` stream;
 * - a release is the teardown of the adapter's `$` subscription (LIFE-2,
 *   LIFE-10). An errored RxJS stream tears its subscriber down itself.
 *
 * `syncBatchSize` is 2, so a complete delivery of up to four rows takes up to
 * three pages. Each delivery is one bulk write whose documents share a
 * `_meta.lwt`, as RxDB's storage writes do, so pages after the first are
 * found by the cursor's primary-key tie-break.
 *
 * RxDB primary keys are strings. The driver stores row `n` as document id
 * `"n"`, and its observed view maps each key and row id back with
 * `conformanceId`, which rejects anything that is not such a key. The view
 * passes status, health, `preload`, and `cleanup` through unchanged.
 */
import { createCollection } from '@tanstack/db'
import {
  createRxSchema,
  defaultHashSha256,
  getQueryMatcher,
  getSortComparator,
} from 'rxdb/plugins/core'
import { Observable } from 'rxjs'
import { rxdbCollectionOptions } from '../src/rxdb'
import type { ChangeMessage } from '@tanstack/db'
import type {
  PreparedQuery,
  RxChangeEvent,
  RxCollection,
  RxDocumentData,
} from 'rxdb/plugins/core'
import type { Subscriber } from 'rxjs'
import type {
  ConformanceRow,
  ControlledProvider,
  EagerLiveSourceDriver,
  EagerLiveSourceFixture,
  ObservedCollection,
  ProviderChange,
} from '../../db-adapter-conformance/src'

type Doc = { id: string; title: string }

const schema = createRxSchema<Doc>(
  {
    version: 0,
    type: `object`,
    primaryKey: `id`,
    properties: {
      id: { type: `string`, maxLength: 10 },
      title: { type: `string` },
    },
    required: [`id`, `title`],
  },
  defaultHashSha256,
)

interface ProviderSession {
  subscriber: Subscriber<RxChangeEvent<Doc>>
  releases: number
  delivered: boolean
  firstQuery?: {
    resolve: () => void
    reject: (error: unknown) => void
  }
}

class RxdbProvider implements ControlledProvider {
  readonly sessions: Array<ProviderSession> = []
  private docs = new Map<string, RxDocumentData<Doc>>()
  private lwt = 0

  /** The controlled RxCollection that the adapter reads. */
  readonly rxCollection = {
    schema,
    storageInstance: {
      schema: schema.jsonSchema,
      query: (prepared: PreparedQuery<Doc>) => this.query(prepared),
    },
    $: new Observable<RxChangeEvent<Doc>>((subscriber) => {
      const session: ProviderSession = {
        subscriber,
        releases: 0,
        delivered: false,
      }
      this.sessions.push(session)
      return () => {
        session.releases += 1
      }
    }),
  } as unknown as RxCollection<Doc>

  private latest(): ProviderSession {
    const session = this.sessions.at(-1)
    if (!session) throw new Error(`the adapter has not subscribed`)
    return session
  }

  // The first query of a sync run waits for the complete delivery; later
  // pages answer from the documents the provider then holds.
  private async query(prepared: PreparedQuery<Doc>) {
    const session = this.latest()
    if (!session.delivered) {
      if (session.firstQuery) throw new Error(`a second query before delivery`)
      await new Promise<void>((resolve, reject) => {
        session.firstQuery = { resolve, reject }
      })
    }
    const matches = getQueryMatcher(schema.jsonSchema, prepared.query)
    const order = getSortComparator(schema.jsonSchema, prepared.query)
    const { skip = 0, limit = Infinity } = prepared.query
    const documents = [...this.docs.values()]
      .filter((doc) => matches(doc))
      .sort(order)
      .slice(skip, skip + limit)
    return { documents }
  }

  // One delivery is one RxDB bulk write, and every document a bulk write
  // stores shares its `_meta.lwt`. The adapter's cursor breaks those ties on
  // the primary key, so a complete delivery of several rows reaches that
  // tie-break.
  private document(
    row: ConformanceRow,
    lwt: number,
    deleted = false,
  ): RxDocumentData<Doc> {
    return {
      id: String(row.id),
      title: row.title,
      _deleted: deleted,
      _rev: `${lwt}-conformance`,
      _attachments: {},
      _meta: { lwt },
    }
  }

  private emit(
    operation: RxChangeEvent<Doc>[`operation`],
    documentData: RxDocumentData<Doc>,
    previousDocumentData: RxDocumentData<Doc> | undefined,
  ) {
    this.latest().subscriber.next({
      operation,
      documentId: documentData.id,
      documentData,
      previousDocumentData,
      isLocal: false,
      collectionName: `conformance`,
    } as RxChangeEvent<Doc>)
  }

  releases = () => this.sessions.map((session) => session.releases)

  deliverSnapshot = (rows: ReadonlyArray<ConformanceRow>) => {
    const session = this.latest()
    const firstQuery = session.firstQuery
    if (!firstQuery) throw new Error(`the adapter has not queried`)
    const lwt = ++this.lwt
    this.docs = new Map(
      rows.map((row) => [String(row.id), this.document(row, lwt)]),
    )
    session.delivered = true
    session.firstQuery = undefined
    firstQuery.resolve()
  }

  deliverChanges = (changes: ReadonlyArray<ProviderChange>) => {
    const lwt = ++this.lwt
    for (const change of changes) {
      if (change.type === `upsert`) {
        const id = String(change.row.id)
        const previous = this.docs.get(id)
        const doc = this.document(change.row, lwt)
        this.docs.set(id, doc)
        this.emit(previous ? `UPDATE` : `INSERT`, doc, previous)
      } else {
        const id = String(change.id)
        const previous = this.docs.get(id)
        if (!previous) throw new Error(`provider does not hold row ${id}`)
        this.docs.delete(id)
        const doc = this.document(
          { id: change.id, title: previous.title },
          lwt,
          true,
        )
        this.emit(`DELETE`, doc, previous)
      }
    }
  }

  fail = (error: Error) => {
    const session = this.latest()
    if (session.firstQuery) {
      session.firstQuery.reject(error)
      session.firstQuery = undefined
    } else {
      session.subscriber.error(error)
    }
  }
}

/** Maps an RxDB key back to its conformance row id; rejects anything else. */
function conformanceId(key: unknown): number {
  const id = Number(key)
  if (typeof key !== `string` || !Number.isInteger(id) || String(id) !== key) {
    throw new Error(`RxDB key ${JSON.stringify(key)} is not a conformance id`)
  }
  return id
}

function conformanceRow(doc: Doc): ConformanceRow {
  return { ...doc, id: conformanceId(doc.id) }
}

/** The adapter's Collection, seen with conformance row ids. */
function observedView(
  collection: ReturnType<typeof createRxdbCollection>,
): ObservedCollection {
  return {
    get status() {
      return collection.status
    },
    get health() {
      return collection.health
    },
    *values() {
      for (const doc of collection.values()) yield conformanceRow(doc)
    },
    preload: () => collection.preload(),
    cleanup: () => collection.cleanup(),
    subscribeChanges: (callback, options) =>
      collection.subscribeChanges(
        (changes) =>
          callback(
            changes.map((change): ChangeMessage<ConformanceRow, number> => ({
              ...change,
              key: conformanceId(change.key),
              value: conformanceRow(change.value),
              previousValue:
                change.previousValue && conformanceRow(change.previousValue),
            })),
          ),
        options,
      ),
  }
}

function createRxdbCollection(provider: RxdbProvider) {
  return createCollection(
    rxdbCollectionOptions<Doc>({
      rxCollection: provider.rxCollection,
      syncBatchSize: 2,
      syncMode: `eager`,
    }),
  )
}

export function rxdbConformanceDriver(): EagerLiveSourceDriver {
  return {
    adapter: `@tanstack/rxdb-db-collection`,
    capabilities: new Set(),
    changeCommits: `per-change`,
    create(): EagerLiveSourceFixture {
      const provider = new RxdbProvider()
      return {
        collection: observedView(createRxdbCollection(provider)),
        provider,
      }
    },
  }
}
