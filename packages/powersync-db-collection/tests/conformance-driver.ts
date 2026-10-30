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
 * `fromSqlRow`). The driver never reads the Collection.
 */
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PowerSyncDatabase, Schema, Table, column } from '@powersync/node'
import { createCollection } from '@tanstack/db'
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

const SCHEMA = new Schema({
  rows: new Table({ title: column.text, note: column.text }),
})

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
    await this.database.writeTransaction(async (tx) => {
      await tx.execute(`DELETE FROM rows`)
      for (const row of rows) {
        const sql = toSqlRow(row)
        await tx.execute(
          `INSERT INTO rows (id, title, note) VALUES (?, ?, ?)`,
          [String(sql.id), sql.title, sql.note],
        )
      }
    })
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
          const sql = toSqlRow(change.row)
          if (this.rows.has(change.row.id)) {
            await tx.execute(
              `UPDATE rows SET title = ?, note = ? WHERE id = ?`,
              [sql.title, sql.note, String(sql.id)],
            )
          } else {
            await tx.execute(
              `INSERT INTO rows (id, title, note) VALUES (?, ?, ?)`,
              [String(sql.id), sql.title, sql.note],
            )
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
        return held?.title !== row.title || held.note !== row.note
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

type PowerSyncRow = {
  id: string
  title?: string | null
  note?: string | null
}

export function powerSyncConformanceDriver(): EagerLiveSourceDriver {
  return {
    adapter: `@tanstack/powersync-db-collection (eager)`,
    capabilities: new Set(),
    changeCommits: `per-batch`,
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
          onLoad: provider.load,
        }),
      )
      return {
        collection: observedView(collection, {
          row: (row: PowerSyncRow) =>
            fromSqlRow({ ...row, id: conformanceKey(row.id) }),
          key: conformanceKey,
        }),
        provider,
        settle: provider.settle,
        dispose: provider.dispose,
      }
    },
  }
}
