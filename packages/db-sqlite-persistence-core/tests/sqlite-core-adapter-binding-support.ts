/**
 * Support for the SQLite subset binding-capacity oracle: the predicate
 * specifications, the production driver with its binding cap, the observation,
 * the independent model (expectedBindingRows), and the check (violation). The
 * oracle file owns the law, its histories, and its registered tests. This
 * module is ordinary: it registers no tests.
 */
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { inspect } from 'node:util'
import { IR } from '@tanstack/db'
import { SQLiteCorePersistenceAdapter } from '../src'
import type { SQLiteDriver } from '../src'

export const BINDING_CAP = 999
export type Kind = 'string' | 'number' | 'boolean' | 'date' | 'bigint'
export type Scalar = string | number | boolean | Date | bigint
export type Clause = {
  field: 'a' | 'b'
  kind: 'in' | 'eq'
  values: ReadonlyArray<Scalar>
}
export type Spec = {
  label: string
  valueKind: Kind
  connective: 'and' | 'or'
  clauses: ReadonlyArray<Clause>
  nested?: boolean
  ordered?: boolean
  rows?: ReadonlyArray<Row>
}
export type Row = { key: string; value: { a: Scalar; b: Scalar } }
export type Attempt = {
  method: 'exec' | 'query' | 'run'
  sql: string
  bindings: number
  error?: string
}

function target(kind: Kind): Scalar {
  switch (kind) {
    case 'string':
      return 'target'
    case 'number':
      return 123_456
    case 'boolean':
      return true
    case 'date':
      return new Date('2026-01-01T00:00:00.000Z')
    case 'bigint':
      return 9_007_199_254_740_993n
  }
}
function miss(kind: Kind, ordinal: number): Scalar {
  switch (kind) {
    case 'string':
      return `miss-${ordinal}`
    case 'number':
      return ordinal
    case 'boolean':
      return false
    case 'date':
      return new Date(Date.UTC(2020, 0, 1 + ordinal))
    case 'bigint':
      return 9_007_199_254_751_000n + BigInt(ordinal)
  }
}
function values(kind: Kind, length: number): Array<Scalar> {
  const result = Array.from({ length }, (_, index) => miss(kind, index))
  if (length) result[Math.floor(length / 2)] = target(kind)
  return result
}
function same(left: Scalar, right: Scalar): boolean {
  return left instanceof Date && right instanceof Date
    ? left.getTime() === right.getTime()
    : left === right
}
export function expectedBindingRows(
  spec: Spec,
  rows: ReadonlyArray<Row>,
): Array<string> {
  return rows
    .filter((row) => {
      const decisions = spec.clauses.map((clause) => {
        const field = row.value[clause.field]
        return clause.kind === 'eq'
          ? same(field, clause.values[0]!)
          : clause.values.some((candidate) => same(field, candidate))
      })
      if (spec.nested) return (decisions[0] || decisions[1]) && decisions[2]
      return spec.connective === 'and'
        ? decisions.every(Boolean)
        : decisions.some(Boolean)
    })
    .sort((a, b) =>
      spec.ordered
        ? String(a.value.a).localeCompare(String(b.value.a))
        : a.key.localeCompare(b.key),
    )
    .map((row) => row.key)
}
export function predicate(spec: Spec): IR.BasicExpression<boolean> {
  const clauses = spec.clauses.map(
    (clause) =>
      new IR.Func(clause.kind, [
        new IR.PropRef([clause.field]),
        new IR.Value(
          clause.kind === 'eq' ? clause.values[0] : [...clause.values],
        ),
      ]),
  )
  if (spec.nested)
    return new IR.Func('and', [
      new IR.Func('or', [clauses[0]!, clauses[1]!]),
      clauses[2]!,
    ])
  return clauses.length === 1
    ? clauses[0]!
    : new IR.Func(spec.connective, clauses)
}

