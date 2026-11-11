import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import {
  LogLevels,
  PowerSyncDatabase,
  Schema,
  Table,
  column,
} from '@powersync/node'
import { IR, createCollection } from '@tanstack/db'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { compileSQLite, powerSyncCollectionOptions } from '../src'
import type { PowerSyncLogger } from '@powersync/node'

// SQLite stores every PowerSync id as text. A backend with integer primary
// keys sets `numericIds` and converts `id` to a number in
// `deserializationSchema`, so the collection key is the deserialized number
// and integer foreign keys match it. Every path that writes a key must use
// that number, and every path that filters by `id` must compare numbers.

const APP_SCHEMA = new Schema({
  products: new Table({ name: column.text, category: column.text }),
})

const row = z.object({
  id: z.number(),
  name: z.string().nullable(),
  category: z.string().nullable(),
})
// Rows read from SQLite carry the id as text.
const sqliteRow = row.extend({ id: z.coerce.number<string>() })

const categoryEquals = (category: string) =>
  new IR.Func<boolean>(`eq`, [
    new IR.PropRef([`category`]),
    new IR.Value(category),
  ])

const idGreaterThan = (id: number) =>
  new IR.Func<boolean>(`gt`, [new IR.PropRef([`id`]), new IR.Value(id)])
const idEquals = (id: number) =>
  new IR.Func<boolean>(`eq`, [new IR.PropRef([`id`]), new IR.Value(id)])
const idIn = (ids: Array<number>) =>
  new IR.Func<boolean>(`in`, [new IR.PropRef([`id`]), new IR.Value(ids)])

async function createDatabase() {
  const errors: Array<string> = []
  const logger: PowerSyncLogger = {
    log({ level, message }) {
      if (level >= LogLevels.error) errors.push(message)
    },
  }
  const db = new PowerSyncDatabase({
    database: {
      dbFilename: `test-numeric-keys-${randomUUID()}.sqlite`,
      dbLocation: tmpdir(),
      implementation: { type: `node:sqlite` },
    },
    schema: APP_SCHEMA,
    logger,
  })
  onTestFinished(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100))
    await db.disconnectAndClear()
    await db.close()
  })
  await db.disconnectAndClear()
  await db.execute(
    `INSERT INTO products (id, name, category) VALUES ('1', 'A', 'x'), ('2', 'B', 'x'), ('3', 'C', 'y')`,
  )
  return { db, errors }
}

function createNumericCollection(
  db: PowerSyncDatabase,
  syncMode: `eager` | `on-demand`,
) {
  const collection = createCollection(
    powerSyncCollectionOptions({
      database: db,
      table: APP_SCHEMA.props.products,
      schema: row,
      deserializationSchema: sqliteRow,
      onDeserializationError: () => {},
      numericIds: true,
      syncMode,
    }),
  )
  onTestFinished(() => collection.cleanup())
  return collection
}

