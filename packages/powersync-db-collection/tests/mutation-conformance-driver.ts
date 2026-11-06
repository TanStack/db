/**
 * Production driver for the shared mutation oracle
 * (`packages/db-adapter-conformance/src/mutation-oracle.ts`). It runs the real
 * PowerSync adapter in eager mode over a real local PowerSync database
 * (SQLite through `@powersync/node`), as `conformance-driver.ts` does. The
 * adapter persists a write to that database and settles once its own diff
 * trigger has observed it, so the provider is the local database; uploading
 * to a PowerSync service is the SDK's upload queue, outside this oracle.
 *
 * The oracle's steps map onto PowerSync like this:
 *
 * - a write request is one `INSERT`, `UPDATE`, or `DELETE` statement the
 *   adapter executes on the table inside its write transaction. An insert
 *   sends every column; an update sets only its changed columns
 *   (`field-updates`); the request carries the bound values;
 * - the adapter runs each transaction in one write transaction
 *   (`atomic-transactions`), and the next plan answers all of its requests:
 *   a rejection throws the plan's error once its statements have run, as a
 *   failed write does, which rolls the transaction back. The driver does not
 *   declare `held-writes`: a held statement holds the database's one write
 *   lock, which the adapter's diff flush also needs, so it would delay the
 *   confirmation of earlier writes, a coupling the model does not represent;
 * - the adapter applies the database's changes through its change watcher
 *   (`onChangeWithCallback`), which runs at most every 30 ms, so each write's
 *   copy arrives after the database answers; the adapter must not settle
 *   the write before it applies (MUT-7), which the publication check sees.
 *   The driver does not declare `held-echoes`: one watcher callback applies
 *   every committed write, so it cannot withhold one write's copy while a
 *   later write proceeds;
 * - a commit by another client is a write to the table that is not the
 *   adapter's, as the SDK's download of server changes is;
 * - the provider's rows are the table's rows. `note` is a nullable text
 *   column, so an absent `note` is SQL `NULL` (`undefinedField: 'null'`,
 *   `toSqlRow`, `fromSqlRow`).
 *
 * PowerSync keys are strings, so row `n` is id `"n"`. The application
 * inserts an absent `note` as `null` and removes a held one by assigning
 * `undefined`, the update API's removed field; removal by assigning `null`
 * is not generated. The local database does not rewrite rows, so the driver
 * does not declare `server-rewrites`.
 */
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PowerSyncDatabase, Schema, Table, column } from '@powersync/node'
import { createCollection } from '@tanstack/db'
import { powerSyncCollectionOptions } from '../src'
import {
  acceptAtOnce,
  conformanceKey,
  fromSqlRow,
  observedView,
  toSqlRow,
} from '../../db-adapter-conformance/src'
import { TEST_DATABASE_IMPLEMENTATION } from './test-db-implementation'
import type { LockContext } from '@powersync/node'
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

const SCHEMA = new Schema({
  rows: new Table({
    title: column.text,
    note: column.text,
  }),
})

type Record = { id: string; title: string | null; note: string | null }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const drainTimeoutMs = 5_000