export function preparedDriver(
  db: DatabaseSync,
  attempts: Array<Attempt>,
  withDriver = false,
  cap = BINDING_CAP,
  omitTransactionCap = false,
  forceControlledCap = false,
) {
  let record = false
  let nextSavepoint = 0
  const nativeCap = (
    db as DatabaseSync & { limits?: { variableNumber: number } }
  ).limits?.variableNumber
  const controlledCap = forceControlledCap || nativeCap === undefined
  function checkCapacity(bindings: number): void {
    if (controlledCap && bindings > cap)
      throw new RangeError(
        `host parameter limit exceeded: ${bindings} > ${cap}`,
      )
  }
  const driver: SQLiteDriver & { startObservation: () => void } = {
    maxBoundParameters: cap,
    startObservation() {
      record = true
    },
    exec(sql: string): Promise<void> {
      const attempt: Attempt = { method: 'exec', sql, bindings: 0 }
      if (record) attempts.push(attempt)
      try {
        db.exec(sql)
        return Promise.resolve()
      } catch (error) {
        attempt.error = String(error)
        return Promise.reject(error)
      }
    },
    query<T>(
      sql: string,
      params: ReadonlyArray<unknown> = [],
    ): Promise<ReadonlyArray<T>> {
      const attempt: Attempt = { method: 'query', sql, bindings: params.length }
      if (record) attempts.push(attempt)
      try {
        checkCapacity(params.length)
        return Promise.resolve(
          db
            .prepare(sql)
            .all(
              ...(params as Array<null | number | bigint | string>),
            ) as Array<T>,
        )
      } catch (error) {
        attempt.error = String(error)
        return Promise.reject(error)
      }
    },
    run(sql: string, params: ReadonlyArray<unknown> = []): Promise<void> {
      const attempt: Attempt = { method: 'run', sql, bindings: params.length }
      if (record) attempts.push(attempt)
      try {
        checkCapacity(params.length)
        db.prepare(sql).run(
          ...(params as Array<null | number | bigint | string>),
        )
        return Promise.resolve()
      } catch (error) {
        attempt.error = String(error)
        return Promise.reject(error)
      }
    },
    async transaction<T>(
      fn: (transactionDriver: SQLiteDriver) => Promise<T>,
    ): Promise<T> {
      const savepoint = `oracle_${++nextSavepoint}`
      db.exec(`SAVEPOINT ${savepoint}`)
      try {
        const result = await fn(driver)
        db.exec(`RELEASE ${savepoint}`)
        return result
      } catch (error) {
        db.exec(`ROLLBACK TO ${savepoint}`)
        db.exec(`RELEASE ${savepoint}`)
        throw error
      }
    },
  }
  if (withDriver) {
    driver.transactionWithDriver = omitTransactionCap
      ? (fn) =>
          driver.transaction(() =>
            fn({
              exec: driver.exec,
              query: driver.query,
              run: driver.run,
              transaction: driver.transaction,
            }),
          )
      : driver.transaction
  }
  return driver
}

export function limitedDatabase(cap = BINDING_CAP): DatabaseSync {
  // Older Node versions ignore this option; preparedDriver then enforces the cap.
  const options = { limits: { variableNumber: cap } }
  const db = new DatabaseSync(
    ':memory:',
    options as unknown as NonNullable<
      ConstructorParameters<typeof DatabaseSync>[1]
    >,
  )
  const nativeCap = (
    db as DatabaseSync & { limits?: { variableNumber: number } }
  ).limits?.variableNumber
  if (nativeCap !== undefined)
    assert.equal(
      nativeCap,
      cap,
      'SQLite did not apply the requested variable limit',
    )
  return db
}

export type Observation = {
  expected: Array<string>
  expectedValues: Array<{ key: string; value: Row['value'] }>
  actual?: Array<string>
  actualValues?: Array<{ key: string; value: Row['value'] }>
  attempts: Array<Attempt>
  error?: string
  cleanupError?: string
}
export async function observe(
  spec: Spec,
  withDriver = false,
  cap = BINDING_CAP,
  omitTransactionCap = false,
): Promise<Observation> {
  const db = limitedDatabase(cap)
  const attempts: Array<Attempt> = []
  let observation: Observation | undefined
  try {
    const driver = preparedDriver(
      db,
      attempts,
      withDriver,
      cap,
      omitTransactionCap,
    )
    const adapter = new SQLiteCorePersistenceAdapter({ driver })
    const rows: Array<Row> = spec.rows
      ? [...spec.rows]
      : [
          {
            key: 'target',
            value: { a: target(spec.valueKind), b: target(spec.valueKind) },
          },
          {
            key: 'partial',
            value: {
              a: target(spec.valueKind),
              b: miss(spec.valueKind, 10_000),
            },
          },
          {
            key: 'miss',
            value: {
              a: miss(spec.valueKind, 10_001),
              b: miss(spec.valueKind, 10_002),
            },
          },
        ]
    const expected = expectedBindingRows(spec, rows)
    const expectedValues = expected.map((key) => {
      const row = rows.find((candidate) => candidate.key === key)!
      return { key, value: row.value }
    })
    await adapter.applyCommittedTx(
      { kind: `eager`, collectionId: 'oracle-1993' },
      {
        txId: 'seed',
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: rows.map((row) => ({
          type: 'insert' as const,
          key: row.key,
          value: row.value,
        })),
      },
    )
    driver.startObservation()
    try {
      const result = await adapter.loadSubset(
        { kind: `eager`, collectionId: 'oracle-1993' },
        {
          where: predicate(spec),
          ...(spec.ordered
            ? {
                orderBy: [
                  {
                    expression: new IR.PropRef(['a']),
                    compareOptions: {
                      direction: 'asc' as const,
                      nulls: 'last' as const,
                    },
                  },
                ],
              }
            : {}),
        },
      )
      const actualValues = result.map((row) => ({
        key: String(row.key),
        value: row.value as Row['value'],
      }))
      if (!spec.ordered) actualValues.sort((a, b) => a.key.localeCompare(b.key))
      observation = {
        expected,
        expectedValues,
        actual: actualValues.map((row) => row.key),
        actualValues,
        attempts,
      }
    } catch (error) {
      observation = { expected, expectedValues, attempts, error: String(error) }
    }
  } finally {
    try {
      db.close()
    } catch (cleanupError) {
      observation ??= {
        expected: [],
        expectedValues: [],
        attempts,
        error: 'setup failed',
      }
      observation.cleanupError = String(cleanupError)
    }
  }
  return observation
}

