// @vitest-environment node
import { fc } from '@fast-check/vitest'
import { expect } from 'vitest'
import { IR } from '@tanstack/db'
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import { SQLiteCorePersistenceAdapter } from '../src'
import { CountingDriver } from './sqlite-boolean-arity-support'
import type { Read } from './sqlite-boolean-arity-support'
import type { Observation } from '../../db/tests/oracle-property'

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
 * Grammar: AND/OR roots have 0..3 children; a child is one of twenty-five atoms or
 * a nested AND/OR of 0..3 atoms. The bounded matrix exhausts all atom pairs
 * for root arity 0..2 and samples triples and nested forms. Removing operator
 * choice loses empty true/false; removing arity 0 loses both identities;
 * removing arity 1 loses selective unary work; removing nonboolean atoms
 * loses SQL under-selection; removing unsupported atoms loses fallback; and
 * removing nesting loses inner empty-OR work. Unicode LIKE/ILIKE, tagged
 * NaN ordering, lone-surrogate equality, and null-vs-missing under NOT
 * challenge SQL equivalence. Number equality and membership atoms read a
 * field that stores Dates beside numbers: the evaluator equates a Date with
 * its epoch milliseconds, while SQLite holds the Date as ISO text. Their
 * coerced twins read a field that also stores 1n, true, '1', the epoch's ISO
 * text, NaN, 1.5 and null, which SQLite may admit and JavaScript must reject.
 * Removing the Dates loses the Date-as-text candidate; removing the coerced
 * field loses the extra candidates JavaScript must reject. Fixed mixed AND
 * cases cover child order, nesting, an unsafe OR sibling, and final rejection
 * of an indexed candidate.
 * A fixed 50,582-string-ID OR scope checks that both indexed branches retain
 * SQL candidate filtering with two bindings. Lone-surrogate, NUL, and paired
 * surrogate IDs challenge the JSON boundary used by that large scope.
 * Arity 3 is the upper marginal.
 * Malformed `caseWhen()` with no result arm is excluded because core rejects it.
 * Fixed-seed and unseeded generated campaigns use the same grammar, driver,
 * refinement check, and budget. The seed/path environment variables below
 * replay a reduced failure directly.
 *
 * Declared states (generated campaigns): a number equality or membership atom
 * decides some row while the whole predicate is pushable and selective, so
 * the work law judges its SQL candidate; and a coerced number atom decides
 * some row, so the public law judges the candidates that JavaScript must
 * reject. An atom decides a row when forcing it true rather than false changes
 * that row's membership. Two constructed histories per state splice the atom
 * into a generated predicate: as a root child beside the generated children,
 * or inside a nested group beside a generated group's atoms. Each records the
 * state it must enter, and the generated campaign's check rejects a history
 * that missed one.
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
 * A bounded string-IN work witness counts literal quoting at the compiler
 * boundary. Bound list values require no SQL literal construction, including
 * construction discarded before the receiving SELECT. Sizes 0, 1, 32 and 1,025
 * separate the empty branch, ordinary lists and lists beyond the binding cap.
 * This work observation does not assert a latency or total-allocation bound.
 *
 * Limits: simple rows, one SQLite process, ordinary loads and one cursor
 * composition. Number atoms use safe integers; fractional and unsafe numbers
 * keep a full read and are not exercised here. No native host, OPFS worker,
 * multi-process WAL, ordering comparator, typed bigint/date expression
 * beyond number equality, index-expression, arbitrary depth beyond the fixed
 * 80-level work witness, or unbounded arity claim.
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
  | 'eq-number'
  | 'in-number'
  | 'eq-number-coerced'
  | 'in-number-coerced'
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
  at: number | Date
  coerced?: unknown
}
type Failure = {
  law: 'public' | 'work' | 'compile' | 'candidate'
  checkpoint: 'loadSubset-return'
  model: Model
  expected: Array<string>
  actual: Array<string>
  read: Read
}

