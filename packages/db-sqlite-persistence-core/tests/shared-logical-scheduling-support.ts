import {
  SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY,
  forwardSQLiteDriverSharedLogicalScheduling,
} from '../src'
import type { SQLiteDriver } from '../src'

// Fixtures and fake drivers for the shared logical scheduling oracle and its
// ordinary scenario tests. The oracle in `shared-logical-scheduling-oracle.test.ts`
// owns the law.

export type Deferred = {
  promise: Promise<void>
  resolve: () => void
}

export function createDeferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

export function fixtureQueryRows<T>(sql: string): ReadonlyArray<T> {
  if (sql.includes(`FROM collection_registry`)) {
    return [
      {
        table_name: `c_fixture`,
        tombstone_table_name: `t_fixture`,
        schema_version: 1,
      } as T,
    ]
  }
  return []
}

export function isMetadataQuery(sql: string): boolean {
  return sql.includes(`FROM collection_metadata`)
}

export class FirstQueryGatedDriver implements SQLiteDriver {
  readonly [SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY]: object
  readonly admissions: Array<string> = []
  readonly metadataAdmissions: Array<string> = []
  readonly firstQueryEntered = createDeferred()
  firstQueryAdmissionCount = 0
  onQuery: (() => void) | undefined
  private readonly firstQueryGate = createDeferred()
  private holdFirstQuery = true

  constructor(sharedLogicalSchedulingKey: object = {}) {
    this[SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY] =
      sharedLogicalSchedulingKey
  }

  exec(): Promise<void> {
    this.admissions.push(`exec`)
    return Promise.resolve()
  }

  async query<T>(sql: string): Promise<ReadonlyArray<T>> {
    this.admissions.push(`query`)
    if (isMetadataQuery(sql)) {
      this.metadataAdmissions.push(`query`)
      this.onQuery?.()
    }
    if (this.holdFirstQuery && isMetadataQuery(sql)) {
      this.holdFirstQuery = false
      this.firstQueryAdmissionCount = this.admissions.length
      this.firstQueryEntered.resolve()
      await this.firstQueryGate.promise
    }
    return fixtureQueryRows<T>(sql)
  }

  run(): Promise<void> {
    this.admissions.push(`run`)
    return Promise.resolve()
  }

  transaction<T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    this.admissions.push(`transaction`)
    return fn(this)
  }

  releaseFirstQuery(): void {
    this.firstQueryGate.resolve()
  }
}

export class PromiseBrandedFirstQueryGatedDriver implements SQLiteDriver {
  readonly admissions: Array<string> = []
  readonly metadataAdmissions: Array<string> = []
  readonly firstQueryEntered = createDeferred()
  firstQueryAdmissionCount = 0
  private readonly firstQueryGate = createDeferred()
  private holdFirstQuery = true

  constructor(private readonly schedulingKey: object = {}) {}

  exec(): Promise<void> {
    this.admissions.push(`exec`)
    return this.brand(Promise.resolve())
  }

  query<T>(sql: string): Promise<ReadonlyArray<T>> {
    this.admissions.push(`query`)
    if (isMetadataQuery(sql)) this.metadataAdmissions.push(`query`)
    const result = (async () => {
      if (this.holdFirstQuery && isMetadataQuery(sql)) {
        this.holdFirstQuery = false
        this.firstQueryAdmissionCount = this.admissions.length
        this.firstQueryEntered.resolve()
        await this.firstQueryGate.promise
      }
      return fixtureQueryRows<T>(sql)
    })()
    return this.brand(result)
  }

  run(): Promise<void> {
    this.admissions.push(`run`)
    return this.brand(Promise.resolve())
  }

  transaction<T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    this.admissions.push(`transaction`)
    return this.brand(fn(this))
  }

  releaseFirstQuery(): void {
    this.firstQueryGate.resolve()
  }

  private brand<T>(promise: Promise<T>): Promise<T> {
    Object.defineProperty(
      promise,
      SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY,
      { value: this.schedulingKey },
    )
    return promise
  }
}

export class UnbrandedPromiseLookupDriver implements SQLiteDriver {
  schedulingKeyLookups = 0

  exec(): Promise<void> {
    return this.unbranded(Promise.resolve())
  }

  query<T>(sql: string): Promise<ReadonlyArray<T>> {
    return this.unbranded(Promise.resolve(fixtureQueryRows<T>(sql)))
  }

  run(): Promise<void> {
    return this.unbranded(Promise.resolve())
  }

  transaction<T>(
    fn: (transactionDriver: SQLiteDriver) => Promise<T>,
  ): Promise<T> {
    return this.unbranded(fn(this))
  }

  private unbranded<T>(promise: Promise<T>): Promise<T> {
    Object.defineProperty(
      promise,
      SQLITE_DRIVER_SHARED_LOGICAL_SCHEDULING_KEY,
      {
        configurable: true,
        get: () => {
          this.schedulingKeyLookups++
          return undefined
        },
      },
    )
    return promise
  }
}

export function createTransparentWrapper(driver: SQLiteDriver): SQLiteDriver {
  return forwardSQLiteDriverSharedLogicalScheduling(driver, {
    exec: (sql) => driver.exec(sql),
    query: <T>(sql: string, params: ReadonlyArray<unknown> = []) =>
      driver.query<T>(sql, params),
    run: (sql, params = []) => driver.run(sql, params),
    transaction: <T>(fn: (transactionDriver: SQLiteDriver) => Promise<T>) =>
      driver.transaction(fn),
    transactionWithDriver: <T>(
      fn: (transactionDriver: SQLiteDriver) => Promise<T>,
    ) =>
      driver.transactionWithDriver
        ? driver.transactionWithDriver(fn)
        : driver.transaction(fn),
  })
}
