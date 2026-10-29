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
 * - the provider holds the backend's documents. `seed` sets them before a
 *   sync run subscribes. A complete delivery is the initial fetch's result:
 *   the adapter's first query of a sync run waits until the oracle delivers
 *   it, and every page answers from it. RxDB reads storage once per sync
 *   run, so the driver does not declare `complete-snapshot`;
 * - RxDB subscribes to `$` before it queries, so the driver declares
 *   `listen-before-fetch`: a change batch before the first ready is a
 *   backend write during the fetch, announced on `$`. A query issued while
 *   no `$` subscription is live counts as a fetch before listening (READY-8);
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
 * `"n"`, and the shared `observedView` maps each key and row id back with
 * `conformanceKey`, which rejects anything that is not such a key. A JSON
 * document omits an absent `note`, so rows otherwise pass through unchanged.
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
import {
  conformanceKey,
  describeValue,
  jsonValueKinds,
  observedView,
} from '../../db-adapter-conformance/src'
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
  ProviderChange,
} from '../../db-adapter-conformance/src'

type Doc = { id: string; title: string; note?: string; value?: unknown }

const schema = createRxSchema<Doc>(
  {
    version: 0,
    type: `object`,
    primaryKey: `id`,
    properties: {
      id: { type: `string`, maxLength: 10 },
      title: { type: `string` },
      note: { type: `string` },
      // Any JSON value (FID-1); RxDB documents are JSON.
      value: {},
    },
    required: [`id`, `title`],
  },
  defaultHashSha256,
)

interface ProviderSession {
  subscriber: Subscriber<RxChangeEvent<Doc>>
  releases: number
  delivered: boolean
  /** The documents the initial fetch reads: the result at its read point. */
  read: Map<string, RxDocumentData<Doc>>
  firstQuery?: {
    resolve: () => void
    reject: (error: unknown) => void
  }
}

class RxdbProvider implements ControlledProvider {
  readonly sessions: Array<ProviderSession> = []
  private docs = new Map<string, RxDocumentData<Doc>>()
  private lwt = 0
  private early = 0

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
        read: new Map(),
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
    const listening = this.sessions.at(-1)
    if (!listening || listening.releases > 0) this.early += 1
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
    const documents = [...session.read.values()]
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
      // A JSON document omits an absent field.
      ...(row.note === undefined ? {} : { note: row.note }),
      ...(Object.hasOwn(row, `value`) ? { value: row.value } : {}),
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
  fetchesBeforeListening = () => this.early

  // The backend's rows before the adapter subscribes, in one bulk write.
  seed = (rows: ReadonlyArray<ConformanceRow>) => {
    const lwt = ++this.lwt
    this.docs = new Map(
      rows.map((row) => [String(row.id), this.document(row, lwt)]),
    )
  }

  // The fetch result at its read point. Its documents keep the backend's
  // current versions where they agree, and the read's own otherwise.
  deliverSnapshot = (rows: ReadonlyArray<ConformanceRow>) => {
    const session = this.latest()
    const firstQuery = session.firstQuery
    if (!firstQuery) throw new Error(`the adapter has not queried`)
    const lwt = ++this.lwt
    session.read = new Map(
      rows.map((row) => {
        const id = String(row.id)
        const current = this.docs.get(id)
        return [
          id,
          current && sameDocument(current, row)
            ? current
            : this.document(row, lwt),
        ]
      }),
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
        const doc = this.document(conformanceRow(previous), lwt, true)
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

/** An RxDB document as a conformance row: key `"n"` is row id `n`. */
function conformanceRow(doc: Doc): ConformanceRow {
  return { ...doc, id: conformanceKey(doc.id) }
}

function sameDocument(doc: Doc, row: ConformanceRow): boolean {
  return (
    doc.title === row.title &&
    doc.note === row.note &&
    describeValue(doc.value) === describeValue(row.value)
  )
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
    capabilities: new Set([`listen-before-fetch`]),
    changeCommits: `per-change`,
    valueKinds: jsonValueKinds,
    create(): EagerLiveSourceFixture {
      const provider = new RxdbProvider()
      return {
        collection: observedView(createRxdbCollection(provider), {
          row: conformanceRow,
          key: conformanceKey,
        }),
        provider,
      }
    },
  }
}