describe(`numeric collection keys`, () => {
  it.each([`007`, `9007199254740993`])(
    `rejects a stored ID that cannot round-trip as a numeric key (%s)`,
    async (id) => {
      const { db } = await createDatabase()
      await db.execute(
        `INSERT INTO products (id, name, category) VALUES (?, 'D', 'invalid')`,
        [id],
      )
      const collection = createNumericCollection(db, `on-demand`)
      await expect(
        Promise.resolve(
          collection._sync.loadSubset({ where: categoryEquals(`invalid`) }),
        ),
      ).rejects.toThrow(/canonical safe integer/)
      expect(collection.size).toBe(0)
    },
  )

  it(`syncs and writes rows keyed by a deserialized number`, async () => {
    const { db, errors } = await createDatabase()
    const collection = createNumericCollection(db, `eager`)
    await collection.stateWhenReady()
    expect([...collection.keys()].sort()).toEqual([1, 2, 3])

    await db.execute(`UPDATE products SET name = 'A2' WHERE id = '1'`)
    await db.execute(`DELETE FROM products WHERE id = '3'`)
    await vi.waitFor(() => {
      expect(collection.get(1)?.name).toBe(`A2`)
      expect(collection.has(3)).toBe(false)
    })

    await collection
      .update(1, (draft) => {
        draft.name = `A3`
      })
      .when(`settled`)
    await collection.delete(2).when(`settled`)
    expect(await db.getAll(`SELECT id, name FROM products`)).toEqual([
      { id: `1`, name: `A3` },
    ])
    expect(errors).toEqual([])
  })

  it(`reloads held rows as updates and evicts them by numeric key`, async () => {
    const { db, errors } = await createDatabase()
    const collection = createNumericCollection(db, `on-demand`)
    const first = { where: categoryEquals(`x`) }
    await collection._sync.loadSubset(first)
    expect([...collection.keys()].sort()).toEqual([1, 2])

    // Tracking for the second load re-reads every active predicate, so it
    // re-reads the held rows: each must be an update, not an insert.
    const second = { where: categoryEquals(`y`) }
    await collection._sync.loadSubset(second)
    expect([...collection.keys()].sort()).toEqual([1, 2, 3])

    collection._sync.unloadSubset(second)
    await vi.waitFor(() =>
      expect([...collection.keys()].sort()).toEqual([1, 2]),
    )
    collection._sync.unloadSubset(first)
    await vi.waitFor(() => expect(collection.size).toBe(0))
    expect(errors).toEqual([])
  })

  // As text, '10' < '2', and a stored text id is never equal to a number.
  // The subset load, the trigger that tracks later writes, and eviction must
  // all compare ids as numbers. Each predicate below matches 3, 10, and 100
  // among the ids 1, 2, 3, 10, then 0 and 100.
  it.each([
    [`gt(id, 2)`, idGreaterThan(2), [3, 10]],
    [`in(id, [3, 10, 100])`, idIn([3, 10, 100]), [3, 10]],
    [`eq(id, 100)`, idEquals(100), []],
  ])(
    `compares ids as numbers when loading, tracking, and evicting: %s`,
    async (_, where, loaded) => {
      const { db, errors } = await createDatabase()
      await db.execute(
        `INSERT INTO products (id, name, category) VALUES ('10', 'E', 'z')`,
      )
      const collection = createNumericCollection(db, `on-demand`)
      const subset = { where }
      await collection._sync.loadSubset(subset)
      expect([...collection.keys()].sort((a, b) => a - b)).toEqual(loaded)

      // One write, so once 100 arrives the tracking has judged 0 as well.
      await db.execute(
        `INSERT INTO products (id, name, category) VALUES ('0', 'F', 'z'), ('100', 'G', 'z')`,
      )
      await vi.waitFor(() => expect(collection.has(100)).toBe(true))
      expect(collection.has(0)).toBe(false)

      collection._sync.unloadSubset(subset)
      await vi.waitFor(() => expect(collection.size).toBe(0))
      expect(errors).toEqual([])
    },
  )

  // `id` is SQLite's text primary key. Equality on a numeric id compares the
  // stored text, so a load by id, such as a join's `in`, uses the index.
  // A numeric range needs the CAST and scans.
  it.each([
    [`eq(id, 5)`, idEquals(5)],
    [`in(id, [1, 2])`, idIn([1, 2])],
  ])(
    `looks up numeric id equality through the id index: %s`,
    async (_, where) => {
      const { db } = await createDatabase()
      const compiled = compileSQLite({ where }, { numericId: true })
      const plan = await db.getAll<{ detail: string }>(
        `EXPLAIN QUERY PLAN SELECT * FROM products WHERE ${compiled.where}`,
        compiled.params,
      )
      expect(plan.map(({ detail }) => detail).join(` | `)).toMatch(
        /USING INDEX/,
      )
    },
  )

  it(`keeps held rows after a tracking outage`, async () => {
    vi.useFakeTimers()
    const { db } = await createDatabase()
    const collection = createNumericCollection(db, `on-demand`)
    const first = { where: categoryEquals(`y`) }
    const second = { where: categoryEquals(`x`) }
    try {
      await collection._sync.loadSubset(first)
      await collection._sync.loadSubset(second)
      const trigger = vi
        .spyOn(db.triggers, `createDiffTrigger`)
        .mockRejectedValueOnce(new Error(`release rebuild failed`))
      collection._sync.unloadSubset(first)
      await vi.waitFor(() =>
        expect(collection.health.failureReason?.message).toBe(
          `release rebuild failed`,
        ),
      )
      await vi.advanceTimersByTimeAsync(1_000)
      await vi.waitFor(() =>
        expect(trigger.mock.calls.length).toBeGreaterThan(1),
      )
      await vi.waitFor(() => expect(collection.health.hasErrors).toBe(false))
      // The rebuild reads the rows still in SQLite; a row it reads is kept.
      expect([...collection.keys()].sort()).toEqual([1, 2])
    } finally {
      await collection.cleanup()
      await vi.runOnlyPendingTimersAsync()
      vi.useRealTimers()
    }
  })
})

