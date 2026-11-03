/**
 * Production driver for the shared mutation oracle
 * (`packages/db-adapter-conformance/src/mutation-oracle.ts`). It runs the real
 * RxDB adapter on a real RxDB database over RxDB's memory storage. The
 * provider is a wrapper around that storage's `bulkWrite`, the one call
 * through which every RxDB write reaches storage, so the adapter's own
 * `bulkUpsert`, `findOne`, `incrementalPatch`, and `bulkRemove` calls run as
 * an application's would.
 *
 * The oracle's steps map onto RxDB like this:
 *
 * - the provider stores each document as JSON, as RxDB's persistent
 *   storages and replication do, so a field whose value is `undefined` is
 *   absent from it (`undefinedField: 'absent'`);
 * - a write request is one row of a `bulkWrite` call: an insert when the row
 *   has no live previous document, a delete when its document is
 *   `_deleted`, and an update otherwise. The request carries the document's
 *   fields without RxDB's reserved fields. A row the storage refuses as a
 *   conflict, an insert of a document it holds, is not a request: it has no
 *   effect, and RxDB's `bulkUpsert` sends it and answers it itself before
 *   it writes the update;
 * - a plan answers the next request. A rejection answers with a per-row
 *   write error in the `bulkWrite` response and writes nothing, as RxDB's
 *   schema validation refuses a document; RxDB reports it as an `RxError`
 *   whose `parameters.writeError` is that error object (`matchesFailure`).
 *   A held request waits in the wrapper until `release`. An accepted
 *   request runs the memory storage's own `bulkWrite`;
 * - a commit from another client is a write through the same RxCollection
 *   (`upsert`, or `remove` of the found document), as a second tab or a
 *   replication writes into the database. It bypasses the plans and the
 *   request log;
 * - a rewrite (`server-rewrites`) is RxDB's `preInsert` and `preSave` hooks,
 *   which change a document before RxDB writes it, as an application's
 *   hooks for defaults or normalization do. The request keeps the document
 *   as the adapter sent it;
 * - the provider's rows are the storage's non-deleted documents, read from
 *   the storage instance rather than RxDB's document cache.
 *
 * RxDB primary keys are strings. The driver stores row `n` as document id
 * `"n"`, and `observedView` maps each key and row id back with
 * `conformanceKey`. A JSON document omits an absent `note`.
 *
 * Limits: a rejection is a per-row write error. A `bulkWrite` that throws, as
 * a failing storage does, is not generated: RxDB's incremental write queue
 * (17.1.0) does not catch it, so `incrementalPatch` never settles and later
 * incremental writes on the collection wait forever (recorded in the
 * coverage map). A conflict (status 409) is not generated either.
 */
import { createCollection } from '@tanstack/db'
import { createRxDatabase, prepareQuery } from 'rxdb/plugins/core'
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory'
import { rxdbCollectionOptions } from '../src/rxdb'
import {
  conformanceKey,
  observedView,
  rewriteRow,
} from '../../db-adapter-conformance/src'
import type {
  BulkWriteRow,
  RxCollection,
  RxDatabase,
  RxDocumentData,
  RxStorageBulkWriteResponse,
  RxStorageInstance,
  RxStorageWriteError,
} from 'rxdb/plugins/core'
import type {
  ConformanceRow,
  MutationDriver,
  MutationFixture,
  MutationProvider,
  ProviderChange,
  WritePlan,
  WriteRequest,
} from '../../db-adapter-conformance/src'

type Doc = { id: string; title: string; note?: string }

const schema = {
  version: 0,
  type: `object`,
  primaryKey: `id`,
  properties: {
    id: { type: `string`, maxLength: 10 },
    title: { type: `string` },
    note: { type: `string` },
  },
  required: [`id`, `title`],
} as const

const acceptAtOnce: WritePlan = {
  outcome: `accept`,
  held: false,
  rewrite: `none`,
  error: new Error(`unplanned write`),
}

/**
 * An RxDB document as a conformance row: key `"n"` is row id `n`. Other
 * fields pass through, so an optimistic row's own `undefined` stays, and
 * RxDB's reserved fields go.
 */
function conformanceRow(doc: Doc): ConformanceRow {
  const { _rev, _meta, _deleted, _attachments, ...fields } =
    doc as RxDocumentData<Doc>
  return { ...fields, id: conformanceKey(doc.id) }
}

function document(row: ConformanceRow): Doc {
  return {
    id: String(row.id),
    title: row.title,
    ...(row.note === undefined ? {} : { note: row.note }),
  }
}

