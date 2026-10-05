// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import { fc } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import { IR } from '@tanstack/db'
import { createPersistedTableName, SQLiteCorePersistenceAdapter } from '../src'
import type { SQLiteDriver } from '../src'

/**
 * # Boolean arity at the SQLite persistence boundary
 *
 * Contract: at `loadSubset` return, public rows refine the current core
 * evaluator's three-valued AND/OR law: empty AND is true, empty OR is false,
 * and only strict `true`/`false` operands determine a branch. Issue #1994
 * also requires sound SQL prefilters to reduce selective reads before SQLite
 * returns stored rows for deserialization. Empty AND must emit
 * a true SQL predicate; unsupported children may admit a sound candidate
 * prefilter, while the row evaluator decides the public result.
 * Open #506 proposes a conflicting future empty-OR API; this oracle follows
 * the current evaluator until the product contract changes across both layers.
 *
 * Reference: `valueOf` computes atom values from private fixture records and
 * folds an independent truth table. It does not call the core evaluator or
 * SQLite compiler. `canPush` describes this oracle's deliberately small
 * known-boolean domain, not production's support classifier.
 *
 * Grammar: AND/OR roots have 0..3 children; a child is one of twenty-one atoms or
 * a nested AND/OR of 0..3 atoms. The bounded matrix exhausts all atom pairs
 * for root arity 0..2 and samples triples and nested forms. Removing operator
 * choice loses empty true/false; removing arity 0 loses both identities;
 * removing arity 1 loses selective unary work; removing nonboolean atoms
 * loses SQL under-selection; removing unsupported atoms loses fallback; and
 * removing nesting loses inner empty-OR work. Unicode LIKE/ILIKE, tagged
 * NaN ordering, lone-surrogate equality, and null-vs-missing under NOT
 * challenge SQL equivalence. Fixed mixed AND cases cover child order,
 * nesting, an unsafe OR sibling, and final rejection of an indexed candidate.
 * A fixed 50,582-string-ID OR scope checks that both indexed branches retain
 * SQL candidate filtering with two bindings. Lone-surrogate, NUL, and paired
 * surrogate IDs challenge the JSON boundary used by that large scope.
 * Arity 3 is the upper marginal.
 * Malformed `caseWhen()` with no result arm is excluded because core rejects it.
 * Fixed-seed and unseeded generated campaigns use the same grammar, driver,
 * refinement check, and budget. The seed/path environment variables below
 * replay a reduced failure directly.
 *
 * Driver/checkpoint: the real adapter runs against `node:sqlite`; a counting
 * driver records the SQL and raw row count of each Collection SELECT. At
 * `loadSubset` return, public keys must match the reference. SQL-supported
 * selective predicates in this safe fixture must have `WHERE` and return
 * exactly the selected raw rows. Other predicates may read extra candidates,
 * but every public match must cross the SQL boundary.
 * A cursor witness checks both receiving SELECTs, and a removed-WHERE mutant
 * proves the work check fails even when final public keys remain correct.
 * The large string scope checks both named indexes in its SQLite query plan.
 *
 * Limits: simple rows, one SQLite process, ordinary loads and one cursor
 * composition. No native host, OPFS worker, multi-process WAL, ordering
 * comparator, typed bigint/date expression, index-expression, arbitrary
 * depth beyond the fixed 80-level work witness, or unbounded arity claim.
 * Raw-row work and the one named-index plan are not elapsed-time assertions.
 */

type Atom =
  | 'first'
  | 'last'
  | 'true'
  | 'false'
  | 'unknown'
  | 'word'
  | 'one'
  | 'text-ref'
  | 'unsupported-function'
  | 'unsupported-path'
  | 'in-empty'
  | 'like-prefix'
  | 'ilike-unicode-exact'
  | 'ilike-unicode-prefix'
  | 'ilike-ascii-prefix'
  | 'gt-positive'
  | 'eq-paired-surrogate'
  | 'eq-lone-surrogate'
  | 'not-is-undefined'
  | 'not-is-null'
  | 'like-emoji-two'
type Model =
  | { kind: 'atom'; atom: Atom }
  | {
      kind: 'and' | 'or'
      children: Array<Model>
    }