// Stored values that SQLite compares with the number 1 in some way: equal
// numbers and Dates, coerced BigInt and boolean, the epoch's ISO text, NaN,
// a fraction, and null.
const coercedValues: Array<unknown> = [
  1,
  new Date(1),
  1n,
  true,
  '1',
  new Date(1).toISOString(),
  Number.NaN,
  1.5,
  null,
  new Date(2),
  2,
]
const fixture: Array<Row> = Array.from({ length: 20 }, (_, index) => ({
  id: `row-${index + 1}`,
  'meta-field': index === 0 ? 'yes' : 'no',
  name: ['Ä', 'Äland', 'Alpha', '😀', '\uD800'][index] ?? 'other',
  n: index === 0 ? Number.NaN : index - 1,
  ...(index === 0 ? { x: null } : {}),
  at: [new Date(7), 7, 8, new Date(8), 70][index] ?? index * 100,
  ...(index < coercedValues.length ? { coerced: coercedValues[index] } : {}),
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
  'eq-number',
  'in-number',
  'eq-number-coerced',
  'in-number-coerced',
]
const atom = (name: Atom): Model => ({ kind: 'atom', atom: name })
const op = (kind: 'and' | 'or', ...children: Array<Model>): Model => ({
  kind,
  children,
})

// The evaluator compares a Date by its epoch milliseconds and every other
// value by strict equality, so 1n, true and '1' never equal the number 1.
function equalsNumber(value: unknown, target: number): boolean {
  return value instanceof Date ? value.getTime() === target : value === target
}

// Atoms whose value is forced, for `decides`.
type Forced = { names: ReadonlyArray<Atom>; value: boolean }

function valueOf(model: Model, row: Row, forced?: Forced): unknown {
  if (model.kind === 'atom') {
    if (forced?.names.includes(model.atom)) return forced.value
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
      case 'eq-number':
        return equalsNumber(row.at, 7)
      case 'in-number':
        return equalsNumber(row.at, 8) || equalsNumber(row.at, 70)
      case 'eq-number-coerced':
        return row.coerced == null ? null : equalsNumber(row.coerced, 1)
      case 'in-number-coerced':
        return row.coerced == null
          ? null
          : equalsNumber(row.coerced, 1) || equalsNumber(row.coerced, 2)
    }
  }
  const values = model.children.map((child) => valueOf(child, row, forced))
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
      'eq-number-coerced',
      'in-number-coerced',
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
      case 'eq-number':
        return new IR.Func('eq', [new IR.PropRef(['at']), new IR.Value(7)])
      case 'in-number':
        return new IR.Func('in', [
          new IR.PropRef(['at']),
          new IR.Value([8, 70]),
        ])
      case 'eq-number-coerced':
        return new IR.Func('eq', [new IR.Value(1), new IR.PropRef(['coerced'])])
      case 'in-number-coerced':
        return new IR.Func('in', [
          new IR.PropRef(['coerced']),
          new IR.Value([1, 2]),
        ])
    }
  }
  return new IR.Func(model.kind, model.children.map(toIR))
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

// The unmapper lets fixed and constructed histories shrink as generated ones.
const atomArb = fc.constantFrom(...atoms).map(atom, (value) => {
  const name = (value as { kind?: unknown; atom?: unknown } | null)?.atom
  if ((value as Model | null)?.kind !== 'atom' || !atoms.includes(name as Atom))
    throw new Error('not an atom')
  return name as Atom
})
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
type History = Extract<Model, { kind: 'and' | 'or' }>

// Whether forcing these atoms true rather than false changes some fixture
// row's membership, so the public rows depend on how SQL and the evaluator
// read them.
function decides(model: Model, names: ReadonlyArray<Atom>): boolean {
  return fixture.some(
    (row) =>
      (valueOf(model, row, { names, value: true }) === true) !==
      (valueOf(model, row, { names, value: false }) === true),
  )
}