/**
 * The request a write row makes. Its row is the document as the adapter sent
 * it, before RxDB's hooks rewrote it (`sent`), stored as JSON.
 */
function writeRequest(row: BulkWriteRow<Doc>, sent?: Doc): WriteRequest {
  const id = conformanceKey(row.document.id)
  if (row.document._deleted) return { type: `delete`, id }
  return {
    type: row.previous && !row.previous._deleted ? `update` : `insert`,
    id,
    row: conformanceRow(
      sent ? (JSON.parse(JSON.stringify(sent)) as Doc) : row.document,
    ),
  }
}

/**
 * A write row as a serializing storage stores it. RxDB documents are JSON,
 * and its persistent storages and replication serialize them, so the
 * provider stores JSON: a field whose value is `undefined` is absent. The
 * memory storage alone would keep the object as given.
 */
function jsonRow(row: BulkWriteRow<Doc>): BulkWriteRow<Doc> {
  return JSON.parse(JSON.stringify(row)) as BulkWriteRow<Doc>
}

/** The storage's error object for each rejected row, to its plan's error. */
const planErrors = new WeakMap<object, Error>()

/**
 * A per-row write error, as RxDB's schema validation reports a document it
 * refuses: the row is not written and the response names it.
 */
function writeError(
  row: BulkWriteRow<Doc>,
  error: Error,
  context: string,
): RxStorageWriteError<Doc> {
  const rejected: RxStorageWriteError<Doc> = {
    status: 422,
    isError: true,
    context,
    documentId: row.document.id,
    writeRow: row,
    validationErrors: [{ field: `title`, message: error.message }],
    schema: schema as never,
  }
  planErrors.set(rejected, error)
  return rejected
}

/**
 * MUT-2's relation for RxDB: RxDB reports a write error as an `RxError` whose
 * `parameters.writeError` is the storage's error object for that row.
 */
function matchesFailure(reported: unknown, failure: Error): boolean {
  const rowError = (
    reported as { parameters?: { writeError?: object } } | undefined
  )?.parameters?.writeError
  return (
    reported instanceof Error &&
    rowError !== undefined &&
    planErrors.get(rowError) === failure
  )
}

type BulkWrite = (
  rows: Array<BulkWriteRow<Doc>>,
  context: string,
) => Promise<RxStorageBulkWriteResponse<Doc>>

class RxdbMutationProvider implements MutationProvider {
  private readonly plans: Array<WritePlan> = []
  private readonly held: Array<() => void> = []
  private readonly log: Array<WriteRequest> = []
  private foreign = false
  /** Each pending write's document as the adapter sent it, before hooks. */
  private readonly sent = new Map<string, Doc>()
  private instance: RxStorageInstance<Doc, unknown, unknown> | undefined
  rxCollection: RxCollection<Doc> | undefined

  /** Memory storage whose `conformance` collection writes go through `write`. */
  readonly storage: ReturnType<typeof getRxStorageMemory>

  constructor() {
    const memory = getRxStorageMemory()
    this.storage = {
      ...memory,
      createStorageInstance: async (params) => {
        const instance = await memory.createStorageInstance(params)
        if (params.collectionName !== `conformance`) return instance
        this.instance = instance as unknown as RxStorageInstance<
          Doc,
          unknown,
          unknown
        >
        const bulkWrite = instance.bulkWrite.bind(
          instance,
        ) as unknown as BulkWrite
        const write: BulkWrite = (rows, context) =>
          this.write(rows, context, bulkWrite)
        instance.bulkWrite = write as unknown as typeof instance.bulkWrite
        return instance
      },
    }
  }

  private async write(
    rows: Array<BulkWriteRow<Doc>>,
    context: string,
    bulkWrite: BulkWrite,
  ): Promise<RxStorageBulkWriteResponse<Doc>> {
    if (this.foreign) return bulkWrite(rows.map(jsonRow), context)
    const response: RxStorageBulkWriteResponse<Doc> = { error: [] }
    for (const row of rows.map(jsonRow)) {
      // An insert of a document the storage holds, even deleted, is refused
      // as a conflict and has no effect. RxDB's `bulkUpsert` sends one before
      // it updates, and answers the conflict itself, so it is not a request.
      if (row.previous === undefined && (await this.holds(row.document.id))) {
        response.error.push(...(await bulkWrite([row], context)).error)
        continue
      }
      this.log.push(writeRequest(row, this.sent.get(row.document.id)))
      this.sent.delete(row.document.id)
      const plan = this.plans.shift() ?? acceptAtOnce
      if (plan.held) {
        await new Promise<void>((resolve) => this.held.push(resolve))
      }
      if (plan.outcome === `reject`) {
        response.error.push(writeError(row, plan.error, context))
        continue
      }
      response.error.push(...(await bulkWrite([row], context)).error)
    }
    return response
  }

