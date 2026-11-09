/**
 * # Does every group keep a key of the Collection's key type?
 *
 * Law and source: a Collection's keys are strings or numbers (the `TKey`
 * constraint of every Collection type, and the `InvalidKeyError` that
 * optimistic mutations throw for any other key). A grouped live-query
 * Collection publishes one row per group, so each group needs its own key of
 * that type, whatever its group value is. Grouping by a nullable field is a
 * valid query, so a `null` or `undefined` group value must still produce a
 * string or number key. Maintainer decision (2026-10-27): the grouped key
 * matches the declared key type, rather than the type widening to nullish
 * keys. The guide does not fix the key's format, so the law fixes only its
 * type, uniqueness, and stability:
 *
 * - every published key is a string or a number;
 * - two groups never share a key, including a group value and a string that
 *   prints like it (`null` and `"null"`, `true` and `"true"`) or a string in
 *   the namespace TanStack DB reserves for its own encodings;
 * - a group that still exists after a change keeps its key, so the change
 *   publishes as an update of the same row.
 *
 * Model: `expectedGroups` partitions the rows that the plan leaves after each
 * step by an independent rule. Group values are equal when they have the same
 * type and the same value, with `NaN` equal to `NaN`. It does not import the
 * compiler, its value identity, or its key encoding.
 *
 * History grammar: rows draw group values from strings, numbers, `NaN`,
 * `null`, `undefined`, booleans, a bigint, strings that print like those
 * values, and strings in the reserved `\u0000tanstack-db:` namespace. Each
 * history then applies up to four synced changes: move a row to another group
 * value, delete a row, or insert a row. `resolve` turns a move or delete, which
 * names a row by index, into the concrete row id, so the model and driver read
 * the same plan.
 *
 * Constructed histories: each required state has one builder that splices its
 * steps at the front of a generated history. The steps after them stay
 * random, so the campaign also explores what follows each state. A builder that
 * omits its steps leaves its state unentered, and the framework rejects it.
 *
 * Production driver: a `mockSyncCollectionOptions` Collection and a public
 * `createLiveQueryCollection` that groups by the field and counts each group.
 * It observes the published rows and the Collection's size after preload and
 * after each synced change.
 *
 * Reach: a history enters a state when the model's groups at some checkpoint
 * have it, so reach is computed from the expected result, not from production.
 * The comparison below rejects production whenever it publishes a different
 * group set, so the two agree on every history that passes.
 *
 * Refinement check: after preload and after each synced change, the published
 * (group value, count) pairs equal the model's, every key is a string or a
 * number, the distinct key count equals the row count, and each group present
 * at the previous checkpoint has the same key.
 *
 * Known omissions: Dates, -0, objects, and multi-field groups are outside
 * this owner; the aggregate select oracle owns grouped values. The mock sync
 * source is a controlled provider; this oracle claims only the compiler's
 * keying of the rows it supplies.
 */
import fc from 'fast-check'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { count } from '../../src/query/builder/functions.js'
import { createCollection } from '../../src/collection/index.js'
import { declareOracle } from '../oracle-declaration.js'
import { differs, oracleProperty, pass, violation } from '../oracle-property.js'
import {
  asProductionError,
  errorViolation,
  isErrorObservation,
} from '../oracle-error-observation.js'
import { mockSyncCollectionOptions, withOracleCleanup } from '../utils.js'
import type { Observation, Verdict } from '../oracle-property.js'

type Row = { id: number; g: unknown }
type Change =
  | { kind: `move`; index: number; g: unknown }
  | { kind: `delete`; index: number }
  | { kind: `insert`; g: unknown }
type History = { rows: Array<unknown>; changes: Array<Change> }

// Concrete actions: a row id and its value, so no index needs resolving.
type Step =
  { kind: `skip` } | { kind: `insert` | `update` | `delete`; row: Row }
type Plan = { initial: Array<Row>; steps: Array<Step> }

