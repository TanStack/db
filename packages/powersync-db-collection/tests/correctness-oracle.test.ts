/**
 * # Does a PowerSync Collection preserve the database's independent truth?
 *
 * Collection updates change only their authored fields. A newer disjoint
 * SQLite field must survive. Persistence waits for diff observation of each
 * Collection's effective writes. A direct transactor probe also covers a
 * synthetic trailing no-op and tracked metadata-only mutation;
 * Collection.update does not create these zero-field mutations. Public rows
 * expose exactly the declared PowerSync view, and equality compares transformed
 * schema output rather than raw SQLite rows.
 *
 * The PowerSync Collection guide promises SQLite mirroring and transaction
 * persistence; the public PowerSyncTransactor API persists the whole
 * Transaction. These tests stop at local SQLite and Collection observation,
 * not remote backend upload.
 *
 * The reference laws are small: compose disjoint patches by changed field,
 * derive readable keys from the declared view, and derive public values from
 * the supplied Standard Schema. The production path uses a real native SQLite
 * database, PowerSync CRUD rows, Collection sync, watcher callbacks, and the
 * adapter comparator. A held watcher is the only timing control.
 *
 * The pure tests calibrate comparisons and cleanup failure reporting. The
 * production tests reach native SQLite before comparing rows, patches,
 * metadata, logging, or cleanup.
 * Held callbacks test the adapter after controlled delivery; unmocked writes
 * exercise the native watcher. The suite skips when the native test database
 * implementation is unavailable.
 */
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import {
  LogLevels,
  PowerSyncDatabase,
  Schema,
  Table,
  column,
} from '@powersync/node'
import { createCollection, createTransaction } from '@tanstack/db'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { powerSyncCollectionOptions } from '../src'
import { PowerSyncTransactor } from '../src/PowerSyncTransactor'
import { TEST_DATABASE_IMPLEMENTATION } from './test-db-implementation'
import type { WatchOnChangeHandler } from '@powersync/common'
import type { PowerSyncLogger } from '@powersync/node'

const describePowerSync = TEST_DATABASE_IMPLEMENTATION
  ? describe
  : describe.skip

type CrudRow = { data: string }

async function createDatabase(schema: Schema, logger?: PowerSyncLogger) {
  const db = new PowerSyncDatabase({
    schema,
    database: {
      dbFilename: `correctness-oracle-${randomUUID()}.sqlite`,
      dbLocation: tmpdir(),
      implementation: TEST_DATABASE_IMPLEMENTATION,
    },
    logger,
  })
  await db.disconnectAndClear()
  return db
}

function holdAdapterChanges(db: PowerSyncDatabase) {
  const handlers = new Map<string, WatchOnChangeHandler>()
  vi.spyOn(db, `onChangeWithCallback`).mockImplementation(
    (candidate, options) => {
      const table = options?.tables?.[0]
      if (!table) throw new Error(`adapter did not name a tracked table`)
      if (!candidate)
        throw new Error(`adapter did not register a change handler`)
      handlers.set(table, candidate)
      return () => {}
    },
  )
  return {
    expectReached: (table?: string) =>
      expect(table ? handlers.has(table) : handlers.size > 0).toBe(true),
    flush: async (table?: string) => {
      const watchedTable = table ?? handlers.keys().next().value
      if (watchedTable === undefined)
        throw new Error(`adapter did not register a tracked table`)
      const handler = handlers.get(watchedTable)
      if (!handler)
        throw new Error(`adapter did not register its change handler`)
      await handler.onChange({ changedTables: [watchedTable] })
    },
  }
}

function observeUpdate(
  sqliteRow: { assignee: string | null; done: number },
  patch: { op: string; data: Record<string, unknown> },
) {
  return { sqliteRow, patch: { op: patch.op, data: patch.data } }
}

function observeViewKeys(
  viewRow: Record<string, unknown>,
  collectionRow: Record<string, unknown>,
) {
  return {
    view: Object.keys(viewRow).sort(),
    collection: Object.keys(collectionRow)
      .filter((key) => !key.startsWith(`$`))
      .sort(),
  }
}

