import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBetterSqlite3Driver } from '../src'

type DriverHarness = {
  driver: ReturnType<typeof createBetterSqlite3Driver>
}

const activeCleanupFns: Array<() => void> = []

afterEach(() => {
  while (activeCleanupFns.length > 0) {
    const cleanupFn = activeCleanupFns.pop()
    cleanupFn?.()
  }
})

function createDriverHarness(): DriverHarness {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-node-sqlite-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const driver = createBetterSqlite3Driver({ filename: dbPath })

  let cleaned = false
  activeCleanupFns.push(() => {
    if (cleaned) {
      return
    }
    cleaned = true
    try {
      driver.close()
    } catch {
      // ignore cleanup errors from already-closed handles
    }
    rmSync(tempDirectory, { recursive: true, force: true })
  })

  return { driver }
}

describe(`better-sqlite3 node driver`, () => {
  it(`executes run/query with parameter binding`, async () => {
    const { driver } = createDriverHarness()

    await driver.exec(
      `CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL, score INTEGER NOT NULL)`,
    )
    await driver.run(
      `INSERT INTO todos (id, title, score) VALUES (?, ?, ?)`,
      [`1`, `First`, 10],
    )
    await driver.run(
      `INSERT INTO todos (id, title, score) VALUES (?, ?, ?)`,
      [`2`, `Second`, 20],
    )

    const rows = await driver.query<{ id: string; title: string }>(
      `SELECT id, title
       FROM todos
       WHERE score >= ?
       ORDER BY score ASC`,
      [10],
    )
    expect(rows).toEqual([
      { id: `1`, title: `First` },
      { id: `2`, title: `Second` },
    ])
  })

  it(`rolls back transaction when callback throws`, async () => {
    const { driver } = createDriverHarness()

    await driver.exec(
      `CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL)`,
    )

    await expect(
      driver.transaction(async () => {
        await driver.run(`INSERT INTO todos (id, title) VALUES (?, ?)`, [
          `1`,
          `Should rollback`,
        ])
        throw new Error(`boom`)
      }),
    ).rejects.toThrow(`boom`)

    const countRows = await driver.query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM todos`,
    )
    expect(countRows[0]?.count).toBe(0)
  })

  it(`serializes operations while a transaction is in progress`, async () => {
    const { driver } = createDriverHarness()

    await driver.exec(`CREATE TABLE events (value INTEGER NOT NULL)`)

    let resolveHold: (() => void) | undefined
    const hold = new Promise<void>((resolve) => {
      resolveHold = resolve
    })
    let resolveEntered: (() => void) | undefined
    const entered = new Promise<void>((resolve) => {
      resolveEntered = resolve
    })

    const txPromise = driver.transaction(async () => {
      if (!resolveEntered) {
        throw new Error(`transaction entry signal missing`)
      }
      resolveEntered()
      await driver.run(`INSERT INTO events (value) VALUES (?)`, [1])
      await hold
      await driver.run(`INSERT INTO events (value) VALUES (?)`, [2])
    })

    await entered

    let outsideResolved = false
    const outsidePromise = driver
      .run(`INSERT INTO events (value) VALUES (?)`, [3])
      .then(() => {
        outsideResolved = true
      })

    await Promise.resolve()
    expect(outsideResolved).toBe(false)

    if (!resolveHold) {
      throw new Error(`transaction hold signal missing`)
    }
    resolveHold()

    await Promise.all([txPromise, outsidePromise])

    const rows = await driver.query<{ value: number }>(
      `SELECT value
       FROM events
       ORDER BY value ASC`,
    )
    expect(rows.map((row) => row.value)).toEqual([1, 2, 3])
  })

  it(`uses savepoints for nested transactions`, async () => {
    const { driver } = createDriverHarness()

    await driver.exec(`CREATE TABLE nested_events (value INTEGER NOT NULL)`)

    await driver.transaction(async () => {
      await driver.run(`INSERT INTO nested_events (value) VALUES (?)`, [1])

      await expect(
        driver.transaction(async () => {
          await driver.run(`INSERT INTO nested_events (value) VALUES (?)`, [2])
          throw new Error(`inner failure`)
        }),
      ).rejects.toThrow(`inner failure`)

      await driver.run(`INSERT INTO nested_events (value) VALUES (?)`, [3])
    })

    const rows = await driver.query<{ value: number }>(
      `SELECT value
       FROM nested_events
       ORDER BY value ASC`,
    )
    expect(rows.map((row) => row.value)).toEqual([1, 3])
  })
})
