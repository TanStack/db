/**
 * # When does a cold hydrate get a turn on a shared SQLite driver?
 *
 * Contract and source: RFC #1659 accepts K=1 complete-logical-cold-hydrate
 * scheduling. The persist already executing when the storm begins is
 * non-preemptible. After that, at most one additional persist may complete
 * between consecutive hydrate completions, with FIFO identity preserved
 * inside the hydrate and persist lanes.
 *
 * History grammar and domain: a legal storm has unique work IDs, starts with
 * that already-running persist when any persist exists, and then permutes
 * complete hydrate and persist requests. Hydrates contain nonempty unique
 * seeded rows; persists contain one or more mutations. The generated campaign
 * varies 2..7 hydrates, 2..7 persists, 1..3 mutations per persist, and sampled
 * tail permutations. Neutral histories contain only hydrates.
 *
 * Independent model and production boundary: `createFairnessReference`
 * computes permitted completed persist IDs from the ordered history and K; it
 * does not import or simulate the production scheduler. The driver exercises
 * public `Collection.preload()` through persisted collection options, the core
 * adapter, and one real `BrowserWASQLiteDriver`. Each preload completion is a
 * checkpoint after the complete logical hydrate, not after an individual SQL
 * statement.
 *
 * Observed public facts: admitted and completed logical IDs, completed and
 * pending persists at every hydrate checkpoint, independently seeded public
 * collection rows, raw SQL dequeue reach, and cleanup diagnostics. Known
 * omissions: the oracle does not establish elapsed-time latency, unbounded
 * eventuality, multi-process coordination, or a browser matrix; the Chromium
 * OPFS fixture separately refines the provider boundary.
 *
 * Challenge and replay: the executable persist-first FIFO driver must violate
 * the same K=1 checker while using the public/core/driver path. Re-run a
 * generated failure with TANSTACK_DB_DRIVER_FAIRNESS_SEED and
 * TANSTACK_DB_DRIVER_FAIRNESS_PATH. Cleanup preserves the primary failure and
 * reports secondary resource-release diagnostics separately.
 */
import { createCollection } from '../../db/src/index'
import { persistedCollectionOptions } from '../src/index'
import { BrowserWASQLiteDriver } from '../src/wa-sqlite-driver'
import {
  SingleProcessCoordinator,
  createSQLiteCorePersistenceAdapter,
} from '../../db-sqlite-persistence-core/src/index'
import type { Collection } from '../../db/src/index'
import type {
  PersistedCollectionPersistence,
  PersistedTx,
  SQLiteDriver,
} from '../../db-sqlite-persistence-core/src/index'
import type { BrowserWASQLiteDatabase } from '../src/index'

export const SHARED_DRIVER_FAIRNESS_BOUND = 1

export type FairnessRow = {
  id: string
  value: number
}

export type SharedDriverFairnessWork =
  | {
      kind: `hydrate`
      id: string
      seededRows: ReadonlyArray<FairnessRow>
    }
  | {
      kind: `persist`
      id: string
      mutationsPerPersist: number
    }

export type SharedDriverFairnessScenario = {
  id: string
  /**
   * Logical admission history. A storm begins with the one persist that is
   * already non-preemptibly running; the remaining hydrate and persist work
   * may be interleaved in any order.
   */
  work: ReadonlyArray<SharedDriverFairnessWork>
}

export type RawDriverDequeue = {
  ordinal: number
  sql: string
  params: ReadonlyArray<unknown>
}

export type RawDriverAdmission = RawDriverDequeue & {
  kind: `exec` | `query` | `run` | `transaction`
}

export type HydrationCompletionCheckpoint = {
  collectionId: string
  completionOrdinal: number
  completedPersistIds: ReadonlyArray<string>
  pendingPersistCount: number
  rawDequeueCount: number
}

export type HydratedCollectionRows = {
  collectionId: string
  rows: ReadonlyArray<FairnessRow>
}