async function cleanupAfterOracle(
  failure: { error: unknown } | undefined,
  cleanups: Array<() => Promise<unknown> | unknown>,
): Promise<void> {
  const cleanupErrors: Array<unknown> = []
  for (const cleanup of cleanups) {
    try {
      await cleanup()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      failure
        ? `Oracle failed and cleanup also failed`
        : `Oracle cleanup failed`,
      failure ? { cause: failure.error } : undefined,
    )
  }
}

describePowerSync(`PowerSync correctness oracle`, () => {
  afterEach(() => vi.restoreAllMocks())

  it(`rejects stale full-row patches and undeclared public keys`, () => {
    expect(
      observeUpdate(
        { assignee: null, done: 1 },
        { op: `PATCH`, data: { assignee: null, done: 1 } },
      ),
    ).not.toEqual(
      observeUpdate(
        { assignee: `alice`, done: 1 },
        { op: `PATCH`, data: { done: 1 } },
      ),
    )
    expect(
      observeViewKeys(
        { id: `t1`, title: `Write report` },
        { id: `t1`, title: `Write report`, priority: `high` },
      ),
    ).not.toEqual({
      view: [`id`, `title`],
      collection: [`id`, `title`],
    })
  })

  it(`retains the primary oracle failure and each cleanup failure`, async () => {
    let primary: unknown
    try {
      expect({ id: `wrong` }).toEqual({ id: `expected` })
    } catch (error) {
      primary = error
    }
    expect(primary).toBeInstanceOf(Error)
    const firstCleanup = new Error(`Collection cleanup failed`)
    const secondCleanup = new Error(`database close failed`)
    const attempted: Array<string> = []
    let reported: unknown

    try {
      await cleanupAfterOracle({ error: primary }, [
        () => {
          attempted.push(`Collection`)
          throw firstCleanup
        },
        () => {
          attempted.push(`database`)
          throw secondCleanup
        },
      ])
    } catch (error) {
      reported = error
    }

    expect(attempted).toEqual([`Collection`, `database`])
    expect(reported).toBeInstanceOf(AggregateError)
    expect((reported as AggregateError).cause).toBe(primary)
    expect((reported as AggregateError).errors).toEqual([
      firstCleanup,
      secondCleanup,
    ])
  })

  it(`preserves a newer disjoint SQLite field across a collection update`, async () => {
    const schema = new Schema({
      todos: new Table({
        title: column.text,
        assignee: column.text,
        done: column.integer,
      }),
    })
    const db = await createDatabase(schema)
    await db.execute(
      `INSERT INTO todos (id, title, assignee, done) VALUES ('t1', 'Write report', NULL, 0)`,
    )
    const heldChanges = holdAdapterChanges(db)
    const collection = createCollection(
      powerSyncCollectionOptions({
        database: db,
        table: schema.props.todos,
      }),
    )

    let failure: { error: unknown } | undefined
    try {
      await collection.preload()
      heldChanges.expectReached()

      await db.execute(`UPDATE todos SET assignee = 'alice' WHERE id = 't1'`)
      expect(collection.get(`t1`)?.assignee).toBeNull()

      const transaction = collection.update(`t1`, (draft) => {
        draft.done = 1
      })

      let rowBeforeFlush: { assignee: string | null; done: number } | null =
        null
      await vi.waitFor(async () => {
        rowBeforeFlush = await db.get<{
          assignee: string | null
          done: number
        }>(`SELECT assignee, done FROM todos WHERE id = 't1'`)
        expect(rowBeforeFlush.done).toBe(1)
      })

      await heldChanges.flush()
      await transaction.isPersisted.promise

      const crud = await db.getAll<CrudRow>(
        `SELECT data FROM ps_crud ORDER BY id`,
      )
      const finalPatch = JSON.parse(crud.at(-1)!.data) as {
        op: string
        data: Record<string, unknown>
      }

      expect(observeUpdate(rowBeforeFlush!, finalPatch)).toEqual(
        observeUpdate(
          { assignee: `alice`, done: 1 },
          { op: `PATCH`, data: { done: 1 } },
        ),
      )
    } catch (error) {
      failure = { error }
      throw error
    } finally {
      await cleanupAfterOracle(failure, [
        () => collection.cleanup(),
        () => db.disconnectAndClear(),
        () => db.close(),
      ])
    }
  })

  it(`direct transactor waits for an effective update before a synthetic trailing no-op`, async () => {
    const schema = new Schema({
      todos: new Table({ title: column.text, done: column.integer }),
    })
    const db = await createDatabase(schema)
    await db.execute(
      `INSERT INTO todos (id, title, done) VALUES ('t1', 'Write report', 0)`,
    )
    const heldChanges = holdAdapterChanges(db)
    const collection = createCollection(
      powerSyncCollectionOptions({ database: db, table: schema.props.todos }),
    )

    const transaction = createTransaction({
      autoCommit: false,
      mutationFn: async () => {},
    })
    let failure: { error: unknown } | undefined
    try {
      await collection.preload()
      heldChanges.expectReached()
      transaction.mutate(() =>
        collection.update(`t1`, (draft) => {
          draft.done = 1
        }),
      )
      const effective = transaction.mutations[0]!
      const trailingNoop = {
        ...effective,
        mutationId: `${effective.mutationId}-noop`,
        original: effective.modified,
        changes: {},
      }
      const transactor = new PowerSyncTransactor({ database: db })
      let settled = false
      const persistence = transactor
        .applyTransaction({
          mutations: [effective, trailingNoop],
        } as never)
        .then(() => {
          settled = true
        })

      await vi.waitFor(async () => {
        expect(
          await db.get<{ done: number }>(
            `SELECT done FROM todos WHERE id = 't1'`,
          ),
        ).toEqual({ done: 1 })
      })
      for (let turn = 0; turn < 10; turn++) await Promise.resolve()
      expect(settled).toBe(false)

      await heldChanges.flush()
      await persistence
      expect(settled).toBe(true)
    } catch (error) {
      failure = { error }
      throw error
    } finally {
      await cleanupAfterOracle(failure, [
        () => transaction.rollback(),
        () => collection.cleanup(),
        () => db.disconnectAndClear(),
        () => db.close(),
      ])
    }
  })

  it(`waits for both Collections in a mixed transaction after one watcher flushes`, async () => {
    const schema = new Schema({
      todos: new Table({ done: column.integer }),
      labels: new Table({ name: column.text }),
    })
    const db = await createDatabase(schema)
    await db.execute(`INSERT INTO todos (id, done) VALUES ('t1', 0)`)
    await db.execute(`INSERT INTO labels (id, name) VALUES ('l1', 'before')`)
    const heldChanges = holdAdapterChanges(db)
    const todos = createCollection(
      powerSyncCollectionOptions({ database: db, table: schema.props.todos }),
    )
    const labels = createCollection(
      powerSyncCollectionOptions({ database: db, table: schema.props.labels }),
    )
    const transaction = createTransaction({
      autoCommit: false,
      mutationFn: async () => {},
    })

    let failure: { error: unknown } | undefined
    try {
      await todos.preload()
      await labels.preload()
      const todosTracking = todos.utils.getMeta().trackedTableName
      const labelsTracking = labels.utils.getMeta().trackedTableName
      heldChanges.expectReached(todosTracking)
      heldChanges.expectReached(labelsTracking)
      transaction.mutate(() => {
        todos.update(`t1`, (draft) => {
          draft.done = 1
        })
        labels.update(`l1`, (draft) => {
          draft.name = `after`
        })
      })
      expect(
        transaction.mutations.map((mutation) => mutation.collection.id),
      ).toEqual([todos.id, labels.id])

      const persistenceState = {
        outcome: `pending` as `pending` | `fulfilled` | `rejected`,
        error: undefined as unknown,
      }
      const persistence = new PowerSyncTransactor({ database: db })
        .applyTransaction(transaction)
        .then(
          () => {
            persistenceState.outcome = `fulfilled`
          },
          (error: unknown) => {
            persistenceState.outcome = `rejected`
            persistenceState.error = error
          },
        )

      await vi.waitFor(async () => {
        expect(
          await db.get<{ done: number }>(
            `SELECT done FROM todos WHERE id = 't1'`,
          ),
        ).toEqual({ done: 1 })
        expect(
          await db.get<{ name: string }>(
            `SELECT name FROM labels WHERE id = 'l1'`,
          ),
        ).toEqual({ name: `after` })
      })

      // Waiting only for the globally final mutation would settle here.
      await heldChanges.flush(labelsTracking)
      for (let turn = 0; turn < 10; turn++) await Promise.resolve()
      expect(persistenceState.outcome).toBe(`pending`)

      await heldChanges.flush(todosTracking)
      await persistence
      expect(persistenceState).toEqual({
        outcome: `fulfilled`,
        error: undefined,
      })
    } catch (error) {
      failure = { error }
      throw error
    } finally {
      await cleanupAfterOracle(failure, [
        () => transaction.rollback(),
        () => todos.cleanup(),
        () => labels.cleanup(),
        () => db.disconnectAndClear(),
        () => db.close(),
      ])
    }
  })

  it(`direct transactor persists a synthetic tracked metadata-only mutation and waits for its diff`, async () => {
    const schema = new Schema({
      todos: new Table(
        { title: column.text, done: column.integer },
        { trackMetadata: true },
      ),
    })
    const db = await createDatabase(schema)
    await db.execute(
      `INSERT INTO todos (id, title, done) VALUES ('t1', 'Write report', 0)`,
    )
    const heldChanges = holdAdapterChanges(db)
    const collection = createCollection(
      powerSyncCollectionOptions({ database: db, table: schema.props.todos }),
    )
    const transaction = createTransaction({
      autoCommit: false,
      mutationFn: async () => {},
    })

    let failure: { error: unknown } | undefined
    try {
      await collection.preload()
      heldChanges.expectReached()
      transaction.mutate(() =>
        collection.update(`t1`, (draft) => {
          draft.done = 1
        }),
      )
      const template = transaction.mutations[0]!
      const metadata = { source: `correctness-oracle` }
      const metadataOnly = {
        ...template,
        mutationId: `${template.mutationId}-metadata`,
        modified: template.original,
        changes: {},
        metadata,
      }
      const transactor = new PowerSyncTransactor({ database: db })
      let settled = false
      const persistence = transactor
        .applyTransaction({ mutations: [metadataOnly] } as never)
        .then(() => {
          settled = true
        })

      await vi.waitFor(async () => {
        const batch = await db.getCrudBatch(100)
        expect(batch?.crud.at(-1)?.metadata).toBe(JSON.stringify(metadata))
      })
      for (let turn = 0; turn < 10; turn++) await Promise.resolve()
      expect(settled).toBe(false)

      await heldChanges.flush()
      await persistence
      expect(settled).toBe(true)
    } catch (error) {
      failure = { error }
      throw error
    } finally {
      await cleanupAfterOracle(failure, [
        () => transaction.rollback(),
        () => collection.cleanup(),
        () => db.disconnectAndClear(),
        () => db.close(),
      ])
    }
  })

  it(`persists explicit falsey field changes without treating them as absent`, async () => {
    const schema = new Schema({
      flags: new Table({
        label: column.text,
        note: column.text,
        count: column.integer,
        active: column.integer,
      }),
    })
    const db = await createDatabase(schema)
    await db.execute(
      `INSERT INTO flags (id, label, note, count, active) VALUES ('f1', 'before', 'owner', 1, 1)`,
    )
    const outputSchema = z.object({
      id: z.string(),
      label: z.string().nullable(),
      note: z.string().nullable(),
      count: z.number().nullable(),
      active: z.boolean().nullable(),
    })
    const collection = createCollection(
      powerSyncCollectionOptions({
        database: db,
        table: schema.props.flags,
        schema: outputSchema,
        deserializationSchema: z.object({
          id: z.string(),
          label: z.string().nullable(),
          note: z.string().nullable(),
          count: z.number().nullable(),
          active: z
            .number()
            .nullable()
            .transform((value) => (value == null ? null : value !== 0)),
        }),
        onDeserializationError: () => {},
      }),
    )

    let failure: { error: unknown } | undefined
    try {
      await collection.preload()
      await collection.update(`f1`, (draft) => {
        draft.label = ``
        draft.note = null
        draft.count = 0
        draft.active = false
      }).isPersisted.promise

      const crud = await db.getAll<CrudRow>(
        `SELECT data FROM ps_crud ORDER BY id`,
      )
      const patch = JSON.parse(crud.at(-1)!.data) as {
        op: string
        data: Record<string, unknown>
      }
      expect({ op: patch.op, data: patch.data }).toEqual({
        op: `PATCH`,
        data: { label: ``, note: null, count: 0, active: 0 },
      })
    } catch (error) {
      failure = { error }
      throw error
    } finally {
      await cleanupAfterOracle(failure, [
        () => collection.cleanup(),
        () => db.disconnectAndClear(),
        () => db.close(),
      ])
    }
  })

  it(`initializes and cleans up with a structured logger`, async () => {
    const schema = new Schema({ todos: new Table({ title: column.text }) })
    const records: Array<{
      level: number
      message: string
      error?: unknown
    }> = []
    const db = await createDatabase(schema, {
      log: (record) => records.push(record),
    })
    await db.execute(`INSERT INTO todos (id, title) VALUES ('t1', 'before')`)
    const collection = createCollection(
      powerSyncCollectionOptions({ database: db, table: schema.props.todos }),
    )
    const ignoredMetadata = { ignored: true }

    let failure: { error: unknown } | undefined
    try {
      await collection.preload()
      await collection.update(`t1`, { metadata: ignoredMetadata }, (draft) => {
        draft.title = `after`
      }).isPersisted.promise
      await collection.cleanup()

      expect(
        records.some(
          (record) =>
            record.level === LogLevels.info &&
            record.message.includes(`Sync is ready`),
        ),
      ).toBe(true)
      expect(
        records.some(
          (record) =>
            record.level === LogLevels.warn &&
            record.message.includes(`does not track metadata`) &&
            record.error === ignoredMetadata,
        ),
      ).toBe(true)
      expect(
        records.some(
          (record) =>
            record.level === LogLevels.info &&
            record.message.includes(`Sync has been stopped`),
        ),
      ).toBe(true)
      expect(
        records.filter((record) => record.level >= LogLevels.error),
      ).toEqual([])
    } catch (error) {
      failure = { error }
      throw error
    } finally {
      await cleanupAfterOracle(failure, [
        () => collection.cleanup(),
        () => db.disconnectAndClear(),
        () => db.close(),
      ])
    }
  })

  it(`keeps collection keys congruent with the declared PowerSync view`, async () => {
    const schema = new Schema({ todos: new Table({ title: column.text }) })
    const db = await createDatabase(schema)
    await db.execute(
      `INSERT INTO todos (id, title) VALUES ('t1', 'Write report')`,
    )
    const heldChanges = holdAdapterChanges(db)
    const createDiffTrigger = vi.spyOn(db.triggers, `createDiffTrigger`)
    const collection = createCollection(
      powerSyncCollectionOptions({
        database: db,
        table: schema.props.todos,
      }),
    )

    let failure: { error: unknown } | undefined
    try {
      await collection.preload()
      heldChanges.expectReached()
      expect(createDiffTrigger).toHaveBeenCalled()
      expect(createDiffTrigger.mock.calls[0]![0].columns).toEqual([`title`])

      await db.writeTransaction(async (tx) => {
        await tx.execute(
          `UPDATE ps_data__todos SET data = json_set(data, '$.priority', 'high', '$.title', NULL) WHERE id = 't1'`,
        )
      })
      await heldChanges.flush()

      const viewRow = await db.get<Record<string, unknown>>(
        `SELECT * FROM todos WHERE id = 't1'`,
      )
      const collectionRow = collection.get(`t1`) as unknown as Record<
        string,
        unknown
      >
      expect(viewRow.title).toBeNull()
      expect(collectionRow.title).toBeNull()

      let persistenceError: unknown
      const persistenceState = { settled: false }
      const persistence = collection
        .update(`t1`, (draft) => {
          draft.title = `Write report today`
        })
        .isPersisted.promise.catch((error: unknown) => {
          persistenceError = error
        })
        .finally(() => {
          persistenceState.settled = true
        })

      await vi.waitFor(async () => {
        const row = await db.get<{ title: string }>(
          `SELECT title FROM todos WHERE id = 't1'`,
        )
        expect(
          persistenceState.settled || row.title === `Write report today`,
        ).toBe(true)
      })
      if (!persistenceState.settled) await heldChanges.flush()
      await persistence

      expect(observeViewKeys(viewRow, collectionRow)).toEqual({
        view: [`id`, `title`],
        collection: [`id`, `title`],
      })
      expect(collectionRow).not.toHaveProperty(`priority`)
      expect(persistenceError).toBeUndefined()
    } catch (error) {
      failure = { error }
      throw error
    } finally {
      await cleanupAfterOracle(failure, [
        () => collection.cleanup(),
        () => db.disconnectAndClear(),
        () => db.close(),
      ])
    }
  })

  it(`passes an empty declared-column list for an id-only table`, async () => {
    const schema = new Schema({ ids: new Table({}) })
    const db = await createDatabase(schema)
    const createDiffTrigger = vi.spyOn(db.triggers, `createDiffTrigger`)
    const collection = createCollection(
      powerSyncCollectionOptions({ database: db, table: schema.props.ids }),
    )

    let failure: { error: unknown } | undefined
    try {
      await collection.preload()
      expect(createDiffTrigger).toHaveBeenCalled()
      expect(createDiffTrigger.mock.calls[0]![0].columns).toEqual([])
    } catch (error) {
      failure = { error }
      throw error
    } finally {
      await cleanupAfterOracle(failure, [
        () => collection.cleanup(),
        () => db.disconnectAndClear(),
        () => db.close(),
      ])
    }
  })

  it(`compares transformed schema output rather than raw SQLite rows`, async () => {
    const schema = new Schema({
      todos: new Table({
        title: column.text,
        created_at: column.text,
      }),
    })
    const db = await createDatabase(schema)
    await db.execute(
      `INSERT INTO todos (id, title, created_at) VALUES ('newer', 'newer', '2024-06-01T00:00:00.000Z')`,
    )
    await db.execute(
      `INSERT INTO todos (id, title, created_at) VALUES ('older', 'older', '2024-01-01T00:00:00.000Z')`,
    )
    await db.execute(
      `INSERT INTO todos (id, title, created_at) VALUES ('undated', 'undated', NULL)`,
    )
    const compare = vi.fn(
      (left: Date | null, right: Date | null) =>
        (left?.getTime() ?? Number.NEGATIVE_INFINITY) -
        (right?.getTime() ?? Number.NEGATIVE_INFINITY),
    )
    const collection = createCollection(
      powerSyncCollectionOptions({
        database: db,
        table: schema.props.todos,
        schema: z.object({
          id: z.string(),
          title: z.string().nullable(),
          created_at: z
            .string()
            .nullable()
            .transform((value) => (value ? new Date(value) : null)),
        }),
        onDeserializationError: () => {},
        compare: (left, right) => compare(left.created_at, right.created_at),
      }),
    )

    let failure: { error: unknown } | undefined
    try {
      await expect(collection.preload()).resolves.toBeUndefined()
      expect(compare).toHaveBeenCalled()
      expect([...collection.keys()]).toEqual([`undated`, `older`, `newer`])
    } catch (error) {
      failure = { error }
      throw error
    } finally {
      await cleanupAfterOracle(failure, [
        () => collection.cleanup(),
        () => db.disconnectAndClear(),
        () => db.close(),
      ])
    }
  })
})