type Row = {
  id: string
  'meta-field': string
  name: string
  n: number
  x?: null
}
type Read = { sql: string; rawRows: number; parameters: number }
type Failure = {
  law: 'public' | 'work' | 'compile' | 'candidate'
  checkpoint: 'loadSubset-return'
  model: Model
  expected: Array<string>
  actual: Array<string>
  read: Read
}

const fixture: Array<Row> = Array.from({ length: 20 }, (_, index) => ({
  id: `row-${index + 1}`,
  'meta-field': index === 0 ? 'yes' : 'no',
  name: ['Ä', 'Äland', 'Alpha', '😀', '\uD800'][index] ?? 'other',
  n: index === 0 ? Number.NaN : index - 1,
  ...(index === 0 ? { x: null } : {}),
}))
const atoms: Array<Atom> = [
  'first',
  'last',
  'true',
  'false',
  'unknown',
  'word',
  'one',
  'text-ref',
  'unsupported-function',
  'unsupported-path',
  'in-empty',
  'like-prefix',
  'ilike-unicode-exact',
  'ilike-unicode-prefix',
  'ilike-ascii-prefix',
  'gt-positive',
  'eq-paired-surrogate',
  'eq-lone-surrogate',
  'not-is-undefined',
  'not-is-null',
  'like-emoji-two',
]
const atom = (name: Atom): Model => ({ kind: 'atom', atom: name })
const op = (kind: 'and' | 'or', ...children: Array<Model>): Model => ({
  kind,
  children,
})

function valueOf(model: Model, row: Row): unknown {
  if (model.kind === 'atom') {
    switch (model.atom) {
      case 'first':
      case 'unsupported-function':
      case 'unsupported-path':
        return row.id === 'row-1'
      case 'last':
        return row.id === 'row-20'
      case 'true':
        return true
      case 'false':
      case 'in-empty':
        return false
      case 'unknown':
        return null
      case 'word':
        return 'x'
      case 'one':
        return 1
      case 'text-ref':
        return row['meta-field']
      case 'like-prefix':
        return row.id.startsWith('row-1')
      case 'ilike-unicode-exact':
        return row.id === 'row-1'
      case 'ilike-unicode-prefix':
        return row.id === 'row-1' || row.id === 'row-2'
      case 'ilike-ascii-prefix':
        return row.id === 'row-3'
      case 'gt-positive':
        return Number.isNaN(row.n) || row.n > 0
      case 'eq-paired-surrogate':
        return row.name === '😀'
      case 'eq-lone-surrogate':
        return row.name === '\uD800'
      case 'not-is-undefined':
        return row.x !== undefined
      case 'not-is-null':
        return row.x !== null
      case 'like-emoji-two':
        return row.id === 'row-4'
    }
  }
  const values = model.children.map((child) => valueOf(child, row))
  if (model.kind === 'and') {
    if (values.some((value) => value === false)) return false
    if (values.some((value) => value == null)) return null
    return true
  }
  if (values.some((value) => value === true)) return true
  if (values.some((value) => value == null)) return null
  return false
}

function expectedKeys(model: Model): Array<string> {
  return fixture
    .filter((row) => valueOf(model, row) === true)
    .map((row) => row.id)
    .sort()
}

function canPush(model: Model): boolean {
  if (model.kind === 'atom') {
    return ![
      'word',
      'one',
      'text-ref',
      'unsupported-function',
      'unsupported-path',
      'ilike-unicode-exact',
      'ilike-unicode-prefix',
      'ilike-ascii-prefix',
      'gt-positive',
      'not-is-undefined',
      'not-is-null',
      'like-emoji-two',
    ].includes(model.atom)
  }
  return model.children.every(canPush)
}