export type SharedDriverFairnessObservation = {
  scenario: SharedDriverFairnessScenario
  admittedHydrateIds: ReadonlyArray<string>
  logicalCompletionOrder: ReadonlyArray<string>
  hydrationCompletions: ReadonlyArray<HydrationCompletionCheckpoint>
  driverAdmissions: ReadonlyArray<RawDriverAdmission>
  rawDequeues: ReadonlyArray<RawDriverDequeue>
  hydratedCollections: ReadonlyArray<HydratedCollectionRows>
  cleanupFailures: ReadonlyArray<string>
}

export type SharedDriverFairnessViolation = {
  checkpoint: HydrationCompletionCheckpoint
  expectedCollectionId: string
  expectedMaximumCompletedPersists: number
  expectedMinimumPendingPersists: number
  permittedCompletedPersistIds: ReadonlyArray<string>
  unexpectedCompletedPersistIds: ReadonlyArray<string>
}

export type SharedDriverFairnessOptions = {
  /** Test-only hostile control that preserves the current global FIFO fault. */
  schedulingFault?: `persist-first-fifo`
}

type Deferred = {
  promise: Promise<void>
  resolve: () => void
}

type CloseableSQLiteDriver = SQLiteDriver & {
  transactionWithDriver: <T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ) => Promise<T>
  close: () => Promise<void>
}

type FairnessReferenceCheckpoint = {
  collectionId: string
  expectedMaximumCompletedPersists: number
  expectedMinimumPendingPersists: number
  permittedCompletedPersistIds: ReadonlyArray<string>
}

export type BrowserWASQLiteDatabaseFactory = () =>
  | BrowserWASQLiteDatabase
  | Promise<BrowserWASQLiteDatabase>

function createDeferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ` `).trim()
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function collectionIdFor(
  scenario: SharedDriverFairnessScenario,
  work: SharedDriverFairnessWork,
): string {
  return `${scenario.id}-${work.id}`
}

function validateScenario(scenario: SharedDriverFairnessScenario): void {
  const hydrateWork = scenario.work.filter((work) => work.kind === `hydrate`)
  const persistWork = scenario.work.filter((work) => work.kind === `persist`)
  if (hydrateWork.length < 1) {
    throw new Error(`work must contain at least one hydrate`)
  }
  if (persistWork.length > 0 && scenario.work[0]?.kind !== `persist`) {
    throw new Error(
      `a storm history must begin with its already-running persist`,
    )
  }
  if (
    new Set(scenario.work.map((work) => work.id)).size !== scenario.work.length
  ) {
    throw new Error(`work ids must be unique`)
  }
  for (const work of scenario.work) {
    if (work.kind === `persist` && work.mutationsPerPersist < 1) {
      throw new Error(`mutationsPerPersist must be at least one`)
    }
    if (work.kind === `hydrate`) {
      if (work.seededRows.length < 1) {
        throw new Error(`each hydrate must contain at least one seeded row`)
      }
      if (
        new Set(work.seededRows.map((row) => row.id)).size !==
        work.seededRows.length
      ) {
        throw new Error(`seeded row ids must be unique within each hydrate`)
      }
    }
  }
}

class ObservedDatabase implements BrowserWASQLiteDatabase {
  readonly rawDequeues: Array<RawDriverDequeue> = []
  private heldBegin: Deferred | undefined
  private beginEntered: Deferred | undefined

  constructor(private readonly database: BrowserWASQLiteDatabase) {}

  holdNextTransactionBegin(): { entered: Promise<void>; release: () => void } {
    if (this.heldBegin) {
      throw new Error(`a transaction begin is already held`)
    }
    this.heldBegin = createDeferred()
    this.beginEntered = createDeferred()
    return {
      entered: this.beginEntered.promise,
      release: () => this.releaseHeldBegin(),
    }
  }

  clearTrace(): void {
    this.rawDequeues.length = 0
  }