export type Violation = {
  kind: 'reach' | 'capacity' | 'error' | 'rows' | 'cleanup'
  checkpoint: string
  message: string
}
export function violation(
  spec: Spec,
  observation: Observation,
  cap = BINDING_CAP,
): Violation | undefined {
  const predicateSelects = observation.attempts.filter(
    (entry) =>
      entry.method === 'query' &&
      entry.sql.startsWith('SELECT key, value, metadata, row_version'),
  )
  if (predicateSelects.length !== 1)
    return {
      kind: 'reach',
      checkpoint: 'driver-query',
      message: `predicate SELECT reach=${predicateSelects.length}`,
    }
  const over = observation.attempts.filter((entry) => entry.bindings > cap)
  if (over.length)
    return {
      kind: 'capacity',
      checkpoint: over.some((entry) => predicateSelects.includes(entry))
        ? 'predicate-select'
        : 'other-statement',
      message: `binding cap exceeded: ${over.map((entry) => entry.bindings)}; error=${observation.error ?? 'none'}`,
    }
  if (observation.error)
    return {
      kind: 'error',
      checkpoint: 'loadSubset-settlement',
      message: `loadSubset rejected ${observation.error}`,
    }
  try {
    assert.deepEqual(observation.actual, observation.expected)
    assert.deepEqual(observation.actualValues, observation.expectedValues)
  } catch {
    return {
      kind: 'rows',
      checkpoint: 'loadSubset-fulfillment',
      message: `rows ${inspect(observation.actualValues)} != ${inspect(observation.expectedValues)}`,
    }
  }
  if (observation.cleanupError)
    return {
      kind: 'cleanup',
      checkpoint: 'cleanup',
      message: `cleanup failed: ${observation.cleanupError}`,
    }
  return undefined
}

export function single(kind: Kind, count: number): Spec {
  return {
    label: `single-${kind}-${count}`,
    valueKind: kind,
    connective: 'or',
    clauses: [{ field: 'a', kind: 'in', values: values(kind, count) }],
  }
}
export function dual(
  kind: Kind,
  a: number,
  b: number,
  connective: 'and' | 'or',
): Spec {
  return {
    label: `dual-${kind}-${a}-${b}-${connective}`,
    valueKind: kind,
    connective,
    clauses: [
      { field: 'a', kind: 'in', values: values(kind, a) },
      { field: 'b', kind: 'in', values: values(kind, b) },
    ],
  }
}
export function mixed(kind: Kind, count: number): Spec {
  return {
    label: `mixed-${kind}-${count}+1`,
    valueKind: kind,
    connective: 'and',
    clauses: [
      { field: 'a', kind: 'in', values: values(kind, count) },
      { field: 'b', kind: 'eq', values: [target(kind)] },
    ],
  }
}
export function nested(kind: Kind, a: number, b: number): Spec {
  return {
    label: `nested-${kind}-${a}-${b}+1`,
    valueKind: kind,
    connective: 'and',
    nested: true,
    clauses: [
      { field: 'a', kind: 'in', values: values(kind, a) },
      { field: 'b', kind: 'in', values: values(kind, b) },
      { field: 'b', kind: 'eq', values: [target(kind)] },
    ],
  }
}
export function chunkBoundary(): Spec {
  const list = Array.from({ length: 1200 }, (_, i) => `miss-${i}`)
  list[100] = 'early'
  list[1100] = 'late'
  return {
    label: 'two-hits-across-900',
    valueKind: 'string',
    connective: 'or',
    ordered: true,
    clauses: [{ field: 'a', kind: 'in', values: list }],
    rows: [
      { key: 'late', value: { a: 'late', b: 'none' } },
      { key: 'miss', value: { a: 'other', b: 'none' } },
      { key: 'early', value: { a: 'early', b: 'none' } },
    ],
  }
}
export function escapedStringCase(): Spec {
  const escaped = `quote' newline\n snowman☃ null\u0000`
  return {
    label: `escaped-string-list`,
    valueKind: `string`,
    connective: `or`,
    clauses: [{ field: `a`, kind: `in`, values: [escaped, `different`] }],
    rows: [
      { key: `target`, value: { a: escaped, b: `other` } },
      { key: `miss`, value: { a: `another`, b: `other` } },
    ],
  }
}
export function bigintBoundary(value: bigint, label: string): Spec {
  return {
    label,
    valueKind: 'bigint',
    connective: 'or',
    clauses: [{ field: 'a', kind: 'in', values: [value] }],
    rows: [
      { key: 'target', value: { a: value, b: value } },
      { key: 'miss', value: { a: 0n, b: 0n } },
    ],
  }
}
export function legalSpec(spec: Spec): boolean {
  return (
    spec.clauses.length >= 1 &&
    spec.clauses.length <= 3 &&
    (!spec.nested || spec.clauses.length === 3) &&
    spec.clauses.every(
      (clause) => clause.kind === 'in' || clause.values.length === 1,
    )
  )
}
