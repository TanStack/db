/**
 * # Does real-adapter restart preserve the sync-run start boundary?
 *
 * A stale lifecycle may finish its already-admitted SQLite read, but it must
 * not retain the wrapper mutex that gates startup metadata for the replacement
 * sync run. The replacement upstream sync function may start once its metadata
 * is loaded, before the stale row read is released. This file uses the real
 * core adapter because recording adapters do not expose its public
 * hydration-scope method and therefore select a different startup branch.
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
import type { SQLiteDriver } from '../src'

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

class QueryGateDriver implements SQLiteDriver {
  readonly queries: Array<string> = []
  private matcher: ((sql: string) => boolean) | undefined
  private gate: Deferred | undefined
  private entered: Deferred | undefined

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

  holdNextQuery(matcher: (sql: string) => boolean): {
    entered: Promise<void>
    release: () => void
  } {
    this.matcher = matcher
    this.gate = createDeferred()
    this.entered = createDeferred()
    return {
      entered: this.entered.promise,
      release: () => this.release(),
    }
  }

  exec(sql: string): Promise<void> {
    return this.driver.exec(sql)
  }

  async query<T>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<ReadonlyArray<T>> {
    const normalizedSql = sql.replace(/\s+/g, ` `).trim()
    this.queries.push(normalizedSql)
    if (this.matcher?.(sql)) {
      this.matcher = undefined
      this.entered?.resolve()
      await this.gate?.promise
    }
    if (
      normalizedSql.includes(`FROM leader_term`) ||
      normalizedSql.includes(`FROM collection_version`) ||
      normalizedSql.includes(`FROM applied_tx`) ||
      normalizedSql.includes(`FROM collection_metadata`)
    ) {
      return []
    }
    return this.driver.query<T>(sql, params)
  }

  run(sql: string, params: ReadonlyArray<unknown> = []): Promise<void> {
    return this.driver.run(sql, params)
  }

  transaction<T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    return this.driver.transaction(fn)
  }

  transactionWithDriver<T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    return this.driver.transactionWithDriver
      ? this.driver.transactionWithDriver(fn)
      : this.driver.transaction(fn)
  }

  private release(): void {
    this.gate?.resolve()
    this.gate = undefined
    this.entered = undefined
  }
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
  const driver = new QueryGateDriver(
    new SqliteCliDriver(join(directory, `state.sqlite`)),
    options.scheduled ? {} : undefined,
  )
  const adapter = createSQLiteCorePersistenceAdapter({
    driver,
    schemaVersion: options.schemaVersion,
  })
  const staleRows = driver.holdNextQuery((sql) =>
    /SELECT\s+key,\s*value,\s*metadata,\s*row_version\s+FROM/i.test(sql),
  )
  let sourceStarts = 0

  const collection = createCollection(
    persistedCollectionOptions<{ id: string }, string>({
      id: `real-adapter-restart-order-${options.id}`,
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          sourceStarts++
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
    expect(sourceStarts).toBe(1)
    await collection.cleanup()

    collection.startSyncImmediate()
    freshReady = collection.stateWhenReady()
    void freshReady.catch(() => undefined)
    for (let microtask = 0; microtask < 12; microtask++) {
      await Promise.resolve()
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
