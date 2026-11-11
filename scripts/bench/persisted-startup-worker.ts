/**
 * One process measures one persisted eager startup. Source fixtures and the
 * saved SQLite baseline are prepared before the clock and forced collection.
 * This is a measurement harness, not an oracle or an elapsed-time product law.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { performance } from 'node:perf_hooks'
import { createCollection } from '@tanstack/db'
import { Schema, Table, column } from '@powersync/common'
import { PowerSyncDatabase } from '@powersync/node'
import { createRxDatabase } from 'rxdb/plugins/core'
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory'
import { z } from 'zod'
import { powerSyncCollectionOptions } from '../../packages/powersync-db-collection/src/index'
import { rxdbCollectionOptions } from '../../packages/rxdb-db-collection/src/rxdb'
import { BrowserWASQLiteDriver } from '../../packages/browser-db-sqlite-persistence/src/wa-sqlite-driver'
import {
  createSQLiteCorePersistenceAdapter,
  persistedCollectionOptions,
} from '../../packages/db-sqlite-persistence-core/src/index'
import type { SQLInputValue } from 'node:sqlite'
import type { SyncConfig } from '@tanstack/db'
import type { PersistenceAdapter } from '../../packages/db-sqlite-persistence-core/src/index'

type Row = { id: string; value: number; payload: string }
type Config = {
  adapter: 'rxdb' | 'powersync'
  rows: number
  saved: boolean
  batch: number
  payloadBytes: number
  render: 'default' | 'network-first'
  restoreDelayMs: number
  sourceDelayMs: number
}
const config = JSON.parse(process.argv[2]!) as Config
const directory = await mkdtemp(join(tmpdir(), `persisted-startup-bench-`))
const id = `startup-benchmark`
const rowAt = (i: number): Row => ({
  id: `row-${String(i).padStart(8, '0')}`,
  value: i,
  payload: `${i}:`.padEnd(config.payloadBytes, 'x'),
})
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))
let sqlite = new DatabaseSync(join(directory, 'persisted.sqlite'))
sqlite.exec(`PRAGMA journal_mode=WAL`)
sqlite.exec(`PRAGMA synchronous=NORMAL`)
let timing = false
let start = 0
let restoreReadMs: number | undefined
let restoreHydratedMs: number | undefined
let readyMs: number | undefined
let sourceCommitMs: number | undefined
let sourceAppliedMs: number | undefined
let sourceWrites = 0
let sourceCommits = 0
let snapshotTransactions = 0
let durableTransactions = 0
let durableWrites = 0
let durableTruncates = 0
let maxHeap = 0
let maxRSS = 0
let peakExternal = 0
const sample = () => {
  const memory = process.memoryUsage()
  maxHeap = Math.max(maxHeap, memory.heapUsed)
  maxRSS = Math.max(maxRSS, memory.rss)
  peakExternal = Math.max(peakExternal, memory.external)
}
const createAdapter = () =>
  createSQLiteCorePersistenceAdapter({
    driver: new BrowserWASQLiteDriver({
      database: {
        execute: <T>(sql: string, params: ReadonlyArray<unknown> = []) => {
          if (!/^\s*(select|with|pragma)/i.test(sql) && params.length === 0) {
            sqlite.exec(sql)
            return Promise.resolve([])
          }
          return Promise.resolve(
            sqlite
              .prepare(sql)
              .all(
                ...(params.map((value) =>
                  value === undefined
                    ? null
                    : typeof value === 'boolean'
                      ? Number(value)
                      : value,
                ) as Array<SQLInputValue>),
              ) as Array<T>,
          )
        },
      },
    }),
  })
let rawAdapter = createAdapter()
let delayedRestore = false
const instrument = (adapter: PersistenceAdapter): PersistenceAdapter =>
  new Proxy(adapter, {
    get(target, key) {
      if (key === 'loadResumeSnapshot')
        return async (
          ...args: Parameters<PersistenceAdapter['loadResumeSnapshot']>
        ) => {
          if (timing && args[1]?.includeRows !== false && !delayedRestore) {
            delayedRestore = true
            if (config.restoreDelayMs) await delay(config.restoreDelayMs)
            const snapshot = await target.loadResumeSnapshot(...args)
            restoreReadMs = performance.now() - start
            sample()
            return snapshot
          }
          return target.loadResumeSnapshot(...args)
        }
      if (key === 'applyCommittedTx')
        return async (
          ...args: Parameters<PersistenceAdapter['applyCommittedTx']>
        ) => {
          if (timing) {
            durableTransactions++
            durableWrites += args[1].mutations.length
            if (args[1].truncate) durableTruncates++
            sample()
          }
          return target.applyCommittedTx(...args)
        }
      if (key === 'runInHydrationScope' && target.runInHydrationScope)
        return (
          task: Parameters<
            NonNullable<PersistenceAdapter['runInHydrationScope']>
          >[0],
        ) => target.runInHydrationScope!((scoped) => task(instrument(scoped)))
      const value: unknown = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
const persistence = { adapter: instrument(rawAdapter) }
const seed = createCollection(
  persistedCollectionOptions<Row, string>({
    id,
    getKey: (row) => row.id,
    persistence,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        if (config.saved)
          for (let i = 0; i < config.rows; i++)
            write({ type: 'insert', value: rowAt(i) })
        commit()
        markReady()
      },
    },
  }),
)
await seed.preload()
await seed.cleanup()
// A new wrapper adapter and connection replay an app reopen instead of reusing
// the seeding adapter's in-memory schema and snapshot state. OS file cache is
// still warm; this harness does not attempt to flush the operating system.
sqlite.close()
sqlite = new DatabaseSync(join(directory, 'persisted.sqlite'))
sqlite.exec(`PRAGMA journal_mode=WAL`)
sqlite.exec(`PRAGMA synchronous=NORMAL`)
rawAdapter = createAdapter()
persistence.adapter = instrument(rawAdapter)
let disposeSource: () => Promise<unknown>
let sourceSync: SyncConfig<Row, string>
const rowSchema = z.object({
  id: z.string(),
  value: z.number(),
  payload: z.string(),
})
if (config.adapter === 'rxdb') {
  const database = await createRxDatabase({
    name: 'startupbenchmark',
    storage: getRxStorageMemory(),
    multiInstance: false,
  })
  const { rows } = await database.addCollections({
    rows: {
      schema: {
        version: 0,
        type: 'object',
        primaryKey: 'id',
        properties: {
          id: { type: 'string', maxLength: 30 },
          value: { type: 'number' },
          payload: { type: 'string' },
        },
        required: ['id', 'value', 'payload'],
      },
    },
  })
  for (let first = 0; first < config.rows; first += 1000) {
    const result = await rows.bulkInsert(
      Array.from({ length: Math.min(1000, config.rows - first) }, (_, i) =>
        rowAt(first + i),
      ),
    )
    if (result.error.length) throw new Error('RxDB source seeding failed')
  }
  const query = rows.storageInstance.query.bind(rows.storageInstance)
  let initialQuery = true
  rows.storageInstance.query = async (prepared) => {
    if (initialQuery) {
      initialQuery = false
      if (config.sourceDelayMs) await delay(config.sourceDelayMs)
    }
    const result = await query(prepared)
    if (timing) sample()
    return result
  }
  sourceSync = rxdbCollectionOptions<Row>({
    id,
    rxCollection: rows,
    syncBatchSize: config.batch,
    syncMode: 'eager',
  }).sync
  disposeSource = () => database.remove()
} else {
  const schema = new Schema({
    rows: new Table({ value: column.integer, payload: column.text }),
  })
  const database = new PowerSyncDatabase({
    database: {
      dbFilename: 'source.sqlite',
      dbLocation: directory,
      implementation: { type: 'node:sqlite' },
    },
    schema,
  })
  await database.writeTransaction(async (tx) => {
    for (let i = 0; i < config.rows; i++) {
      const row = rowAt(i)
      await tx.execute(
        'INSERT INTO rows (id, value, payload) VALUES (?, ?, ?)',
        [row.id, row.value, row.payload],
      )
    }
  })
  sourceSync = powerSyncCollectionOptions({
    id,
    database,
    table: schema.props.rows,
    schema: rowSchema,
    syncBatchSize: config.batch,
    onDeserializationError: (error) => {
      throw error
    },
    onLoad: () =>
      config.sourceDelayMs ? delay(config.sourceDelayMs) : undefined,
  }).sync
  disposeSource = () => database.close()
}
let resolveSource!: () => void
let rejectSource!: (error: unknown) => void
const sourceResult = new Promise<void>((resolve, reject) => {
  resolveSource = resolve
  rejectSource = reject
})
const receipts: Array<true | Promise<void>> = []
const sync: SyncConfig<Row, string> = {
  ...sourceSync,
  sync: (params) => {
    if (params.metadata?.persistence)
      void params.metadata.persistence.hydrateBaseline().then(() => {
        restoreHydratedMs = performance.now() - start
        sample()
      }, rejectSource)
    return sourceSync.sync({
      ...params,
      begin: (options) => {
        if (options?.snapshot) snapshotTransactions++
        params.begin(options)
      },
      write: (message) => {
        sourceWrites++
        params.write(message)
        if (sourceWrites % 512 === 0) sample()
      },
      commit: (signal) => {
        sourceCommits++
        sourceCommitMs ??= performance.now() - start
        const receipt = params.commit(signal)
        receipts.push(receipt)
        sample()
        return receipt
      },
      fail: (error) => {
        rejectSource(error)
        params.fail(error)
      },
      markReady: () => {
        params.markReady()
        void Promise.all(receipts).then(() => {
          sourceAppliedMs = performance.now() - start
          sample()
          resolveSource()
        }, rejectSource)
      },
    })
  },
}
const collection = createCollection(
  persistedCollectionOptions<Row, string>({
    id,
    getKey: (row) => row.id,
    persistence,
    sync,
    ...(config.render === 'network-first'
      ? { initialRender: { strategy: 'network-first', networkTimeoutMs: 25 } }
      : {}),
  }),
)
global.gc?.()
const before = process.memoryUsage()
sample()
const rssHighWaterBeforeKiB = process.resourceUsage().maxRSS
timing = true
start = performance.now()
const sampler = setInterval(sample, 2)
try {
  const ready = collection.preload().then(() => {
    readyMs = performance.now() - start
    sample()
  })
  await Promise.all([ready, sourceResult])
  sample()
  clearInterval(sampler)
  const after = process.memoryUsage()
  const rssHighWaterKiB = process.resourceUsage().maxRSS
  timing = false
  if (collection.size !== config.rows)
    throw new Error(
      `Collection has ${collection.size} rows, expected ${config.rows}`,
    )
  const stored = await rawAdapter.loadResumeSnapshot(
    { kind: 'eager', collectionId: id },
    { includeRows: true },
  )
  if (stored.rows.length !== config.rows)
    throw new Error(
      `SQLite has ${stored.rows.length} rows, expected ${config.rows}`,
    )
  console.log(
    `STARTUP_RESULT ${JSON.stringify({
      ...config,
      restoreReadMs,
      restoreHydratedMs,
      readyMs,
      sourceCommitMs,
      sourceAppliedMs,
      sourceWrites,
      sourceCommits,
      snapshotTransactions,
      durableTransactions,
      durableWrites,
      durableTruncates,
      heapBefore: before.heapUsed,
      heapAfter: after.heapUsed,
      sampledHeapMax: maxHeap,
      rssBefore: before.rss,
      rssAfter: after.rss,
      sampledRSSMax: maxRSS,
      externalBefore: before.external,
      sampledExternalMax: peakExternal,
      rssHighWaterBeforeKiB,
      rssHighWaterKiB,
    })}`,
  )
} finally {
  clearInterval(sampler)
  timing = false
  await collection.cleanup()
  await disposeSource()
  sqlite.close()
  await rm(directory, { recursive: true, force: true })
}