const numberAtoms: ReadonlyArray<Atom> = ['eq-number', 'in-number']
const coercedAtoms: ReadonlyArray<Atom> = [
  'eq-number-coerced',
  'in-number-coerced',
]
// The declared states, each with the atoms it splices and its premise.
const numberStates = {
  'number equality decides a row in SQL': {
    atoms: numberAtoms,
    enters: (model: Model) =>
      canPush(model) &&
      expectedKeys(model).length < fixture.length &&
      decides(model, numberAtoms),
  },
  'coerced number equality decides a row': {
    atoms: coercedAtoms,
    enters: (model: Model) => decides(model, coercedAtoms),
  },
} as const
type NumberState = keyof typeof numberStates
const numberStateNames = Object.keys(numberStates) as Array<NumberState>
const statesOf = (model: Model) =>
  numberStateNames.filter((state) => numberStates[state].enters(model))

// Construction obligations, by the identity of each builder's fresh history.
const constructionStates = new WeakMap<History, ReadonlyArray<NumberState>>()

// Splices one of the state's atoms into a generated predicate, as a root
// child or inside a nested group, keeping the generated children that the
// state allows. A splice whose other children hide the atom falls back to the
// atom alone in the same position, which always decides a row.
function splice(state: NumberState, nested: boolean) {
  const { atoms: names, enters } = numberStates[state]
  return (generated: History): History => {
    const name = names[generated.children.length % names.length]!
    const kept = generated.children.filter(
      (child) =>
        state !== 'number equality decides a row in SQL' || canPush(child),
    )
    const group = kept.find((child): child is History => child.kind !== 'atom')
    const inner = generated.kind === 'and' ? 'or' : 'and'
    const place = (siblings: Array<Model>, groupAtoms: Array<Model>) => ({
      kind: generated.kind,
      children: nested
        ? [op(inner, atom(name), ...groupAtoms.slice(0, 2)), ...siblings]
        : [atom(name), ...siblings],
    })
    const others = kept.filter((child) => !nested || child !== group)
    const spliced = place(others.slice(0, 2), group?.children ?? [])
    const history = enters(spliced) ? spliced : place([], [])
    constructionStates.set(history, [state])
    return history
  }
}

const constructions = numberStateNames.flatMap((state) =>
  [false, true].map((nested) => ({
    name: `${state}, spliced ${nested ? 'in a nested group' : 'at the root'}`,
    enters: [state],
    build: splice(state, nested),
  })),
)

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

// A path replay of this property runs its random campaign only. A seed without
// a path reseeds that campaign.

