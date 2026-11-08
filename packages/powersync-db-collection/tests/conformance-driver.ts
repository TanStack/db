/**
 * Production driver for the shared eager live-source conformance oracle
 * (`packages/db-adapter-conformance`). It runs the real PowerSync adapter in
 * eager mode over a real local PowerSync database (SQLite through
 * `@powersync/node`), as the other tests in this package do. The provider is
 * that database: the driver writes rows to it with SQL, and the adapter reads
 * them through its own diff triggers and change watcher.
 *
 * The oracle's steps map onto PowerSync like this:
 *
 * - a complete delivery is the initial load. The adapter awaits its public
 *   `onLoad` hook before it establishes tracking and reads the table, so the
 *   driver writes the rows in one write transaction and then resolves the
 *   pending `onLoad`. PowerSync reads its table once per sync run, so the
 *   driver does not declare `complete-snapshot`;
 * - a change batch is one SQLite write transaction: `INSERT` for a key the
 *   provider does not hold, `UPDATE` for one it does, `DELETE` otherwise. The
 *   adapter applies one diff drain as one commit, so the driver declares
 *   `per-batch` commits;
 * - a failure before ready rejects the pending `onLoad`. PowerSync has no
 *   provider failure after ready (the law set gives it no
 *   `terminal-source-end`), so the driver does not declare
 *   `source-failure-after-ready`;
 * - a provider subscription is a change-watcher registration
 *   (`onChangeWithCallback`); its release is the abort of the signal the
 *   adapter passed (LIFE-2, LIFE-10);
 * - the propagation step (`propagationStep`: the diff-trigger watch) is
 *   `settle()`. After a complete delivery it waits until the initial load
 *   created its diff trigger, which it does once its read applied; after a
 *   batch, until the adapter's change callback has run and returned.
 *
 * PowerSync keys are strings, so row `n` is id `"n"`, and the shared
 * `observedView` maps each key back with `conformanceKey`. `note` is a
 * nullable text column, so an absent `note` is SQL `NULL` (`toSqlRow`,
 * `fromSqlRow`). Typed fields (FID-1) are typed columns: the driver writes
 * a boolean as 0 or 1 and a Date as ISO text, the user schemas an app would
 * write decode them, and the view only renames the columns into `typed`.
 * The driver never reads the Collection.
 */
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PowerSyncDatabase, Schema, Table, column } from '@powersync/node'
import { createCollection } from '@tanstack/db'
import { z } from 'zod'
import { powerSyncCollectionOptions } from '../src'
import {
  conformanceKey,
  fromSqlRow,
  observedView,
  toSqlRow,
} from '../../db-adapter-conformance/src'
import { TEST_DATABASE_IMPLEMENTATION } from './test-db-implementation'
import type {
  ConformanceRow,
  ControlledProvider,
  EagerLiveSourceDriver,
  EagerLiveSourceFixture,
  ProviderChange,
} from '../../db-adapter-conformance/src'

// Typed fields (FID-1) live in typed columns: SQLite stores a boolean as
// INTEGER 0 or 1 and a Date as ISO-8601 TEXT, as PowerSync does by default.
const SCHEMA = new Schema({
  rows: new Table({
    title: column.text,
    note: column.text,
    t_string: column.text,
    t_integer: column.integer,
    t_float: column.real,
    t_boolean: column.integer,
    t_date: column.text,
  }),
})

/** The kinds PowerSync's typed columns hold; bigint, -0, and JSON do not fit. */
const FIELD_KINDS = [`string`, `integer`, `float`, `boolean`, `date`] as const

/**
 * The user schemas an app writes for this table: `deserializationSchema`
 * turns SQLite values into the Collection's types, and `schema` validates
 * them. The adapter must apply them on the initial load and every change.
 */
const outputSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  note: z.string().nullable(),
  t_string: z.string(),
  t_integer: z.number(),
  t_float: z.number(),
  t_boolean: z.boolean(),
  t_date: z.date(),
})
const deserializationSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  note: z.string().nullable(),
  t_string: z.string(),
  t_integer: z.number(),
  t_float: z.number(),
  t_boolean: z.number().transform((value) => value === 1),
  t_date: z.string().transform((value) => new Date(value)),
})

/** A conformance row as the SQL columns the provider writes. */
function sqlColumns(row: ConformanceRow): Array<string | number | null> {
  const sql = toSqlRow(row)
  const typed = row.typed ?? {}
  return [
    String(sql.id),
    sql.title,
    sql.note,
    typed.string as string,
    typed.integer as number,
    typed.float as number,
    typed.boolean === true ? 1 : 0,
    (typed.date as Date).toISOString(),
  ]
}