  async execute<TRow = unknown>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<ReadonlyArray<TRow>> {
    const normalizedSql = normalizeSql(sql)
    this.rawDequeues.push({
      ordinal: this.rawDequeues.length,
      sql: normalizedSql,
      params: [...params],
    })

    if (normalizedSql === `BEGIN IMMEDIATE` && this.heldBegin) {
      const heldBegin = this.heldBegin
      this.beginEntered?.resolve()
      await heldBegin.promise
    }

    return this.database.execute<TRow>(sql, params)
  }

  async close(): Promise<void> {
    this.releaseHeldBegin()
    await this.database.close?.()
  }

  private releaseHeldBegin(): void {
    this.heldBegin?.resolve()
    this.heldBegin = undefined
    this.beginEntered = undefined
  }
}

/**
 * A test-only hostile scheduler. It admits calls through the same public/core/
 * BrowserWASQLiteDriver path but serializes them in global admission order, so
 * a future fair production driver cannot accidentally make this control pass.
 */
class PersistFirstFIFOFaultDriver implements SQLiteDriver {
  private tail = Promise.resolve()

  constructor(private readonly driver: CloseableSQLiteDriver) {}

  exec(sql: string): Promise<void> {
    return this.enqueue(() => this.driver.exec(sql))
  }

  query<T>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<ReadonlyArray<T>> {
    return this.enqueue(() => this.driver.query<T>(sql, params))
  }

  run(sql: string, params: ReadonlyArray<unknown> = []): Promise<void> {
    return this.enqueue(() => this.driver.run(sql, params))
  }

  transaction<T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    return this.enqueue(() => this.driver.transaction(fn))
  }

  transactionWithDriver<T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    return this.enqueue(() => this.driver.transactionWithDriver(fn))
  }

  close(): Promise<void> {
    return this.enqueue(() => this.driver.close())
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation)
    this.tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

class AdmissionObservedDriver implements SQLiteDriver {
  readonly admissions: Array<RawDriverAdmission> = []

  constructor(
    private readonly driver: CloseableSQLiteDriver,
    private readonly onAdmission?: (entry: RawDriverAdmission) => void,
  ) {}

  exec(sql: string): Promise<void> {
    this.record(`exec`, sql, [])
    return this.driver.exec(sql)
  }

  query<T>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<ReadonlyArray<T>> {
    this.record(`query`, sql, params)
    return this.driver.query<T>(sql, params)
  }

  run(sql: string, params: ReadonlyArray<unknown> = []): Promise<void> {
    this.record(`run`, sql, params)
    return this.driver.run(sql, params)
  }

  transaction<T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    this.record(`transaction`, `BEGIN IMMEDIATE`, [])
    return this.driver.transaction(fn)
  }

  transactionWithDriver<T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    this.record(`transaction`, `BEGIN IMMEDIATE`, [])
    return this.driver.transactionWithDriver(fn)
  }

  close(): Promise<void> {
    return this.driver.close()
  }

  clearAdmissions(): void {
    this.admissions.length = 0
  }

  private record(
    kind: RawDriverAdmission[`kind`],
    sql: string,
    params: ReadonlyArray<unknown>,
  ): void {
    const entry = {
      ordinal: this.admissions.length,
      kind,
      sql: normalizeSql(sql),
      params: [...params],
    }
    this.admissions.push(entry)
    this.onAdmission?.(entry)
  }
}

function createSharedPersistence(
  database: BrowserWASQLiteDatabase,
  onAdmission?: (entry: RawDriverAdmission) => void,
  schedulingFault?: SharedDriverFairnessOptions[`schedulingFault`],
): {
  driver: AdmissionObservedDriver
  persistence: PersistedCollectionPersistence
} {
  const productionDriver = new BrowserWASQLiteDriver({ database })
  const scheduledDriver =
    schedulingFault === `persist-first-fifo`
      ? new PersistFirstFIFOFaultDriver(productionDriver)
      : productionDriver
  const driver = new AdmissionObservedDriver(scheduledDriver, onAdmission)
  const adapter = createSQLiteCorePersistenceAdapter({
    driver,
    schemaMismatchPolicy: `sync-absent-error`,
    appliedTxPruneMaxRows: 0,
    appliedTxPruneMaxAgeSeconds: 0,
  })
  return {
    driver,
    persistence: {
      adapter,
      coordinator: new SingleProcessCoordinator(),
    },
  }
}

