/**
 * Laws: collection updates conserve independent SQLite fields; collection rows
 * expose the declared PowerSync view; comparison observes schema output.
 *
 * Reference: disjoint logical changes are composed from their changed fields,
 * PowerSync's declared SQLite view defines the readable keys, and the supplied
 * Standard Schema defines collection output values.
 *
 * Production path: a real node database, real collection sync, the registered
 * watcher callback, PowerSync CRUD rows, and the collection comparator.
 * The held watcher is the only timing control; assertions run after explicitly
 * releasing it. Each test proves path reach before comparing the full promised
 * observation. The comparison-sensitivity test rejects the historical stale
 * full-row patch and undeclared public key without invoking production.
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

async function createDatabase(
  schema: Schema,
  logger?: PowerSyncLogger,
) {
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
  let handler: WatchOnChangeHandler | undefined
  vi.spyOn(db, `onChangeWithCallback`).mockImplementation((candidate) => {
    handler = candidate
    return () => {}
  })
  return {
    expectReached: () => expect(handler).toBeDefined(),
    flush: async () => {
      if (!handler)
        throw new Error(`adapter did not register its change handler`)
      await handler.onChange({ changedTables: [] })
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
    } finally {
      await collection.cleanup()
      await db.disconnectAndClear()
      await db.close()
    }
  })

  it(`waits for the last effective update when a trailing update changes nothing`, async () => {
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
    } finally {
      transaction.rollback()
      await collection.cleanup()
      await db.disconnectAndClear()
      await db.close()
    }
  })

  it(`persists a tracked metadata-only update and waits for its diff`, async () => {
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
    } finally {
      transaction.rollback()
      await collection.cleanup()
      await db.disconnectAndClear()
      await db.close()
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
    } finally {
      await collection.cleanup()
      await db.disconnectAndClear()
      await db.close()
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
    } finally {
      await collection.cleanup()
      await db.disconnectAndClear()
      await db.close()
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
    } finally {
      await collection.cleanup()
      await db.disconnectAndClear()
      await db.close()
    }
  })

  it(`passes an empty declared-column list for an id-only table`, async () => {
    const schema = new Schema({ ids: new Table({}) })
    const db = await createDatabase(schema)
    const createDiffTrigger = vi.spyOn(db.triggers, `createDiffTrigger`)
    const collection = createCollection(
      powerSyncCollectionOptions({ database: db, table: schema.props.ids }),
    )

    try {
      await collection.preload()
      expect(createDiffTrigger).toHaveBeenCalled()
      expect(createDiffTrigger.mock.calls[0]![0].columns).toEqual([])
    } finally {
      await collection.cleanup()
      await db.disconnectAndClear()
      await db.close()
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

    try {
      await expect(collection.preload()).resolves.toBeUndefined()
      expect(compare).toHaveBeenCalled()
      expect([...collection.keys()]).toEqual([`undated`, `older`, `newer`])
    } finally {
      await collection.cleanup()
      await db.disconnectAndClear()
      await db.close()
    }
  })
})