const insertRow = `INSERT INTO rows (id, title, note, t_string, t_integer, t_float, t_boolean, t_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
const updateRow = `UPDATE rows SET title = ?, note = ?, t_string = ?, t_integer = ?, t_float = ?, t_boolean = ?, t_date = ? WHERE id = ?`

type Registration = {
  signal: AbortSignal | undefined
  running: number
  drained: number
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * How long the driver waits for an adapter step (an `onLoad` call, an initial
 * load, a drain) before letting the comparison decide.
 */
const drainTimeoutMs = 2_000

class PowerSyncProvider implements ControlledProvider {
  readonly database: PowerSyncDatabase
  readonly file: string
  private readonly registrations: Array<Registration> = []
  private pendingLoad:
    { resolve: () => void; reject: (error: unknown) => void } | undefined
  private rows = new Map<number, ConformanceRow>()
  // The drain count the latest write must see before the adapter applied it.
  private drainTarget: number | undefined
  // Diff triggers created so far, and the count an initial load must reach:
  // a trigger is created once its initial read applied (`beforeCreate`).
  private triggersCreated = 0
  private triggerTarget: number | undefined

  constructor() {
    if (!TEST_DATABASE_IMPLEMENTATION) {
      throw new Error(`no SQLite implementation is available`)
    }
    this.file = `conformance-${randomUUID()}.sqlite`
    this.database = new PowerSyncDatabase({
      database: {
        dbFilename: this.file,
        dbLocation: tmpdir(),
        implementation: TEST_DATABASE_IMPLEMENTATION,
      },
      schema: SCHEMA,
    })
    // Count the diff triggers the adapter creates.
    const createDiffTrigger = this.database.triggers.createDiffTrigger.bind(
      this.database.triggers,
    )
    this.database.triggers.createDiffTrigger = async (options) => {
      const dispose = await createDiffTrigger(options)
      this.triggersCreated++
      return dispose
    }
    // Record each change-watcher registration the adapter makes, its release
    // signal, and when its change callbacks run.
    const register = this.database.onChangeWithCallback.bind(this.database)
    this.database.onChangeWithCallback = (handler, options) => {
      const registration: Registration = {
        signal: options?.signal,
        running: 0,
        drained: 0,
      }
      this.registrations.push(registration)
      // A real initial read finishes on its own. When the adapter abandons a
      // run whose load is still waiting for the oracle, the gate opens, so
      // cleanup does not wait on a hook no provider would hold.
      options?.signal?.addEventListener(
        `abort`,
        () => {
          const pending = this.pendingLoad
          this.pendingLoad = undefined
          pending?.resolve()
        },
        { once: true },
      )
      return register(
        {
          ...handler,
          onChange: async (event) => {
            registration.running++
            try {
              await handler?.onChange(event)
            } finally {
              registration.running--
              registration.drained++
            }
          },
        },
        options,
      )
    }
  }

  /** The `onLoad` hook: the initial load waits for the oracle's delivery. */
  load = () =>
    new Promise<void>((resolve, reject) => {
      this.pendingLoad = { resolve, reject }
    })

  // The adapter calls `onLoad` asynchronously after the sync run starts.
  private async takePendingLoad() {
    const deadline = Date.now() + drainTimeoutMs
    while (!this.pendingLoad && Date.now() < deadline) await sleep(5)
    const pending = this.pendingLoad
    if (!pending) throw new Error(`the adapter has not called onLoad`)
    this.pendingLoad = undefined
    return pending
  }

  releases = () =>
    this.registrations.map((registration) =>
      registration.signal?.aborted === true ? 1 : 0,
    )

  deliverSnapshot = async (rows: ReadonlyArray<ConformanceRow>) => {
    const pending = await this.takePendingLoad()
    try {
      await this.database.writeTransaction(async (tx) => {
        await tx.execute(`DELETE FROM rows`)
        for (const row of rows) await tx.execute(insertRow, sqlColumns(row))
      })
    } catch (error) {
      // The database refused the rows: the load fails rather than wait.
      pending.reject(error)
      throw error
    }
    this.rows = new Map(rows.map((row) => [row.id, row]))
    this.triggerTarget = this.triggersCreated + 1
    pending.resolve()
  }

  deliverChanges = async (changes: ReadonlyArray<ProviderChange>) => {
    if (changes.length === 0) return
    const registration = this.registrations.at(-1)
    // A drain follows only a write that changes a row: rewriting a row with
    // the values it holds records no diff.
    const before = new Map(this.rows)
    await this.database.writeTransaction(async (tx) => {
      for (const change of changes) {
        if (change.type === `upsert`) {
          const [id, ...columns] = sqlColumns(change.row)
          if (this.rows.has(change.row.id)) {
            await tx.execute(updateRow, [...columns, id!])
          } else {
            await tx.execute(insertRow, [id!, ...columns])
          }
          this.rows.set(change.row.id, change.row)
        } else {
          if (!this.rows.has(change.id)) {
            throw new Error(`provider does not hold row ${change.id}`)
          }
          await tx.execute(`DELETE FROM rows WHERE id = ?`, [String(change.id)])
          this.rows.delete(change.id)
        }
      }
    })
    const changed =
      before.size !== this.rows.size ||
      [...this.rows].some(([id, row]) => {
        const held = before.get(id)
        return (
          held === undefined ||
          JSON.stringify(sqlColumns(held)) !== JSON.stringify(sqlColumns(row))
        )
      })
    if (registration && changed) this.drainTarget = registration.drained + 1
  }

  fail = async (error: Error) => {
    const pending = await this.takePendingLoad()
    pending.reject(error)
  }

  /**
   * The propagation step: after a complete delivery, the initial load that
   * reads it has created its diff trigger; after a batch, the change callback
   * that follows the write ran.
   */
  settle = async () => {
    const registration = this.registrations.at(-1)
    const loadTarget = this.triggerTarget
    if (loadTarget !== undefined) {
      this.triggerTarget = undefined
      const deadline = Date.now() + drainTimeoutMs
      while (
        this.triggersCreated < loadTarget &&
        registration?.signal?.aborted !== true &&
        Date.now() < deadline
      ) {
        await sleep(5)
      }
      // Readiness follows the trigger by a few microtasks.
      for (let turn = 0; turn < 3; turn++) await sleep(0)
    }
    const target = this.drainTarget
    if (target === undefined) return
    this.drainTarget = undefined
    if (!registration) return
    const deadline = Date.now() + drainTimeoutMs
    while (
      (registration.drained < target || registration.running > 0) &&
      registration.signal?.aborted !== true &&
      Date.now() < deadline
    ) {
      await sleep(5)
    }
  }

  dispose = async () => {
    await this.database.disconnectAndClear()
    await this.database.close()
    await rm(join(tmpdir(), this.file), { force: true })
  }
}

type PowerSyncRow = z.infer<typeof outputSchema>

/** A Collection row as a conformance row: typed columns become `typed`. */
function conformanceRow({
  t_string,
  t_integer,
  t_float,
  t_boolean,
  t_date,
  ...row
}: PowerSyncRow): ConformanceRow {
  return fromSqlRow({
    ...row,
    id: conformanceKey(row.id),
    typed: {
      string: t_string,
      integer: t_integer,
      float: t_float,
      boolean: t_boolean,
      date: t_date,
    },
  })
}

export function powerSyncConformanceDriver(): EagerLiveSourceDriver {
  return {
    adapter: `@tanstack/powersync-db-collection (eager)`,
    capabilities: new Set(),
    changeCommits: `per-batch`,
    fieldKinds: FIELD_KINDS,
    // PowerSync's storage keeps a number at 15 significant digits: through
    // its table views, 9007199254740991 reads back as 9007199254740990 and
    // 0.30000000000000004 as 0.3, and Number.MAX_VALUE is rejected
    // ("powersync_diff: number out of range"). A platform limit, not the
    // adapter's: the Collection shows what the database stored.
    excludesValue: (_kind, value) =>
      typeof value === `number` && Number(value.toPrecision(15)) !== value,
    // PowerSync reports a failed start through its logger (law set
    // capability `logger`).
    declaredDiagnostic: (_level, args) =>
      args.some((arg) => String(arg).includes(`Could not start syncing`)),
    create(): EagerLiveSourceFixture {
      const provider = new PowerSyncProvider()
      const collection = createCollection(
        powerSyncCollectionOptions({
          database: provider.database,
          table: SCHEMA.props.rows,
          schema: outputSchema,
          deserializationSchema,
          onDeserializationError: () => {},
          onLoad: provider.load,
        }),
      )
      return {
        collection: observedView(collection, {
          row: conformanceRow,
          key: conformanceKey,
        }),
        provider,
        settle: provider.settle,
        dispose: provider.dispose,
      }
    },
  }
}