// Values that a key encoding by `String(value)` cannot tell apart, values
// outside the key type, and strings in the reserved namespace that a naive
// encoding of those values could produce.
const groupDomain: ReadonlyArray<unknown> = [
  `a`,
  1,
  2,
  `1`,
  Number.NaN,
  null,
  undefined,
  true,
  false,
  10n,
  `null`,
  `undefined`,
  `true`,
  `10`,
  `\u0000tanstack-db:object:null`,
  `\u0000tanstack-db:boolean:true`,
]

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

// Two group values are equal when their type and value are equal.
function describeGroup(value: unknown): string {
  return `${typeof value}:${typeof value === `number` && Number.isNaN(value) ? `NaN` : String(value)}`
}

// The (group, count) pairs the query must publish, sorted by group.
function groupsOf(rows: ReadonlyMap<number, Row>): Array<[string, number]> {
  const groups = new Map<string, number>()
  for (const row of rows.values()) {
    const group = describeGroup(row.g)
    groups.set(group, (groups.get(group) ?? 0) + 1)
  }
  return [...groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

// The expected groups after preload (index 0) and after each step (index i+1).
function expectedGroups(plan: Plan): Array<Array<[string, number]>> {
  const rows = new Map(plan.initial.map((row) => [row.id, { ...row }]))
  const expected = [groupsOf(rows)]
  for (const step of plan.steps) {
    if (step.kind === `insert` || step.kind === `update`)
      rows.set(step.row.id, { ...step.row })
    else if (step.kind === `delete`) rows.delete(step.row.id)
    expected.push(groupsOf(rows))
  }
  return expected
}

// ---------------------------------------------------------------------------
// History grammar and resolution
// ---------------------------------------------------------------------------

const groupValue = fc.constantFrom(...groupDomain)

const historyArbitrary: fc.Arbitrary<History> = fc.record({
  rows: fc.array(groupValue, { minLength: 1, maxLength: 6 }),
  changes: fc.array(
    fc.oneof(
      fc.record({
        kind: fc.constant(`move` as const),
        index: fc.nat({ max: 7 }),
        g: groupValue,
      }),
      fc.record({
        kind: fc.constant(`delete` as const),
        index: fc.nat({ max: 7 }),
      }),
      fc.record({ kind: fc.constant(`insert` as const), g: groupValue }),
    ),
    { maxLength: 4 },
  ),
})

// Index-named moves and deletes become row ids. A change with no rows left is
// a skip: it still takes a checkpoint, as the synced change would.
function resolve(history: History): Plan {
  let nextId = 0
  const initial = history.rows.map((g) => ({ id: nextId++, g }))
  const current = initial.map((row) => ({ ...row }))
  const steps: Array<Step> = []
  for (const change of history.changes) {
    if (change.kind === `insert`) {
      const row = { id: nextId++, g: change.g }
      current.push(row)
      steps.push({ kind: `insert`, row: { ...row } })
    } else if (current.length === 0) {
      steps.push({ kind: `skip` })
    } else {
      const index = change.index % current.length
      const target = current[index]!
      if (change.kind === `delete`) {
        current.splice(index, 1)
        steps.push({ kind: `delete`, row: { ...target } })
      } else {
        target.g = change.g
        steps.push({ kind: `update`, row: { ...target } })
      }
    }
  }
  return { initial, steps }
}

// The `reached` predicate reads the model's groups, one checkpoint at a time.
const reachStates = [
  `nullish-group-published`,
  `lookalike-groups-published`,
  `group-key-kept-across-change`,
] as const

function reachedStates(
  _plan: Plan,
  _trace: unknown,
  expected: Array<Array<[string, number]>>,
): Array<(typeof reachStates)[number]> {
  const states = new Set<(typeof reachStates)[number]>()
  let previous = new Set<string>()
  for (const groups of expected) {
    const names = new Set(groups.map(([group]) => group))
    if (names.has(describeGroup(null)) || names.has(describeGroup(undefined)))
      states.add(`nullish-group-published`)
    const printed = new Set(
      [...names]
        .filter((group) => !group.startsWith(`string:`))
        .map((group) => group.slice(group.indexOf(`:`) + 1)),
    )
    if (
      [...names].some(
        (group) => group.startsWith(`string:`) && printed.has(group.slice(7)),
      )
    )
      states.add(`lookalike-groups-published`)
    if ([...names].some((group) => previous.has(group)))
      states.add(`group-key-kept-across-change`)
    previous = names
  }
  return [...states]
}

// ---------------------------------------------------------------------------
// Production driver and refinement check
// ---------------------------------------------------------------------------

let collectionSerial = 0

type Snapshot = {
  size: number
  rows: Array<{ keyType: string; key: unknown; g: unknown; n: number }>
}

// Collection ids carry a per-process serial. The serial is stripped from an
// error message here, so two runs of one history record the same observation.
function normalizedError(error: unknown): Error {
  const original = asProductionError(error)
  const copy = new Error(
    original.message.replace(/(live-query|group-key-source)-\d+/g, `$1`),
    { cause: original.cause },
  )
  copy.name = original.name
  copy.stack = original.stack
  return copy
}

// Each production call is observed at its checkpoint. An error raised by a
// call is the observation of that checkpoint, and it stops the history. Cleanup
// runs outside these catches, so a teardown failure is a setup error.
async function runHistory(
  plan: Plan,
  observe: (checkpoint: string, value: unknown) => void,
): Promise<void> {
  const serial = collectionSerial++
  const source = createCollection(
    mockSyncCollectionOptions<Row>({
      id: `group-key-source-${serial}`,
      getKey: (row) => row.id,
      initialData: plan.initial.map((row) => ({ ...row })),
    }),
  )
  const live = createLiveQueryCollection((q) =>
    q
      .from({ row: source })
      .groupBy(({ row }) => row.g)
      .select(({ row }) => ({ g: row.g, n: count(row.id) })),
  )
  const snapshot = (): Snapshot => ({
    size: live.size,
    rows: [...live.entries()].map(([key, row]) => ({
      keyType: typeof key,
      // A non-string, non-number key is reported by its type, not as data.
      key: typeof key === `string` || typeof key === `number` ? key : null,
      g: (row as { g: unknown }).g,
      n: (row as { n: number }).n,
    })),
  })
  // Returns false when the call raised, after observing the error.
  const observed = async (
    checkpoint: string,
    call: () => Promise<void> | void,
  ): Promise<boolean> => {
    let value: unknown
    try {
      await call()
      value = snapshot()
    } catch (error) {
      observe(checkpoint, normalizedError(error))
      return false
    }
    observe(checkpoint, value)
    return true
  }
  await withOracleCleanup(async () => {
    if (!(await observed(`after preload`, () => live.preload()))) return
    for (const [index, step] of plan.steps.entries()) {
      const written = await observed(
        `after change ${index} (${step.kind})`,
        () => {
          source.utils.begin()
          if (step.kind === `insert`)
            source.utils.write({ type: `insert`, value: { ...step.row } })
          else if (step.kind === `update`)
            source.utils.write({ type: `update`, value: { ...step.row } })
          else if (step.kind === `delete`)
            source.utils.write({ type: `delete`, value: { ...step.row } })
          source.utils.commit()
        },
      )
      if (!written) return
    }
  }, [() => live.cleanup(), () => source.cleanup()])
}

const LAW_KEY_TYPE = `grouped keys are strings or numbers`
const LAW_GROUPS = `each published group has its owed count`
const LAW_DISTINCT = `no two groups share a key, and the key count is the group count`
const LAW_KEPT = `a group that survives a change keeps its key`
const LAW_PUBLISHES = `publishing a valid grouped change raises no error`
const LAW_OBSERVED = `every checkpoint of a history is observed`

// The grouped-key comparison: each observation against the model's groups for
// its checkpoint. An observation that is missing, or an error that stops the
// history, is a violation too.
function judgeGroups(
  _plan: Plan,
  observations: ReadonlyArray<Observation>,
  expected: ReadonlyArray<Array<[string, number]>>,
): Verdict {
  let previous = new Map<string, unknown>()
  for (const [index, observation] of observations.entries()) {
    const { checkpoint, value } = observation
    if (isErrorObservation(value))
      return errorViolation(checkpoint, LAW_PUBLISHES, value, `no error`)
    const snapshot = value as Snapshot
    for (const row of snapshot.rows) {
      if (row.keyType !== `string` && row.keyType !== `number`)
        return violation(
          checkpoint,
          `a key of type ${row.keyType} is not a string or a number`,
          LAW_KEY_TYPE,
          { actual: row.keyType, expected: `string or number` },
        )
    }
    const published = snapshot.rows
      .map((row) => [describeGroup(row.g), row.n] as [string, number])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    const groups = expected[index]!
    const distinctKeys = new Set(snapshot.rows.map((row) => row.key)).size
    const verdict =
      differs(checkpoint, LAW_GROUPS, published, groups) ??
      differs(checkpoint, LAW_DISTINCT, snapshot.size, groups.length) ??
      differs(checkpoint, LAW_DISTINCT, distinctKeys, groups.length)
    if (verdict) return verdict
    const keys = new Map(
      snapshot.rows.map((row) => [describeGroup(row.g), row.key]),
    )
    for (const [group, key] of keys) {
      if (!previous.has(group)) continue
      if (!Object.is(previous.get(group), key))
        return violation(checkpoint, `${group} changed its key`, LAW_KEPT, {
          actual: key,
          expected: previous.get(group),
        })
    }
    previous = keys
  }
  if (observations.length !== expected.length)
    return violation(
      `end of history`,
      `observed ${observations.length} of ${expected.length} checkpoints`,
      LAW_OBSERVED,
      { actual: observations.length, expected: expected.length },
    )
  return pass
}

// Replaces the value at one observation, or reports that it does not apply.
function replaceValue(
  trace: ReadonlyArray<Observation>,
  index: number,
  value: unknown,
): Array<Observation> {
  return trace.map((observation, at) =>
    at === index ? { checkpoint: observation.checkpoint, value } : observation,
  )
}

function snapshotAt(trace: ReadonlyArray<Observation>, index: number) {
  const value = trace[index]?.value
  return isErrorObservation(value) ? undefined : (value as Snapshot)
}

declareOracle({
  owns: [`src/query/live-query-collection.ts#createLiveQueryCollection`],
  check: [judgeGroups],
  model: [expectedGroups],
})

oracleProperty<History, Array<Array<[string, number]>>, Plan>({
  id: `group-result-key.groups`,
  law: {
    statement: `A grouped live-query Collection publishes one row per group, keyed by a string or a number whatever the group value; two groups never share a key, including a group value and a string that prints like it or a string in the reserved namespace; and a group that survives a synced change keeps its key, so the change publishes as an update of the same row.`,
    authority: `The TKey constraint of every Collection type and the InvalidKeyError for other keys; maintainer decision (2026-10-27) that the grouped key matches the declared key type rather than widening to nullish keys; packages/db/tests/query/group-result-key-oracle.property.test.ts (this file's opening prose).`,
    limits: `Dates, -0, objects, and multi-field groups belong to the aggregate select oracle; the mock sync source is a controlled provider, so the claim covers only the compiler's keying of the rows it supplies; key format is not fixed.`,
    owner: `Grouped result keys`,
  },
  histories: {
    arbitrary: historyArbitrary,
    states: reachStates,
    runs: 80,
    fixedSeeds: [92_604_118],
    // Each builder splices the steps that enter its state at the front of a
    // generated history. The rest of the history stays random.
    constructed: [
      {
        name: `a nullish group is published`,
        enters: [`nullish-group-published`],
        build: (generated) => ({
          rows: [null, ...generated.rows.slice(0, 5)],
          changes: generated.changes,
        }),
      },
      {
        name: `a group value is published beside a string that prints like it`,
        enters: [`lookalike-groups-published`],
        build: (generated) => ({
          rows: [null, `null`, ...generated.rows.slice(0, 4)],
          changes: generated.changes,
        }),
      },
      {
        name: `a group survives a synced change`,
        enters: [`group-key-kept-across-change`],
        build: (generated) => ({
          rows: [`a`, ...generated.rows.slice(0, 5)],
          changes: [
            { kind: `insert`, g: `a` },
            ...generated.changes.slice(0, 3),
          ],
        }),
      },
    ],
    fixed: [
      {
        name: `keeps lookalike group values apart (fixed history 0)`,
        history: {
          rows: [null, `null`, undefined, `undefined`],
          changes: [{ kind: `move`, index: 0, g: `null` }],
        },
      },
      {
        name: `keeps lookalike group values apart (fixed history 1)`,
        history: {
          rows: [true, `true`, false, 10n, `10`],
          changes: [{ kind: `insert`, g: true }],
        },
      },
      {
        name: `keeps lookalike group values apart (fixed history 2)`,
        history: {
          rows: [null, `\u0000tanstack-db:object:null`, true],
          changes: [
            { kind: `insert`, g: `\u0000tanstack-db:boolean:true` },
            { kind: `delete`, index: 0 },
          ],
        },
      },
    ],
  },
  resolve,
  model: expectedGroups,
  reached: reachedStates,
  driver: runHistory,
  check: judgeGroups,
  // One wrong answer per verdict branch, plus a dropped checkpoint.
  calibrations: [
    {
      name: `key of an unsupported type`,
      law: LAW_KEY_TYPE,
      corrupt: (trace) => {
        const index = trace.findIndex(
          (_, at) => (snapshotAt(trace, at)?.rows.length ?? 0) > 0,
        )
        const snapshot = snapshotAt(trace, index)
        if (snapshot === undefined) return undefined
        const rows = snapshot.rows.map((row, at) =>
          at === 0 ? { ...row, keyType: `boolean`, key: null } : row,
        )
        return replaceValue(trace, index, { ...snapshot, rows })
      },
    },
    {
      name: `two groups share a key`,
      law: LAW_DISTINCT,
      corrupt: (trace) => {
        const index = trace.findIndex(
          (_, at) => (snapshotAt(trace, at)?.rows.length ?? 0) > 1,
        )
        const snapshot = snapshotAt(trace, index)
        if (snapshot === undefined) return undefined
        const rows = snapshot.rows.map((row, at) =>
          at === 1 ? { ...row, key: snapshot.rows[0]!.key } : row,
        )
        return replaceValue(trace, index, { ...snapshot, rows })
      },
    },
    {
      name: `a surviving group changes its key`,
      law: LAW_KEPT,
      corrupt: (trace) => {
        for (let index = 1; index < trace.length; index++) {
          const before = snapshotAt(trace, index - 1)
          const after = snapshotAt(trace, index)
          if (before === undefined || after === undefined) continue
          const kept = after.rows.findIndex((row) =>
            before.rows.some(
              (other) => describeGroup(other.g) === describeGroup(row.g),
            ),
          )
          if (kept === -1) continue
          const rows = after.rows.map((row, at) =>
            at === kept ? { ...row, key: `${String(row.key)}~moved` } : row,
          )
          return replaceValue(trace, index, { ...after, rows })
        }
        return undefined
      },
    },
    {
      name: `publication raises an error`,
      law: LAW_PUBLISHES,
      corrupt: (trace) =>
        trace.length === 0
          ? undefined
          : replaceValue(
              trace,
              0,
              new Error(`calibration: publication raised`),
            ),
    },
    {
      name: `last checkpoint dropped`,
      law: LAW_OBSERVED,
      corrupt: (trace) => (trace.length === 0 ? undefined : trace.slice(0, -1)),
    },
  ],
})