function toIR(model: Model): IR.BasicExpression {
  if (model.kind === 'atom') {
    const first = () =>
      new IR.Func('eq', [new IR.PropRef(['id']), new IR.Value('row-1')])
    switch (model.atom) {
      case 'first':
        return first()
      case 'last':
        return new IR.Func('eq', [
          new IR.PropRef(['id']),
          new IR.Value('row-20'),
        ])
      case 'true':
        return new IR.Value(true)
      case 'false':
        return new IR.Value(false)
      case 'unknown':
        return new IR.Value(null)
      case 'word':
        return new IR.Value('x')
      case 'one':
        return new IR.Value(1)
      case 'text-ref':
        return new IR.PropRef(['meta-field'])
      case 'unsupported-function':
        return new IR.Func('caseWhen', [
          first(),
          new IR.Value(true),
          new IR.Value(false),
        ])
      case 'unsupported-path':
        return new IR.Func('eq', [
          new IR.PropRef(['meta-field']),
          new IR.Value('yes'),
        ])
      case 'in-empty':
        return new IR.Func('in', [new IR.PropRef(['id']), new IR.Value([])])
      case 'like-prefix':
        return new IR.Func('like', [
          new IR.PropRef(['id']),
          new IR.Value('row-1%'),
        ])
      case 'ilike-unicode-exact':
        return new IR.Func('ilike', [
          new IR.PropRef(['name']),
          new IR.Value('ä'),
        ])
      case 'ilike-unicode-prefix':
        return new IR.Func('ilike', [
          new IR.PropRef(['name']),
          new IR.Value('ä%'),
        ])
      case 'ilike-ascii-prefix':
        return new IR.Func('ilike', [
          new IR.PropRef(['name']),
          new IR.Value('al%'),
        ])
      case 'gt-positive':
        return new IR.Func('gt', [new IR.PropRef(['n']), new IR.Value(0)])
      case 'eq-paired-surrogate':
        return new IR.Func('eq', [new IR.PropRef(['name']), new IR.Value('😀')])
      case 'eq-lone-surrogate':
        return new IR.Func('eq', [
          new IR.PropRef(['name']),
          new IR.Value('\uD800'),
        ])
      case 'not-is-undefined':
        return new IR.Func('not', [
          new IR.Func('isUndefined', [new IR.PropRef(['x'])]),
        ])
      case 'not-is-null':
        return new IR.Func('not', [
          new IR.Func('isNull', [new IR.PropRef(['x'])]),
        ])
      case 'like-emoji-two':
        return new IR.Func('like', [
          new IR.PropRef(['name']),
          new IR.Value('__'),
        ])
    }
  }
  return new IR.Func(model.kind, model.children.map(toIR))
}

class CountingDriver implements SQLiteDriver {
  readonly db = new DatabaseSync(':memory:')
  reads: Array<Read> = []
  private depth = 0
  mutantUnaryValue: 'x' | 1 | undefined
  mutantDropWhere = false
  mutantPushUnsafeOr = false