// A load deserializes every row, and deserialization can fail. A sync
// transaction opens only after every row is deserialized, so a failing row
// leaves no open transaction behind. A release does not deserialize: it
// derives each key from the stored id, so a row that fails validation cannot
// keep the release from evicting the rows it loaded.
describe(`a row that fails deserialization`, () => {
  // A row fails validation while its stored id is in `invalid`.
  function createGatedCollection(
    db: PowerSyncDatabase,
    ids: `numeric` | `string`,
  ) {
    const invalid = new Set<string>()
    const valid = (id: string | number) => !invalid.has(String(id))
    const base = {
      database: db,
      table: APP_SCHEMA.props.products,
      onDeserializationError: () => {},
      syncMode: `on-demand` as const,
    }
    const numeric = row.extend({ id: z.coerce.number<string>().refine(valid) })
    const text = row.extend({ id: z.string().refine(valid) })
    const collection =
      ids === `numeric`
        ? createCollection(
            powerSyncCollectionOptions({
              ...base,
              schema: row,
              deserializationSchema: numeric,
              numericIds: true,
            }),
          )
        : createCollection(
            powerSyncCollectionOptions({
              ...base,
              schema: text,
              deserializationSchema: text,
            }),
          )
    onTestFinished(() => collection.cleanup())
    const openTransactions = () =>
      collection._state.pendingSyncedTransactions.filter(
        (transaction) => !transaction.committed,
      ).length
    return { collection, invalid, openTransactions }
  }

  it(`fails a load without leaving a sync transaction open`, async () => {
    const { db } = await createDatabase()
    const { collection, invalid, openTransactions } = createGatedCollection(
      db,
      `numeric`,
    )
    invalid.add(`2`)
    await expect(
      Promise.resolve(
        collection._sync.loadSubset({ where: categoryEquals(`x`) }),
      ),
    ).rejects.toThrow()
    expect(openTransactions()).toBe(0)
    expect(collection.size).toBe(0)

    invalid.clear()
    await collection._sync.loadSubset({ where: categoryEquals(`x`) })
    expect(collection.size).toBe(2)
  })

  // A JavaScript caller can omit numericIds for a schema that outputs number
  // ids. Each row then deserializes but getKey rejects its key. The key is
  // derived before a sync transaction opens, on the load path and on the path
  // that syncs tracked writes.
  it(`rejects a key without leaving a sync transaction open`, async () => {
    const { db, errors } = await createDatabase()
    const options = {
      database: db,
      table: APP_SCHEMA.props.products,
      schema: row,
      deserializationSchema: sqliteRow,
      onDeserializationError: () => {},
      syncMode: `on-demand` as const,
    }
    // @ts-expect-error a number id needs numericIds
    const config = powerSyncCollectionOptions(options)
    const collection = createCollection(config)
    onTestFinished(() => collection.cleanup())
    const openTransactions = () =>
      collection._state.pendingSyncedTransactions.filter(
        (transaction) => !transaction.committed,
      ).length

    // A tracked write. The subset starts empty, so its load succeeds.
    await collection._sync.loadSubset({ where: categoryEquals(`new`) })
    await db.execute(
      `INSERT INTO products (id, name, category) VALUES ('4', 'D', 'new')`,
    )
    await vi.waitFor(() =>
      expect(errors).toContain(
        `An error has been detected in the sync handler`,
      ),
    )
    expect(openTransactions()).toBe(0)

    // A load of existing rows.
    await expect(
      Promise.resolve(
        collection._sync.loadSubset({ where: categoryEquals(`x`) }),
      ),
    ).rejects.toThrow(/set numericIds/)
    expect(openTransactions()).toBe(0)
  })

  it.each([`numeric`, `string`] as const)(
    `releases a subset that holds a permanently invalid row (%s ids)`,
    async (ids) => {
      const { db, errors } = await createDatabase()
      const { collection, invalid, openTransactions } = createGatedCollection(
        db,
        ids,
      )
      const subset = { where: categoryEquals(`x`) }
      await collection._sync.loadSubset(subset)
      expect(collection.size).toBe(2)

      invalid.add(`2`)
      collection._sync.unloadSubset(subset)
      await vi.waitFor(() => expect(collection.size).toBe(0))
      expect(openTransactions()).toBe(0)
      expect(errors).toEqual([])
    },
  )
})