function createPersistedTx(
  collectionId: string,
  sequence: number,
  mutationsPerPersist: number,
): PersistedTx {
  return {
    txId: `${collectionId}-tx-${sequence}`,
    term: 1,
    seq: sequence,
    rowVersion: sequence,
    mutations: Array.from({ length: mutationsPerPersist }, (_, index) => ({
      type: `insert` as const,
      key: `${sequence}-${index}`,
      value: {
        id: `${sequence}-${index}`,
        value: sequence * 100 + index,
      },
    })),
  }
}

function createFairnessReference(
  scenario: SharedDriverFairnessScenario,
  fairnessBound: number,
): ReadonlyArray<FairnessReferenceCheckpoint> {
  const persistIds = scenario.work
    .filter((work) => work.kind === `persist`)
    .map((work) => collectionIdFor(scenario, work))
  const hydrateIds = scenario.work
    .filter((work) => work.kind === `hydrate`)
    .map((work) => collectionIdFor(scenario, work))

  return hydrateIds.map((collectionId, hydrateIndex) => {
    // The first persist is the one already executing when hydrate work reaches
    // the queue. The ordered reference then permits at most K additional
    // persists between successive hydrate completions, preserving FIFO order
    // within each logical lane.
    const expectedMaximumCompletedPersists = Math.min(
      persistIds.length,
      persistIds.length === 0 ? 0 : 1 + hydrateIndex * fairnessBound,
    )
    return {
      collectionId,
      expectedMaximumCompletedPersists,
      expectedMinimumPendingPersists:
        persistIds.length - expectedMaximumCompletedPersists,
      permittedCompletedPersistIds: persistIds.slice(
        0,
        expectedMaximumCompletedPersists,
      ),
    }
  })
}

export function findSharedDriverFairnessViolation(
  observation: SharedDriverFairnessObservation,
  fairnessBound = SHARED_DRIVER_FAIRNESS_BOUND,
): SharedDriverFairnessViolation | undefined {
  const reference = createFairnessReference(observation.scenario, fairnessBound)
  for (const [
    hydrateIndex,
    checkpoint,
  ] of observation.hydrationCompletions.entries()) {
    const expected = reference[hydrateIndex]
    if (!expected) continue
    const permitted = new Set(expected.permittedCompletedPersistIds)
    const unexpectedCompletedPersistIds = checkpoint.completedPersistIds.filter(
      (id) => !permitted.has(id),
    )
    if (
      checkpoint.collectionId !== expected.collectionId ||
      checkpoint.completedPersistIds.length >
        expected.expectedMaximumCompletedPersists ||
      checkpoint.pendingPersistCount <
        expected.expectedMinimumPendingPersists ||
      unexpectedCompletedPersistIds.length > 0
    ) {
      return {
        checkpoint,
        expectedCollectionId: expected.collectionId,
        expectedMaximumCompletedPersists:
          expected.expectedMaximumCompletedPersists,
        expectedMinimumPendingPersists: expected.expectedMinimumPendingPersists,
        permittedCompletedPersistIds: expected.permittedCompletedPersistIds,
        unexpectedCompletedPersistIds,
      }
    }
  }
  return undefined
}

