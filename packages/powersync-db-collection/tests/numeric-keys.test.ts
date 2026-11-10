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
import { powerSyncCollectionOptions } from '../src'
import type { PowerSyncLogger } from '@powersync/node'

// SQLite stores every PowerSync id as text. A backend with integer primary
// keys converts `id` to a number in `deserializationSchema`, so the
// collection key is the deserialized number and integer foreign keys match
// it. Every path that writes a key must derive it from the deserialized row,
// not from SQLite's text id.

const APP_SCHEMA = new Schema({
  products: new Table({ name: column.text, category: column.text }),
})

const row = z.object({
  id: z.coerce.number(),
  name: z.string().nullable(),
  category: z.string().nullable(),
})

const categoryEquals = (category: string) =>
  new IR.Func<boolean>(`eq`, [
    new IR.PropRef([`category`]),
    new IR.Value(category),
  ])

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
      deserializationSchema: row,
      onDeserializationError: () => {},
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

// Deriving a key deserializes the row, and deserialization can fail. A sync
// transaction opens only after every key is derived, so a failing row leaves
// no open transaction behind.
describe(`a row that fails deserialization`, () => {
  function createGatedCollection(db: PowerSyncDatabase) {
    const gate = { valid: true }
    const gated = row.extend({
      id: z.coerce.number().refine(() => gate.valid),
    })
    const collection = createCollection(
      powerSyncCollectionOptions({
        database: db,
        table: APP_SCHEMA.props.products,
        schema: gated,
        deserializationSchema: gated,
        onDeserializationError: () => {},
        syncMode: `on-demand`,
      }),
    )
    const openTransactions = () =>
      collection._state.pendingSyncedTransactions.filter(
        (transaction) => !transaction.committed,
      ).length
    return { collection, gate, openTransactions }
  }

  it(`fails a load without leaving a sync transaction open`, async () => {
    const { db } = await createDatabase()
    const { collection, gate, openTransactions } = createGatedCollection(db)
    try {
      gate.valid = false
      await expect(
        Promise.resolve(
          collection._sync.loadSubset({ where: categoryEquals(`x`) }),
        ),
      ).rejects.toThrow()
      expect(openTransactions()).toBe(0)
      expect(collection.size).toBe(0)

      gate.valid = true
      await collection._sync.loadSubset({ where: categoryEquals(`x`) })
      expect([...collection.keys()].sort()).toEqual([1, 2])
    } finally {
      await collection.cleanup()
    }
  })

  it(`retries an eviction without leaving a sync transaction open`, async () => {
    vi.useFakeTimers()
    const { db, errors } = await createDatabase()
    const { collection, gate, openTransactions } = createGatedCollection(db)
    const first = { where: categoryEquals(`x`) }
    try {
      await collection._sync.loadSubset(first)
      gate.valid = false
      collection._sync.unloadSubset(first)
      await vi.waitFor(() =>
        expect(errors).toContainEqual(
          expect.stringContaining(`Could not release subset tracking`),
        ),
      )
      expect(openTransactions()).toBe(0)
      expect([...collection.keys()].sort()).toEqual([1, 2])

      gate.valid = true
      await vi.advanceTimersByTimeAsync(1_000)
      await vi.waitFor(() => expect(collection.size).toBe(0))
      expect(openTransactions()).toBe(0)
    } finally {
      await collection.cleanup()
      await vi.runOnlyPendingTimersAsync()
      vi.useRealTimers()
    }
  })
})