  private async holds(id: string): Promise<boolean> {
    const found = await this.instance!.findDocumentsById([id], true)
    return found.length > 0
  }

  /**
   * RxDB's `preInsert` and `preSave` hooks, which change a document before
   * RxDB writes it: the server-side rewrite (`server-rewrites`). Each keeps
   * the document as sent for the request, then applies the next plan's
   * rewrite. A conflicting insert that RxDB retries as an update runs both
   * hooks; the first keeps the document as sent, and rewrites are
   * idempotent.
   */
  installHooks(rxCollection: RxCollection<Doc>): void {
    const hook = (data: Doc) => {
      if (this.foreign || (data as { _deleted?: boolean })._deleted) return
      if (!this.sent.has(data.id)) this.sent.set(data.id, { ...data })
      const rewrite = this.plans[0]?.rewrite ?? `none`
      const row = rewriteRow(conformanceRow(data), rewrite)
      data.title = row.title
      if (row.note === undefined) delete data.note
      else data.note = row.note
    }
    rxCollection.preInsert(hook, false)
    rxCollection.preSave(hook, false)
  }

  plan(plan: WritePlan): void {
    this.plans.push(plan)
  }

  release(): void {
    this.held.shift()?.()
  }

  /** Answers every held request, so the database can close. */
  releaseAll(): void {
    for (const answer of this.held.splice(0)) answer()
  }

  async foreignCommit(change: ProviderChange): Promise<void> {
    const rxCollection = this.rxCollection!
    this.foreign = true
    try {
      if (change.type === `upsert`) {
        await rxCollection.upsert(document(change.row))
      } else {
        await rxCollection.findOne(String(change.id)).remove()
      }
    } finally {
      this.foreign = false
    }
  }

  /** The provider's starting rows, written before the adapter syncs. */
  async seed(rows: ReadonlyArray<ConformanceRow>): Promise<void> {
    this.foreign = true
    try {
      await this.rxCollection!.bulkInsert(rows.map(document))
    } finally {
      this.foreign = false
    }
  }

  /** The storage's documents, not RxDB's document cache. */
  async rows(): Promise<ReadonlyArray<ConformanceRow>> {
    const instance = this.instance!
    const { documents } = await instance.query(
      prepareQuery(instance.schema, {
        selector: { _deleted: false },
        sort: [{ id: `asc` }],
        skip: 0,
      }),
    )
    return documents.map(conformanceRow)
  }

  requests(): ReadonlyArray<WriteRequest> {
    return this.log
  }
}

let sequence = 0

export function rxdbMutationDriver(): MutationDriver {
  return {
    adapter: `@tanstack/rxdb-db-collection`,
    capabilities: new Set([
      `write-rejection`,
      `held-writes`,
      `foreign-commits`,
      `server-rewrites`,
    ]),
    // A JSON document has no `undefined`: a removed field is absent.
    undefinedField: `absent`,
    matchesFailure,
    async create(seed): Promise<MutationFixture> {
      const provider = new RxdbMutationProvider()
      const db: RxDatabase = await createRxDatabase({
        name: `conformance-mutations-${++sequence}`,
        storage: provider.storage,
        multiInstance: false,
      })
      const { conformance } = await db.addCollections({
        conformance: { schema },
      })
      const rxCollection = conformance as RxCollection<Doc>
      provider.rxCollection = rxCollection
      provider.installHooks(rxCollection)
      await provider.seed(seed)
      const collection = createCollection(
        rxdbCollectionOptions<Doc>({ rxCollection, syncMode: `eager` }),
      )
      return {
        collection: observedView(collection, {
          row: conformanceRow,
          key: conformanceKey,
        }),
        base: () =>
          [...collection.base.values()].map((doc) => conformanceRow(doc)),
        writer: {
          insert: (row) => collection.insert(document(row)),
          update: (row) =>
            collection.update(String(row.id), (draft) => {
              draft.title = row.title
              if (Object.hasOwn(row, `note`)) draft.note = row.note
              else delete draft.note
            }),
          delete: (id) => collection.delete(String(id)),
        },
        provider,
        dispose: async () => {
          // Removing the database waits for its writes, so answer any write
          // a failed history left held.
          provider.releaseAll()
          await collection.cleanup()
          await db.remove()
        },
      }
    },
  }
}