/** Checker calibration only; the executable hostile control uses the fixture. */
export function createPersistFirstFaultObservation(
  scenario: SharedDriverFairnessScenario,
): SharedDriverFairnessObservation {
  const persistIds = scenario.work
    .filter((work) => work.kind === `persist`)
    .map((work) => collectionIdFor(scenario, work))
  const firstHydrate = scenario.work.find((work) => work.kind === `hydrate`)
  if (!firstHydrate) throw new Error(`fault observation requires a hydrate`)
  const firstHydrateId = collectionIdFor(scenario, firstHydrate)
  return {
    scenario,
    admittedHydrateIds: [firstHydrateId],
    logicalCompletionOrder: [
      ...persistIds.map((id) => `persist:${id}`),
      `hydrate:${firstHydrateId}`,
    ],
    hydrationCompletions: [
      {
        collectionId: firstHydrateId,
        completionOrdinal: persistIds.length,
        completedPersistIds: persistIds,
        pendingPersistCount: 0,
        rawDequeueCount: persistIds.length + 1,
      },
    ],
    rawDequeues: [],
    driverAdmissions: [],
    hydratedCollections: [],
    cleanupFailures: [],
  }
}

/**
 * Runs the public persisted-collection startup path over one shared
 * BrowserWASQLiteDriver. The expected scheduler is deliberately not imported:
 * the oracle observes only logical admissions/completions and raw SQL dequeue.
 */