  exec(sql: string): Promise<void> {
    this.db.exec(sql)
    return Promise.resolve()
  }
  run(sql: string, params: ReadonlyArray<unknown> = []): Promise<void> {
    this.db
      .prepare(sql)
      .run(...(params as Array<string | number | bigint | null>))
    return Promise.resolve()
  }
  query<T>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<ReadonlyArray<T>> {
    const collectionRead = sql.startsWith(
      'SELECT key, value, metadata, row_version FROM',
    )
    if (
      collectionRead &&
      this.mutantUnaryValue !== undefined &&
      !sql.includes(' WHERE ')
    ) {
      sql += ' WHERE (?)'
      params = [...params, this.mutantUnaryValue]
    }
    if (collectionRead && this.mutantDropWhere && sql.includes(' WHERE ')) {
      sql = sql.slice(0, sql.indexOf(' WHERE '))
      params = []
    }
    if (collectionRead && this.mutantPushUnsafeOr && !sql.includes(' WHERE ')) {
      sql += ` WHERE LOWER(json_extract(value, '$.name')) LIKE LOWER(?)`
      params = [...params, 'ä']
    }
    const rows = this.db
      .prepare(sql)
      .all(...(params as Array<string | number | bigint | null>)) as Array<T>
    if (collectionRead)
      this.reads.push({
        sql,
        rawRows: rows.length,
        parameters: params.length,
      })
    return Promise.resolve(rows)
  }
  async transaction<T>(fn: (driver: SQLiteDriver) => Promise<T>): Promise<T> {
    const depth = this.depth++
    this.db.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT nested_${depth}`)
    try {
      const result = await fn(this)
      this.db.exec(depth === 0 ? 'COMMIT' : `RELEASE SAVEPOINT nested_${depth}`)
      return result
    } catch (error) {
      this.db.exec(
        depth === 0 ? 'ROLLBACK' : `ROLLBACK TO SAVEPOINT nested_${depth}`,
      )
      if (depth > 0) this.db.exec(`RELEASE SAVEPOINT nested_${depth}`)
      throw error
    } finally {
      this.depth--
    }
  }
}

function matrix(): Array<Model> {
  const cases: Array<Model> = [
    op('and', atom('first')),
    op('or', atom('first')),
    op('and'),
    op('or'),
    op('and', atom('unsupported-function')),
    op('or', atom('unsupported-path')),
    op('and', atom('in-empty')),
    op('and', op('or', atom('first'))),
  ]
  for (const kind of ['and', 'or'] as const) {
    cases.push(op(kind))
    for (const name of atoms) cases.push(op(kind, atom(name)))
    for (const left of atoms)
      for (const right of atoms) {
        cases.push(op(kind, atom(left), atom(right)))
      }
    for (const name of [
      'first',
      'false',
      'word',
      'unsupported-function',
      'in-empty',
    ] as const) {
      cases.push(op(kind, atom(name), atom('true'), atom('last')))
    }
    for (const childKind of ['and', 'or'] as const) {
      for (const name of [
        'first',
        'word',
        'unsupported-function',
        'unsupported-path',
      ] as const) {
        cases.push(op(kind, op(childKind, atom(name))))
      }
    }
  }
  return cases
}

const atomArb = fc.constantFrom(...atoms).map(atom)
const nestedArb = fc.record({
  kind: fc.constantFrom('and' as const, 'or' as const),
  children: fc.array(atomArb, { minLength: 0, maxLength: 3 }),
})
const modelArb = fc.record({
  kind: fc.constantFrom('and' as const, 'or' as const),
  children: fc.array(fc.oneof(atomArb, nestedArb), {
    minLength: 0,
    maxLength: 3,
  }),
})

function brief(failure: Failure | undefined) {
  if (!failure) return undefined
  return {
    law: failure.law,
    checkpoint: failure.checkpoint,
    model: failure.model,
    expectedCount: failure.expected.length,
    actualCount: failure.actual.length,
    rawRows: failure.read.rawRows,
    hasWhere: failure.read.sql.includes(' WHERE '),
  }
}

it('refines boolean arity and SQL row work across generated SQLite loads', async () => {
  const driver = new CountingDriver()
  const adapter = new SQLiteCorePersistenceAdapter({ driver })

  async function check(model: Model): Promise<Array<Failure>> {
    driver.reads = []
    const result = await adapter.loadSubset('boolean-arity', {
      where: toIR(model),
    })
    const actual = result.map((row) => String(row.key)).sort()
    const expected = expectedKeys(model)
    const read = driver.reads[0]
    if (driver.reads.length !== 1 || !read) {
      throw new Error(
        `ordinary load must make one Collection SELECT; got ${driver.reads.length}`,
      )
    }
    const fail = (law: Failure['law']): Failure => ({
      law,
      checkpoint: 'loadSubset-return',
      model,
      expected,
      actual,
      read,
    })
    const failures: Array<Failure> = []
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      failures.push(fail('public'))
    if (
      canPush(model) &&
      expected.length < fixture.length &&
      (!read.sql.includes(' WHERE ') || read.rawRows !== expected.length)
    ) {
      failures.push(fail('work'))
    }
    if (
      model.kind === 'and' &&
      model.children.length === 0 &&
      (!read.sql.includes(' WHERE ') || read.parameters !== 0)
    ) {
      failures.push(fail('compile'))
    }
    if (read.rawRows < expected.length || read.rawRows > fixture.length)
      failures.push(fail('candidate'))
    return failures
  }

  const runs = Number(process.env.TANSTACK_DB_SQLITE_BOOLEAN_ORACLE_RUNS ?? 150)
  const replaySeed = process.env.TANSTACK_DB_SQLITE_BOOLEAN_ORACLE_SEED
  const replayPath = process.env.TANSTACK_DB_SQLITE_BOOLEAN_ORACLE_PATH
  if (!Number.isSafeInteger(runs) || runs < 1)
    throw new Error('oracle runs must be positive')
  if (replayPath !== undefined && !/^\d+(?::\d+)*$/.test(replayPath)) {
    throw new Error('oracle replay path must be numeric')
  }
  if (replaySeed !== undefined && !Number.isSafeInteger(Number(replaySeed))) {
    throw new Error('oracle replay seed must be an integer')
  }

  async function campaign(seed?: number, path?: string) {
    let original: Failure | undefined
    const property = fc.asyncProperty(modelArb, async (model) => {
      const failures = await check(model)
      if (failures.length === 0) return
      const originalLaw = original?.law
      const sameLaw = originalLaw
        ? failures.find((failure) => failure.law === originalLaw)
        : failures[0]
      if (!sameLaw) return
      original ??= sameLaw
      throw new Error(JSON.stringify(brief(sameLaw)))
    })
    const result = await fc.check(property, { seed, path, numRuns: runs })
    const reducedFailures = result.counterexample
      ? await check(result.counterexample[0])
      : []
    const reduced = reducedFailures.find(
      (failure) => failure.law === original?.law,
    )
    if (result.failed && original && !reduced) {
      throw new Error(`shrinking lost the ${original.law} law`)
    }
    return {
      failed: result.failed,
      seed: result.seed,
      path: result.counterexamplePath,
      counterexample: result.counterexample,
      original: brief(original),
      reduced: brief(reduced),
    }
  }

  async function runOracle(): Promise<void> {
    await adapter.applyCommittedTx('boolean-arity', {
      txId: 'seed',
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: fixture.map((row) => ({
        type: 'insert' as const,
        key: row.id,
        value: structuredClone(row),
      })),
    })
    if (replaySeed !== undefined) {
      const replay = await campaign(Number(replaySeed), replayPath)
      if (replay.failed)
        throw new Error(
          `direct boolean-arity replay RED: ${JSON.stringify(replay)}`,
        )
      return
    }

    driver.reads = []
    const baseline = await adapter.loadSubset('boolean-arity', {})
    expect(baseline).toHaveLength(fixture.length)
    expect(driver.reads).toHaveLength(1)
    expect(driver.reads[0]?.rawRows).toBe(fixture.length)
    expect(driver.reads[0]?.sql).not.toContain(' WHERE ')

    const failures: Array<Failure> = []
    for (const model of matrix()) failures.push(...(await check(model)))
    const fixed = await campaign(1994)
    const random = await campaign()

    driver.reads = []
    const emptyIn = await adapter.loadSubset('boolean-arity', {
      where: toIR(atom('in-empty')),
    })
    expect(emptyIn).toHaveLength(0)
    expect(driver.reads).toHaveLength(1)
    expect(driver.reads[0]?.rawRows).toBe(0)
    expect(driver.reads[0]?.sql).toContain(' WHERE ')

    // The cursor receiver forms two new AND nodes around the base predicate.
    // A root-only arity repair would leave this nested empty-OR work unbounded.
    driver.reads = []
    const cursorRows = await adapter.loadSubset('boolean-arity', {
      where: toIR(op('or')),
      orderBy: [
        {
          expression: new IR.PropRef(['id']),
          compareOptions: { direction: 'asc', nulls: 'last' },
        },
      ],
      limit: 2,
      cursor: {
        whereCurrent: toIR(atom('first')),
        whereFrom: new IR.Func('gt', [
          new IR.PropRef(['id']),
          new IR.Value('row-1'),
        ]),
      },
    })
    const cursorReads = driver.reads.slice()
    const cursorWorkFailed =
      cursorRows.length !== 0 ||
      cursorReads.length !== 2 ||
      cursorReads.some(
        (read) => !read.sql.includes(' WHERE ') || read.rawRows !== 0,
      )

    const directFailures: Array<Failure> = []
    for (const name of [
      'ilike-unicode-exact',
      'ilike-unicode-prefix',
      'ilike-ascii-prefix',
      'gt-positive',
      'eq-lone-surrogate',
      'not-is-undefined',
      'not-is-null',
      'like-emoji-two',
    ] as const) {
      directFailures.push(...(await check(atom(name))))
    }

    expect(await check(op('and', atom('unsupported-function')))).toEqual([])
    expect(await check(op('or', atom('unsupported-path')))).toEqual([])

    const mixedAnd = op('and', atom('first'), atom('gt-positive'))
    async function observeMixedAnd(model: Model = mixedAnd) {
      driver.reads = []
      const rows = await adapter.loadSubset('boolean-arity', {
        where: toIR(model),
      })
      return {
        keys: rows.map((row) => String(row.key)).sort(),
        read: driver.reads[0],
      }
    }
    const mixed = await observeMixedAnd()
    expect(mixed.keys).toEqual(['row-1']) // NaN compares above zero in core.
    expect(mixed.read?.sql).toContain(' WHERE ')
    expect(mixed.read?.rawRows).toBe(1) // Certified id equality is selective.

    for (const model of [
      op('and', atom('gt-positive'), atom('first')),
      op('and', op('and', atom('first'), atom('gt-positive'))),
      op(
        'and',
        atom('first'),
        op('or', atom('ilike-unicode-exact'), atom('false')),
      ),
      op('and', atom('first'), atom('not-is-null')),
    ]) {
      const observation = await observeMixedAnd(model)
      expect(observation.keys).toEqual(expectedKeys(model))
      expect(observation.read?.sql).toContain(' WHERE ')
      expect(observation.read?.rawRows).toBe(1)
    }

    driver.mutantDropWhere = true
    const droppedConjunct = await observeMixedAnd()
    driver.mutantDropWhere = false
    expect(droppedConjunct.keys).toEqual(mixed.keys)
    expect(droppedConjunct.read?.rawRows).toBe(fixture.length)
    expect(droppedConjunct.read?.rawRows).not.toBe(mixed.read?.rawRows)

    // A legal nested predicate should require work proportional to its depth.
    // Reading each node's `args` is a deterministic proxy for compiler visits.
    let argumentReads = 0
    let nested: IR.BasicExpression = new IR.Value(true)
    const depth = 80
    for (let index = 0; index < depth; index++) {
      const child: IR.BasicExpression = nested
      const node: IR.Func = new IR.Func('and', [child])
      Object.defineProperty(node, 'args', {
        get() {
          argumentReads++
          return [child]
        },
      })
      nested = node
    }
    const nestedRows = await adapter.loadSubset('boolean-arity', {
      where: nested,
    })
    expect(nestedRows).toHaveLength(fixture.length)
    expect(argumentReads).toBeLessThanOrEqual(depth * 10)

    driver.mutantPushUnsafeOr = true
    const unsafeOr = await check(
      op('or', atom('ilike-unicode-exact'), atom('false')),
    )
    driver.mutantPushUnsafeOr = false
    expect(unsafeOr.map((failure) => failure.law)).toContain('public')
    expect(
      unsafeOr.find((failure) => failure.law === 'public')?.read.sql,
    ).toContain(' WHERE ')

    driver.mutantUnaryValue = 'x'
    expect(
      (await check(op('and', atom('word')))).map((failure) => failure.law),
    ).toContain('public')
    driver.mutantUnaryValue = 1
    const blindOr = await check(op('or', atom('one')))
    driver.mutantUnaryValue = undefined
    driver.mutantDropWhere = true
    expect(
      (await check(op('and', atom('first'), atom('true')))).map(
        (failure) => failure.law,
      ),
    ).toContain('work')
    driver.mutantDropWhere = false

    if (
      failures.length ||
      directFailures.length ||
      fixed.failed ||
      random.failed ||
      cursorWorkFailed
    ) {
      const count = (law: Failure['law']) =>
        failures.filter((failure) => failure.law === law).length
      throw new Error(
        `Boolean-arity oracle RED on current SQLite adapter: ` +
          JSON.stringify({
            cases: matrix().length,
            failures: {
              public: count('public'),
              work: count('work'),
              compile: count('compile'),
              candidate: count('candidate'),
            },
            examples: failures
              .filter((failure) =>
                ['public', 'work', 'compile'].includes(failure.law),
              )
              .slice(0, 5)
              .map(brief),
            direct: directFailures.map(brief),
            fixed,
            random,
            cursorWorkFailed,
            cursorReads,
            blindOrOutcome:
              blindOr.length === 0
                ? 'survived: JS post-filter removed SQL over-selection'
                : 'assertion failure',
          }),
      )
    }
  }

  let primary: unknown
  let failed = false
  try {
    await runOracle()
  } catch (error) {
    failed = true
    primary = error
  }

  let cleanupError: unknown
  let cleanupFailed = false
  try {
    driver.db.close()
  } catch (error) {
    cleanupFailed = true
    cleanupError = error
  }

  if (failed && cleanupFailed) {
    throw new AggregateError(
      [primary, cleanupError],
      'SQLite oracle and cleanup failed',
      { cause: primary },
    )
  }
  if (failed) throw primary
  if (cleanupFailed) throw cleanupError
})

it('keeps large string-ID OR scopes selective at the SQLite boundary', async () => {
  const driver = new CountingDriver()
  const adapter = new SQLiteCorePersistenceAdapter({ driver })
  const collectionId = 'string-id-scope'
  const scopeRows = Array.from({ length: 20 }, (_, index) => ({
    issueId: `issue-${index}`,
    relatedIssueId:
      ['related-\uD800', 'related-\u0000', 'related-😀'][index] ??
      `related-${index}`,
  }))
  const ids = Array.from({ length: 50_582 }, (_, index) => `other-${index}`)
  ids[5_001] = 'related-\uD800'
  ids[25_291] = 'issue-1'
  ids[35_001] = 'related-\u0000'
  ids[45_001] = 'related-😀'
  const allowed = new Set(ids)

  try {
    await adapter.applyCommittedTx(collectionId, {
      txId: 'seed-string-scope',
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: scopeRows.map((row) => ({
        type: 'insert' as const,
        key: row.issueId,
        value: structuredClone(row),
      })),
    })
    for (const field of ['issueId', 'relatedIssueId']) {
      await adapter.ensureIndex(collectionId, field, {
        expressionSql: [JSON.stringify(new IR.PropRef([field]))],
      })
    }

    driver.reads = []
    const rows = await adapter.loadSubset(collectionId, {
      where: new IR.Func('and', [
        new IR.Func('or', [
          new IR.Func('in', [new IR.PropRef(['issueId']), new IR.Value(ids)]),
          new IR.Func('in', [
            new IR.PropRef(['relatedIssueId']),
            new IR.Value(ids),
          ]),
        ]),
      ]),
    })
    const expected = scopeRows
      .filter(
        (row) => allowed.has(row.issueId) || allowed.has(row.relatedIssueId),
      )
      .map((row) => row.issueId)
    expect(rows.map((row) => row.key).sort()).toEqual(expected.sort())
    expect(driver.reads).toHaveLength(1)
    expect(driver.reads[0]?.rawRows).toBe(expected.length)
    expect(driver.reads[0]?.parameters).toBe(2)
    const plan = driver.db
      .prepare(`EXPLAIN QUERY PLAN ${driver.reads[0]!.sql}`)
      .all(JSON.stringify(ids), JSON.stringify(ids)) as Array<{
      detail: string
    }>
    const tableName = createPersistedTableName(collectionId, 'c')
    expect(
      plan.some(
        ({ detail }) =>
          detail.startsWith(`SCAN ${tableName}`) ||
          detail.startsWith(`SCAN "${tableName}"`),
      ),
    ).toBe(false)
    for (const field of ['issueId', 'relatedIssueId']) {
      const index = driver.db
        .prepare(
          `SELECT index_name FROM persisted_index_registry WHERE collection_id = ? AND signature = ?`,
        )
        .get(collectionId, field) as { index_name: string }
      expect(
        plan.some(
          ({ detail }) =>
            detail.startsWith('SEARCH') && detail.includes(index.index_name),
        ),
      ).toBe(true)
    }
  } finally {
    driver.db.close()
  }
})