async function judgeBooleanHistory(history: Model | undefined) {
  const driver = new CountingDriver()
  const adapter = new SQLiteCorePersistenceAdapter({ driver })

  async function check(model: Model): Promise<Array<Failure>> {
    driver.reads = []
    const expected = expectedKeys(model)
    let result
    try {
      result = await adapter.loadSubset(
        { kind: `eager`, collectionId: 'boolean-arity' },
        {
          where: toIR(model),
        },
      )
    } catch (error) {
      // A legal predicate owes its rows, so a rejection fails the public law.
      return [
        {
          law: 'public',
          checkpoint: 'loadSubset-return',
          model,
          expected,
          actual: [],
          read: {
            sql: `rejected: ${error instanceof Error ? error.message : String(error)}`,
            rawRows: 0,
            parameters: 0,
          },
        },
      ]
    }
    const actual = result.map((row) => String(row.key)).sort()
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

  async function runOracle(): Promise<void> {
    await adapter.applyCommittedTx(
      { kind: `eager`, collectionId: 'boolean-arity' },
      {
        txId: 'seed',
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: fixture.map((row) => ({
          type: 'insert' as const,
          key: row.id,
          value: structuredClone(row),
        })),
      },
    )
    if (history !== undefined) {
      await oracleAssertion('existing comparison at 452', async () =>
        expect(await check(history)).toEqual([]),
      )
      return
    }
    driver.reads = []
    const baseline = await adapter.loadSubset(
      { kind: `eager`, collectionId: 'boolean-arity' },
      {},
    )
    oracleAssertion('existing comparison at 460', () =>
      expect(baseline).toHaveLength(fixture.length),
    )
    oracleAssertion('existing comparison at 461', () =>
      expect(driver.reads).toHaveLength(1),
    )
    oracleAssertion('existing comparison at 462', () =>
      expect(driver.reads[0]?.rawRows).toBe(fixture.length),
    )
    oracleAssertion('existing comparison at 463', () =>
      expect(driver.reads[0]?.sql).not.toContain(' WHERE '),
    )

    const failures: Array<Failure> = []
    for (const model of matrix()) failures.push(...(await check(model)))
    driver.reads = []
    const emptyIn = await adapter.loadSubset(
      { kind: `eager`, collectionId: 'boolean-arity' },
      {
        where: toIR(atom('in-empty')),
      },
    )
    oracleAssertion('existing comparison at 474', () =>
      expect(emptyIn).toHaveLength(0),
    )
    oracleAssertion('existing comparison at 475', () =>
      expect(driver.reads).toHaveLength(1),
    )
    oracleAssertion('existing comparison at 476', () =>
      expect(driver.reads[0]?.rawRows).toBe(0),
    )
    oracleAssertion('existing comparison at 477', () =>
      expect(driver.reads[0]?.sql).toContain(' WHERE '),
    )

    // The cursor receiver forms two new AND nodes around the base predicate.
    // A root-only arity repair would leave this nested empty-OR work unbounded.
    driver.reads = []
    const cursorRows = await adapter.loadSubset(
      { kind: `eager`, collectionId: 'boolean-arity' },
      {
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
      },
    )
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
      'eq-number',
      'in-number',
      'eq-number-coerced',
      'in-number-coerced',
    ] as const) {
      directFailures.push(...(await check(atom(name))))
    }

    await oracleAssertion('existing comparison at 524', async () =>
      expect(await check(op('and', atom('unsupported-function')))).toEqual([]),
    )
    await oracleAssertion('existing comparison at 525', async () =>
      expect(await check(op('or', atom('unsupported-path')))).toEqual([]),
    )

    const mixedAnd = op('and', atom('first'), atom('gt-positive'))
    async function observeMixedAnd(model: Model = mixedAnd) {
      driver.reads = []
      const rows = await adapter.loadSubset(
        { kind: `eager`, collectionId: 'boolean-arity' },
        {
          where: toIR(model),
        },
      )
      return {
        keys: rows.map((row) => String(row.key)).sort(),
        read: driver.reads[0],
      }
    }
    const mixed = await observeMixedAnd()
    oracleAssertion('existing comparison at 542', () =>
      expect(mixed.keys).toEqual(['row-1']),
    ) // NaN compares above zero in core.
    oracleAssertion('existing comparison at 543', () =>
      expect(mixed.read?.sql).toContain(' WHERE '),
    )
    oracleAssertion('existing comparison at 544', () =>
      expect(mixed.read?.rawRows).toBe(1),
    ) // Certified id equality is selective.

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
      oracleAssertion('existing comparison at 557', () =>
        expect(observation.keys).toEqual(expectedKeys(model)),
      )
      oracleAssertion('existing comparison at 558', () =>
        expect(observation.read?.sql).toContain(' WHERE '),
      )
      oracleAssertion('existing comparison at 559', () =>
        expect(observation.read?.rawRows).toBe(1),
      )
    }

    driver.mutantDropWhere = true
    const droppedConjunct = await observeMixedAnd()
    driver.mutantDropWhere = false
    oracleAssertion('existing comparison at 565', () =>
      expect(droppedConjunct.keys).toEqual(mixed.keys),
    )
    oracleAssertion('existing comparison at 566', () =>
      expect(droppedConjunct.read?.rawRows).toBe(fixture.length),
    )
    oracleAssertion('existing comparison at 567', () =>
      expect(droppedConjunct.read?.rawRows).not.toBe(mixed.read?.rawRows),
    )

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
    const nestedRows = await adapter.loadSubset(
      { kind: `eager`, collectionId: 'boolean-arity' },
      {
        where: nested,
      },
    )
    oracleAssertion('existing comparison at 591', () =>
      expect(nestedRows).toHaveLength(fixture.length),
    )
    oracleAssertion('existing comparison at 592', () =>
      expect(argumentReads).toBeLessThanOrEqual(depth * 10),
    )

    driver.mutantPushUnsafeOr = true
    const unsafeOr = await check(
      op('or', atom('ilike-unicode-exact'), atom('false')),
    )
    driver.mutantPushUnsafeOr = false
    oracleAssertion('existing comparison at 599', () =>
      expect(unsafeOr.map((failure) => failure.law)).toContain('public'),
    )
    oracleAssertion('existing comparison at 600', () =>
      expect(
        unsafeOr.find((failure) => failure.law === 'public')?.read.sql,
      ).toContain(' WHERE '),
    )

    driver.mutantUnaryValue = 'x'
    await oracleAssertion('existing comparison at 605', async () =>
      expect(
        (await check(op('and', atom('word')))).map((failure) => failure.law),
      ).toContain('public'),
    )
    driver.mutantUnaryValue = 1
    const blindOr = await check(op('or', atom('one')))
    driver.mutantUnaryValue = undefined
    driver.mutantDropWhere = true
    await oracleAssertion('existing comparison at 612', async () =>
      expect(
        (await check(op('and', atom('first'), atom('true')))).map(
          (failure) => failure.law,
        ),
      ).toContain('work'),
    )
    driver.mutantDropWhere = false

    if (failures.length || directFailures.length || cursorWorkFailed) {
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
}
oracleProperty({
  id: `sqlite-persistence.boolean-arity`,
  law: {
    statement: `The retained independent SQLite model judges the existing legal histories at every original observation checkpoint.`,
    authority: `The existing contract and authority stated beside this oracle's model.`,
    limits: `The existing bounded SQLite histories, production paths, and observations, with declared reach only for the number equality atoms.`,
  },
  owns: [`src/sqlite-core-adapter.ts`],
  histories: {
    arbitrary: modelArb,
    runs: 150,
    fixedSeeds: [1994],
    states: numberStateNames,
    constructed: constructions,
  },
  resolve: (history) => ({
    history,
    requiredStates: constructionStates.get(history) ?? [],
  }),
  model: (plan, trace) => ({
    judgment: recordedAssertionJudgment(plan, trace),
    requiredStates: plan.requiredStates,
  }),
  // The declared states come from the history; the existing judgment decides
  // the laws. A driver error leaves no reach, so it stays a setup error.
  driver: async (plan, observe) => {
    await recordAssertionJudgment(
      `existing SQLite judgment`,
      plan,
      observe,
      () => judgeBooleanHistory(plan.history),
    )
    for (const state of statesOf(plan.history)) observe(`reach`, state)
  },
  check: (_plan, trace, owed) => {
    if (owed.judgment.kind !== `pass`) return owed.judgment
    const missing = owed.requiredStates.filter(
      (state) =>
        !trace.some(
          ({ checkpoint, value }) => checkpoint === `reach` && value === state,
        ),
    )
    return missing.length > 0
      ? violation(
          `constructed states`,
          `the constructed history did not enter ${missing.join(`, `)}`,
          `constructed reach`,
        )
      : pass
  },
  // One missing-state control per builder.
  calibrations: constructions.map(({ name, enters }) => ({
    name: `${name} omits its state`,
    law: `constructed reach`,
    history: { constructed: name },
    corrupt: (trace: ReadonlyArray<Observation>) =>
      trace.filter(
        ({ checkpoint, value }) =>
          checkpoint !== `reach` || !enters.includes(value as NumberState),
      ),
  })),
})
oracleProperty({
  id: `sqlite-persistence.boolean-arity-fixed`,
  law: {
    statement: `The retained independent SQLite model judges the existing legal histories at every original observation checkpoint.`,
    authority: `The existing contract and authority stated beside this oracle's model.`,
    limits: `The existing bounded SQLite histories, production paths, and observations; no expanded coverage claim.`,
  },
  histories: [{}],
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(`existing SQLite judgment`, plan, observe, () =>
      judgeBooleanHistory(undefined),
    ),
  check: forwardAssertionJudgment,
  timeout: 120_000,
})