export async function observeSharedDriverFairness(
  openDatabase: BrowserWASQLiteDatabaseFactory,
  scenario: SharedDriverFairnessScenario,
  options: SharedDriverFairnessOptions = {},
): Promise<SharedDriverFairnessObservation> {
  validateScenario(scenario)

  const hydrateWork = scenario.work.filter((work) => work.kind === `hydrate`)
  const persistWork = scenario.work.filter((work) => work.kind === `persist`)
  const hydrateIds = hydrateWork.map((work) => collectionIdFor(scenario, work))
  const persistIds = persistWork.map((work) => collectionIdFor(scenario, work))
  const admittedHydrateIds: Array<string> = []
  const allHydratesRequested = createDeferred()

  // A separate connection and adapter own seed/setup. Closing and reopening
  // makes every measured hydration cold at the adapter and driver layers.
  const seedDatabase = await openDatabase()
  const seed = createSharedPersistence(seedDatabase)
  let seedPrimaryFailure: unknown
  try {
    for (const work of hydrateWork) {
      const collectionId = collectionIdFor(scenario, work)
      await seed.persistence.adapter.applyCommittedTx(collectionId, {
        txId: `${collectionId}-seed`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: work.seededRows.map((row) => ({
          type: `insert` as const,
          key: row.id,
          value: { ...row },
        })),
      })
    }
    for (const collectionId of persistIds) {
      await seed.persistence.adapter.loadSubset(collectionId, {})
    }
  } catch (error) {
    seedPrimaryFailure = error
  }
  let seedCleanupFailure: unknown
  try {
    await seed.driver.close()
  } catch (error) {
    seedCleanupFailure = error
  }
  if (seedPrimaryFailure !== undefined) {
    if (seedCleanupFailure !== undefined) {
      throw new Error(
        `${failureMessage(seedPrimaryFailure)}; seed cleanup diagnostics: ${failureMessage(seedCleanupFailure)}`,
      )
    }
    throw seedPrimaryFailure
  }
  if (seedCleanupFailure !== undefined) throw seedCleanupFailure

  const observedDatabase = new ObservedDatabase(await openDatabase())
  const { driver, persistence } = createSharedPersistence(
    observedDatabase,
    undefined,
    options.schedulingFault,
  )

  const collections: Array<Collection<FairnessRow, string>> = []
  const persistPromises: Array<Promise<void>> = []
  const preloadPromises: Array<Promise<void>> = []
  const logicalCompletionOrder: Array<string> = []
  const completedPersistIds: Array<string> = []
  const hydrationCompletions: Array<HydrationCompletionCheckpoint> = []
  const observedRows = new Map<string, ReadonlyArray<FairnessRow>>()
  const cleanupFailures: Array<string> = []
  let releaseHeldBegin: (() => void) | undefined
  let beginEntered: Promise<void> | undefined
  let persistSequence = 0
  let primaryFailure: unknown
  let observation: SharedDriverFairnessObservation | undefined

  try {
    // Cache only the unrelated persist tables. Hydrate tables remain cold.
    for (const collectionId of persistIds) {
      await persistence.adapter.loadSubset(collectionId, {})
    }

    observedDatabase.clearTrace()
    driver.clearAdmissions()

    if (persistIds.length > 0) {
      const heldBegin = observedDatabase.holdNextTransactionBegin()
      releaseHeldBegin = heldBegin.release
      beginEntered = heldBegin.entered
    }

    // Admit the explicit legal history while the first persist is held. The
    // first item is the non-preemptible transaction; every tail permutation
    // is therefore observable at the same deterministic release checkpoint.
    for (const work of scenario.work) {
      const collectionId = collectionIdFor(scenario, work)
      if (work.kind === `persist`) {
        persistSequence += 1
        const sequence = persistSequence
        const persist = persistence.adapter
          .applyCommittedTx(
            collectionId,
            createPersistedTx(collectionId, sequence, work.mutationsPerPersist),
          )
          .then(() => {
            completedPersistIds.push(collectionId)
            logicalCompletionOrder.push(`persist:${collectionId}`)
          })
        persistPromises.push(persist)
        continue
      }

      const collection = createCollection(
        persistedCollectionOptions<FairnessRow, string>({
          id: collectionId,
          getKey: (row) => row.id,
          persistence,
        }),
      )
      collections.push(collection)
      const preloadRequest = collection.preload()
      admittedHydrateIds.push(collectionId)
      if (admittedHydrateIds.length === hydrateIds.length) {
        allHydratesRequested.resolve()
      }
      const preload = preloadRequest.then(() => {
        logicalCompletionOrder.push(`hydrate:${collectionId}`)
        observedRows.set(
          collectionId,
          collection.toArray.map((row) => ({ id: row.id, value: row.value })),
        )
        hydrationCompletions.push({
          collectionId,
          completionOrdinal: logicalCompletionOrder.length - 1,
          completedPersistIds: [...completedPersistIds],
          pendingPersistCount: persistIds.length - completedPersistIds.length,
          rawDequeueCount: observedDatabase.rawDequeues.length,
        })
      })
      preloadPromises.push(preload)
    }

    await beginEntered
    await allHydratesRequested.promise
    // Every public preload request is now pending. Releasing the one
    // non-preemptible persist here leaves production responsible for admitting
    // and completing each full logical hydrate under the approved scheduler.
    releaseHeldBegin?.()
    releaseHeldBegin = undefined

    await Promise.all([...persistPromises, ...preloadPromises])

    observation = {
      scenario,
      admittedHydrateIds,
      logicalCompletionOrder,
      hydrationCompletions,
      driverAdmissions: driver.admissions.map((entry) => ({
        ...entry,
        params: [...entry.params],
      })),
      rawDequeues: observedDatabase.rawDequeues.map((entry) => ({
        ...entry,
        params: [...entry.params],
      })),
      hydratedCollections: hydrateWork.map((work) => {
        const collectionId = collectionIdFor(scenario, work)
        return {
          collectionId,
          rows:
            observedRows.get(collectionId)?.map((row) => ({ ...row })) ?? [],
        }
      }),
      cleanupFailures,
    }
  } catch (error) {
    primaryFailure = error
  } finally {
    releaseHeldBegin?.()
    await Promise.allSettled([...persistPromises, ...preloadPromises])
    for (const collection of collections) {
      try {
        await collection.cleanup()
      } catch (error) {
        cleanupFailures.push(failureMessage(error))
      }
    }
    try {
      await driver.close()
    } catch (error) {
      cleanupFailures.push(failureMessage(error))
    }
  }

  if (primaryFailure !== undefined) {
    if (cleanupFailures.length > 0) {
      throw new Error(
        `${failureMessage(primaryFailure)}; active cleanup diagnostics: ${JSON.stringify(cleanupFailures)}`,
      )
    }
    throw primaryFailure
  }
  if (!observation) {
    throw new Error(`shared-driver observation ended without a result`)
  }
  return observation
}