/** Field names in a statement, without the quoting `sanitizeSQL` adds. */
const unquote = (name: string) => name.trim().replace(/^['"]|['"]$/g, ``)
const names = (list: string) => list.split(`,`).map(unquote)

/**
 * The request an adapter statement makes, or undefined for a statement that
 * is not a write to the table.
 */
function writeRequest(
  sql: string,
  params: ReadonlyArray<unknown>,
): WriteRequest | undefined {
  const insert = /^\s*INSERT\s+into\s+['"]?rows['"]?\s*\(([^)]*)\)/i.exec(sql)
  if (insert) {
    const row = Object.fromEntries(
      names(insert[1]!).map((name, index) => [name, params[index]]),
    ) as Record
    return {
      type: `insert`,
      id: conformanceKey(row.id),
      row: { ...row, id: conformanceKey(row.id) } as Partial<ConformanceRow>,
    }
  }
  const update =
    /^\s*UPDATE\s+['"]?rows['"]?\s+SET\s+([\s\S]*?)\s+WHERE\s+id\s*=\s*\?/i.exec(
      sql,
    )
  if (update) {
    const fields = names(update[1]!).map((set) => set.split(`=`)[0]!.trim())
    const id = conformanceKey(String(params.at(-1)))
    return {
      type: `update`,
      id,
      row: {
        id,
        ...Object.fromEntries(
          fields.map((field, index) => [unquote(field), params[index]]),
        ),
      } as Partial<ConformanceRow>,
    }
  }
  const remove =
    /^\s*DELETE\s+FROM\s+['"]?rows['"]?\s+WHERE\s+id\s*=\s*\?/i.exec(sql)
  if (remove) return { type: `delete`, id: conformanceKey(String(params[0])) }
  return undefined
}

class PowerSyncMutationProvider implements MutationProvider {
  readonly database: PowerSyncDatabase
  readonly file: string
  private readonly plans: Array<WritePlan> = []
  private readonly log: Array<WriteRequest> = []
  private running = 0
  private drained = 0
  private drainTarget: number | undefined
  private readonly rawWriteTransaction: PowerSyncDatabase[`writeTransaction`]

  constructor() {
    if (!TEST_DATABASE_IMPLEMENTATION) {
      throw new Error(`no SQLite implementation is available`)
    }
    this.file = `mutations-${randomUUID()}.sqlite`
    this.database = new PowerSyncDatabase({
      database: {
        dbFilename: this.file,
        dbLocation: tmpdir(),
        implementation: TEST_DATABASE_IMPLEMENTATION,
      },
      schema: SCHEMA,
    })
    this.rawWriteTransaction = this.database.writeTransaction.bind(
      this.database,
    )
    // The adapter's write transactions: each table write is a request.
    this.database.writeTransaction = (async (
      callback: (tx: LockContext) => Promise<unknown>,
      lockTimeout?: number,
    ) => {
      // One plan answers the transaction, taken at its first write; a
      // rejection throws once every statement has run, inside the
      // transaction, which rolls it all back (`atomic-transactions`).
      let plan: WritePlan | undefined
      const result = await this.rawWriteTransaction(async (tx) => {
        const execute = tx.execute.bind(tx)
        const guarded = Object.create(tx) as LockContext
        guarded.execute = async (sql: string, params: Array<unknown> = []) => {
          const request = writeRequest(sql, params)
          if (request) {
            this.log.push(request)
            plan ??= this.plans.shift() ?? acceptAtOnce
          }
          return execute(sql, params)
        }
        const answer = await callback(guarded)
        if (plan?.outcome === `reject`) throw plan.error
        return answer
      }, lockTimeout)
      const wrote = plan !== undefined
      if (wrote) this.expectDrain()
      return result
    }) as PowerSyncDatabase[`writeTransaction`]
    // The adapter's change watcher: count its drains.
    const register = this.database.onChangeWithCallback.bind(this.database)
    this.database.onChangeWithCallback = (handler, options) =>
      register(
        {
          ...handler,
          onChange: async (event) => {
            this.running++
            try {
              await handler?.onChange(event)
            } finally {
              this.running--
              this.drained++
            }
          },
        },
        options,
      )
  }

  /**
   * A commit is applied by a watcher callback that starts after it: one
   * already running read the tracking table before the commit.
   */
  private expectDrain(): void {
    this.drainTarget = this.drained + this.running + 1
  }

  /**
   * Writes that are not the adapter's: the seed and other clients. A table
   * is a view, so an upsert is an update or an insert. A delete of a row the
   * table lacks changes nothing, so the watcher has nothing to drain.
   */
  private async write(change: ProviderChange): Promise<void> {
    const changed = await this.rawWriteTransaction(async (tx) => {
      // A view's `INSTEAD OF` trigger reports no affected rows, so the row's
      // presence decides whether the write changes anything.
      if (change.type === `delete`) {
        const id = String(change.id)
        const held = await tx.getOptional(`SELECT id FROM rows WHERE id = ?`, [
          id,
        ])
        if (held) await tx.execute(`DELETE FROM rows WHERE id = ?`, [id])
        return held !== null
      }
      const { id, title, note } = toSqlRow(change.row)
      const held = await tx.getOptional(`SELECT id FROM rows WHERE id = ?`, [
        String(id),
      ])
      if (held)
        await tx.execute(`UPDATE rows SET title = ?, note = ? WHERE id = ?`, [
          title,
          note,
          String(id),
        ])
      else
        await tx.execute(
          `INSERT INTO rows (id, title, note) VALUES (?, ?, ?)`,
          [String(id), title, note],
        )
      return true
    })
    if (changed) this.expectDrain()
  }

  async seed(rows: ReadonlyArray<ConformanceRow>): Promise<void> {
    for (const row of rows) await this.write({ type: `upsert`, row })
    this.drainTarget = undefined
  }

  plan(plan: WritePlan): void {
    this.plans.push(plan)
  }

  foreignCommit(change: ProviderChange): Promise<void> {
    return this.write(change)
  }

  async rows(): Promise<ReadonlyArray<ConformanceRow>> {
    const records = await this.database.getAll<Record>(
      `SELECT id, title, note FROM rows ORDER BY id`,
    )
    return records.map(conformanceRow)
  }

  requests(): ReadonlyArray<WriteRequest> {
    return this.log
  }

  /**
   * The propagation step (`propagationStep`: the diff-trigger watch). The
   * adapter reaches its write transaction a few milliseconds after a write,
   * and the watcher runs at most every 30 ms, so the step waits until every
   * write's receipt has settled and the watcher has drained every commit.
   */
  settle = async ({ unsettled }: SettleCut) => {
    const deadline = Date.now() + drainTimeoutMs
    while (Date.now() < deadline) {
      const drainedAll =
        (this.drainTarget === undefined || this.drained >= this.drainTarget) &&
        this.running === 0
      if (unsettled() === 0 && drainedAll) {
        this.drainTarget = undefined
        return
      }
      await sleep(5)
    }
  }

  dispose = async () => {
    await this.database.disconnectAndClear()
    await this.database.close()
    await rm(join(tmpdir(), this.file), { force: true })
  }
}

/** A table row as a conformance row: key `"n"` is row id `n`. */
function conformanceRow(record: Partial<Record>): ConformanceRow {
  return fromSqlRow({ ...record, id: conformanceKey(String(record.id)) })
}

/** A row as the application inserts it: an absent `note` is `null`. */
function record(row: ConformanceRow) {
  const { id, title, note } = toSqlRow(row)
  return { id: String(id), title, note }
}

/**
 * Replaces a held row's fields; a `NULL` note is already absent, so only a
 * held one is removed.
 */
function edit(
  draft: { title?: string | null; note?: string | null },
  row: ConformanceRow,
): void {
  draft.title = row.title
  if (Object.hasOwn(row, `note`)) draft.note = row.note!
  else if (typeof draft.note === `string`)
    (draft as { note?: string | null }).note = undefined
}

export function powerSyncMutationDriver(): MutationDriver {
  return {
    adapter: `@tanstack/powersync-db-collection (eager)`,
    capabilities: new Set([
      `write-rejection`,
      `foreign-commits`,
      `field-updates`,
      `reloads`,
      `atomic-transactions`,
    ]),
    undefinedField: `null`,
    async create(seed): Promise<MutationFixture> {
      const provider = new PowerSyncMutationProvider()
      await provider.seed(seed)
      const collection = createCollection(
        powerSyncCollectionOptions({
          database: provider.database,
          table: SCHEMA.props.rows,
        }),
      )
      const view = observedView(collection, {
        row: conformanceRow,
        key: conformanceKey,
      })
      return {
        collection: view,
        base: () => [...collection.base.values()].map(conformanceRow),
        writer: {
          insert: (row) => collection.insert(record(row)),
          update: (row) =>
            collection.update(String(row.id), (draft) => edit(draft, row)),
          delete: (id) => collection.delete(String(id)),
          batch: (type, rows) => {
            const ids = rows.map((row) => String(row.id))
            return type === `insert`
              ? collection.insert(rows.map(record))
              : type === `update`
                ? collection.update(ids, (drafts) =>
                    drafts.forEach((draft, at) => edit(draft, rows[at]!)),
                  )
                : collection.delete(ids)
          },
        },
        provider,
        settle: provider.settle,
        reload: () => collection.reload(),
        dispose: async () => {
          await collection.cleanup()
          await provider.dispose()
        },
      }
    },
  }
}
