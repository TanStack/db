/**
 * # Does real-adapter restart preserve the sync-run start boundary?
 *
 * A stale lifecycle may keep its already-admitted hydrate pending before its
 * SQLite row read, but it must not retain the wrapper mutex that gates startup
 * metadata for the replacement sync run. The replacement upstream sync
 * function may start once its metadata is loaded, before the stale hydrate is
 * released. This file uses the real core adapter because recording adapters
 * do not expose its public hydration-scope method and therefore select a
 * different startup branch.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import fc from 'fast-check'
import { createCollection } from '@tanstack/db'
import {
  SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY,
  createSQLiteCorePersistenceAdapter,
  persistedCollectionOptions,
} from '../src'
import { SqliteCliDriver } from './sqlite-core-adapter.test'
import type { PersistenceAdapter, SQLiteDriver } from '../src'

type Deferred = {
  promise: Promise<void>
  resolve: () => void
}

function createDeferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

async function reachCheckpoint(
  promise: Promise<void>,
  checkpoint: string,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Did not reach checkpoint: ${checkpoint}`)),
          2_000,
        )
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

class QueryObservingDriver implements SQLiteDriver {
  readonly queries: Array<string> = []

  constructor(
    private readonly driver: SQLiteDriver,
    schedulingKey?: object,
  ) {
    if (schedulingKey) {
      Object.defineProperty(this, SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY, {
        value: schedulingKey,
      })
    }
  }

  exec(sql: string): Promise<void> {
    return this.driver.exec(sql)
  }

  async query<T>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<ReadonlyArray<T>> {
    return this.queryThroughDriver(sql, params, this.driver)
  }

  private async queryThroughDriver<T>(
    sql: string,
    params: ReadonlyArray<unknown>,
    queryDriver: SQLiteDriver,
  ): Promise<ReadonlyArray<T>> {
    const normalizedSql = sql.replace(/\s+/g, ` `).trim()
    this.queries.push(normalizedSql)
    if (
      normalizedSql.includes(`FROM leader_term`) ||
      normalizedSql.includes(`FROM collection_version`) ||
      normalizedSql.includes(`FROM applied_tx`) ||
      normalizedSql.includes(`FROM collection_metadata`)
    ) {
      return []
    }
    return queryDriver.query<T>(sql, params)
  }

  run(sql: string, params: ReadonlyArray<unknown> = []): Promise<void> {
    return this.driver.run(sql, params)
  }

  transaction<T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    return this.driver.transaction((transactionDriver) =>
      fn(this.observeTransactionDriver(transactionDriver)),
    )
  }

  transactionWithDriver<T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    return this.driver.transactionWithDriver
      ? this.driver.transactionWithDriver((transactionDriver) =>
          fn(this.observeTransactionDriver(transactionDriver)),
        )
      : this.transaction(fn)
  }

  private observeTransactionDriver(driver: SQLiteDriver): SQLiteDriver {
    return {
      exec: (sql) => driver.exec(sql),
      query: (sql, params = []) => this.queryThroughDriver(sql, params, driver),
      run: (sql, params = []) => driver.run(sql, params),
      transaction: (fn) =>
        driver.transaction((nestedDriver) =>
          fn(this.observeTransactionDriver(nestedDriver)),
        ),
    }
  }
}

function holdFirstHydrationRead(adapter: PersistenceAdapter): {
  entered: Promise<void>
  release: () => void
} {
  const entered = createDeferred()
  const gate = createDeferred()
  if (!adapter.runInHydrationScope) {
    throw new Error(`The real adapter must expose a hydration scope`)
  }
  const runInHydrationScope = adapter.runInHydrationScope.bind(adapter)
  let held = false
  adapter.runInHydrationScope = (task) =>
    runInHydrationScope((scopedAdapter) =>
      task({
        ...scopedAdapter,
        loadResumeSnapshot: async (...args) => {
          if (!held && args[1]?.includeRows !== false) {
            held = true
            entered.resolve()
            await gate.promise
          }
          return scopedAdapter.loadResumeSnapshot(...args)
        },
      }),
    )
  return { entered: entered.promise, release: gate.resolve }
}

async function observeRestartOrder(options: {
  id: string
  scheduled: boolean
  schemaVersion: number
}): Promise<{
  sourceStartsBeforeRelease: number
  sourceStartsAfterRelease: number
  streamPositionReadsBeforeRelease: number
  collectionMetadataReadsBeforeRelease: number
}> {
  const directory = mkdtempSync(join(tmpdir(), `persisted-real-lifecycle-`))
  const driver = new QueryObservingDriver(
    new SqliteCliDriver(join(directory, `state.sqlite`)),
    options.scheduled ? {} : undefined,
  )
  const adapter = createSQLiteCorePersistenceAdapter({
    driver,
    schemaVersion: options.schemaVersion,
  })
  const staleRows = holdFirstHydrationRead(adapter)
  let sourceStarts = 0
  const freshSourceStarted = createDeferred()

  const collection = createCollection(
    persistedCollectionOptions<{ id: string }, string>({
      id: `real-adapter-restart-order-${options.id}`,
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          sourceStarts++
          if (sourceStarts === 2) freshSourceStarted.resolve()
          markReady()
        },
      },
      persistence: { adapter },
    }),
  )
  const stalePreload = Promise.resolve(collection.preload())
  void stalePreload.catch(() => undefined)
  let freshReady: Promise<unknown> | undefined
  let observation = {
    sourceStartsBeforeRelease: -1,
    sourceStartsAfterRelease: -1,
    streamPositionReadsBeforeRelease: -1,
    collectionMetadataReadsBeforeRelease: -1,
  }

  try {
    await staleRows.entered
    for (let microtask = 0; microtask < 12 && sourceStarts === 0; microtask++) {
      await Promise.resolve()
    }
    expect(sourceStarts).toBe(1)
    await collection.cleanup()

    collection.startSyncImmediate()
    freshReady = collection.stateWhenReady()
    void freshReady.catch(() => undefined)
    if (options.scheduled) {
      for (let microtask = 0; microtask < 12; microtask++) {
        await Promise.resolve()
      }
    } else {
      await reachCheckpoint(
        freshSourceStarted.promise,
        `replacement source started while stale hydration is held`,
      )
    }

    observation = {
      sourceStartsBeforeRelease: sourceStarts,
      sourceStartsAfterRelease: -1,
      streamPositionReadsBeforeRelease: driver.queries.filter((sql) =>
        sql.includes(`SELECT latest_term`),
      ).length,
      collectionMetadataReadsBeforeRelease: driver.queries.filter((sql) =>
        sql.includes(`FROM collection_metadata`),
      ).length,
    }
  } finally {
    staleRows.release()
    await stalePreload.catch(() => undefined)
    await freshReady?.catch(() => undefined)
    observation.sourceStartsAfterRelease = sourceStarts
    await collection.cleanup()
    rmSync(directory, { recursive: true, force: true })
  }

  return observation
}

it(`starts a rebound source before a stale real-adapter row read settles`, async () => {
  await expect(
    observeRestartOrder({ id: `shrink`, scheduled: false, schemaVersion: 1 }),
  ).resolves.toEqual({
    sourceStartsBeforeRelease: 2,
    sourceStartsAfterRelease: 2,
    streamPositionReadsBeforeRelease: 4,
    collectionMetadataReadsBeforeRelease: 2,
  })
})

it(`preserves generated restart order across real-adapter scheduler capabilities`, async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        scheduled: fc.boolean(),
        schemaVersion: fc.integer({ min: 0, max: 3 }),
      }),
      async ({ scheduled, schemaVersion }) => {
        const observation = await observeRestartOrder({
          id: `generated-${scheduled}-${schemaVersion}`,
          scheduled,
          schemaVersion,
        })
        expect(observation.sourceStartsBeforeRelease).toBe(scheduled ? 1 : 2)
        expect(observation.sourceStartsAfterRelease).toBe(2)
        expect(observation.streamPositionReadsBeforeRelease).toBe(
          scheduled ? 2 : 4,
        )
        expect(observation.collectionMetadataReadsBeforeRelease).toBe(
          scheduled ? 1 : 2,
        )
      },
    ),
    { seed: 1868, numRuns: 6, endOnFailure: true },
  )
})
