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
 * - a plan answers the next request. A rejection writes nothing, in one of
 *   two kinds: `write-error` answers with a per-row write error in the
 *   `bulkWrite` response, as RxDB's schema validation refuses a document,
 *   which RxDB reports as an `RxError` whose `parameters.writeError` is that
 *   error object; `thrown` throws the plan's error from `bulkWrite`, as a
 *   failing storage does, which reaches the caller as itself
 *   (`matchesFailure`).
 *   A held request waits in the wrapper until `release`. An accepted
 *   request runs the memory storage's own `bulkWrite`;
 * - a commit from another client is a write of the document, with a new
 *   revision, straight to the collection's storage, as a second tab or a
 *   replication pull writes it. It bypasses RxDB's per-document write
 *   queue, the plans, and the request log, so it can land while one of the
 *   adapter's writes is held. That write then meets a revision conflict
 *   (status 409) when it is answered, and RxDB writes it again over the
 *   newer document: the retry is the same write request, so it is not
 *   logged again and keeps its plan;
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
 * Limits: a conflict arises only from a commit by another client.
 */
import { createCollection } from '@tanstack/db'
import {
  createRevision,
  createRxDatabase,
  now,
  prepareQuery,
} from 'rxdb/plugins/core'
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory'
import { rxdbCollectionOptions } from '../src/rxdb'
import {
  acceptAtOnce,
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
 * MUT-2's relation for RxDB: a thrown storage error reaches the caller as
 * itself, and RxDB reports a write error as an `RxError` whose
 * `parameters.writeError` is the storage's error object for that row.
 */
function matchesFailure(reported: unknown, failure: Error): boolean {
  if (reported === failure) return true
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
  /** Teardown: every request is answered at once. */
  private draining = false
  /** Each pending write's document as the adapter sent it, before hooks. */
  private readonly sent = new Map<string, Doc>()
  private storageInstance: RxStorageInstance<Doc, unknown, unknown> | undefined
  /** The memory storage's own `bulkWrite`, as another client reaches it. */
  private storageWrite: BulkWrite | undefined
  /** The plan of each accepted write RxDB retries after a conflict. */
  private readonly retrying = new Map<string, WritePlan>()
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
        this.storageInstance = instance as unknown as RxStorageInstance<
          Doc,
          unknown,
          unknown
        >
        const bulkWrite = instance.bulkWrite.bind(
          instance,
        ) as unknown as BulkWrite
        this.storageWrite = bulkWrite
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
      const id = row.document.id
      // RxDB's retry of a write that met a conflict is the same request.
      const retried = this.retrying.get(id)
      this.retrying.delete(id)
      if (!retried) this.log.push(writeRequest(row, this.sent.get(id)))
      this.sent.delete(id)
      const plan = retried ?? this.plans.shift() ?? acceptAtOnce
      if (plan.held && !retried && !this.draining) {
        await new Promise<void>((resolve) => this.held.push(resolve))
      }
      if (plan.outcome === `reject`) {
        if (plan.rejectionKind === `thrown`) throw plan.error
        response.error.push(writeError(row, plan.error, context))
        continue
      }
      const { error } = await bulkWrite([row], context)
      if (error.some((failure) => failure.status === 409))
        this.retrying.set(id, plan)
      response.error.push(...error)
    }
    return response
  }

  private async holds(id: string): Promise<boolean> {
    const found = await this.storageInstance!.findDocumentsById([id], true)
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
      const rewrite =
        (this.retrying.get(data.id) ?? this.plans[0])?.rewrite ?? `none`
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

  /**
   * Answers every held request, and from now on each request at once, also
   * one the adapter's queue sends only after these answers.
   */
  drain(): void {
    this.draining = true
    for (const answer of this.held.splice(0)) answer()
  }

  async foreignCommit(change: ProviderChange): Promise<void> {
    const id = String(change.type === `upsert` ? change.row.id : change.id)
    const [previous] = await this.storageInstance!.findDocumentsById([id], true)
    const fields =
      change.type === `upsert`
        ? document(change.row)
        : { ...conformanceRow(previous!), id }
    const written: RxDocumentData<Doc> = {
      ...(fields),
      _deleted: change.type === `delete`,
      _attachments: {},
      _meta: { lwt: now() },
      _rev: createRevision(this.rxCollection!.database.token, previous),
    }
    const { error } = await this.storageWrite!(
      [{ ...(previous ? { previous } : {}), document: written }],
      `conformance-foreign`,
    )
    if (error.length > 0) throw new Error(`foreign commit failed`)
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
    const instance = this.storageInstance!
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
      // `incrementalPatch` keeps the fields an update does not name.
      `merged-updates`,
      // A reload's initial fetch is a snapshot when the Collection keeps rows.
      `reloads`,
      `snapshot-reloads`,
    ]),
    // A JSON document has no `undefined`: a removed field is absent.
    undefinedField: `absent`,
    matchesFailure,
    rejectionKinds: [`write-error`, `thrown`],
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
              // Only a held note value is removed.
              else if (typeof draft.note === `string`) delete draft.note
            }),
          delete: (id) => collection.delete(String(id)),
        },
        provider,
        drain: () => provider.drain(),
        reload: () => collection.reload(),
        dispose: async () => {
          // Removing the database waits for its writes, which the check's
          // drain has answered.
          await collection.cleanup()
          await db.remove()
        },
      }
    },
  }
}
