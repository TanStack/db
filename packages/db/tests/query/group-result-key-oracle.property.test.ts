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
 * Model: `expectedGroups` partitions plain rows by an independent rule. Group
 * values are equal when they have the same type and the same value, with
 * `NaN` equal to `NaN`. It does not import the compiler, its value identity,
 * or its key encoding.
 *
 * History grammar: rows draw group values from strings, numbers, `NaN`,
 * `null`, `undefined`, booleans, a bigint, strings that print like those
 * values, and strings in the reserved `\u0000tanstack-db:` namespace. Each
 * history then applies up to four synced changes: move a row to another group
 * value, delete a row, or insert a row.
 *
 * Production driver: a `mockSyncCollectionOptions` Collection and a public
 * `createLiveQueryCollection` that groups by the field and counts each group.
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
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { count } from '../../src/query/builder/functions.js'
import { createCollection } from '../../src/collection/index.js'
import { oraclePropertyOptions, oracleRuns } from '../oracle-config.js'
import { createOracleReach } from '../oracle-reach.js'
import { mockSyncCollectionOptions, withOracleCleanup } from '../utils.js'

const property = `group-result-key.groups`

type Row = { id: number; g: unknown }
type Change =
  | { kind: `move`; index: number; g: unknown }
  | { kind: `delete`; index: number }
  | { kind: `insert`; g: unknown }
type History = { rows: Array<unknown>; changes: Array<Change> }

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

// The (group, count) pairs the query must publish.
function expectedGroups(rows: ReadonlyArray<Row>): Map<string, number> {
  const groups = new Map<string, number>()
  for (const row of rows) {
    const group = describeGroup(row.g)
    groups.set(group, (groups.get(group) ?? 0) + 1)
  }
  return groups
}

// ---------------------------------------------------------------------------
// History grammar
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

// Each lookalike pair publishes together, then one member's group changes.
const pinnedHistories: ReadonlyArray<History> = [
  {
    rows: [null, `null`, undefined, `undefined`],
    changes: [{ kind: `move`, index: 0, g: `null` }],
  },
  {
    rows: [true, `true`, false, 10n, `10`],
    changes: [{ kind: `insert`, g: true }],
  },
  {
    rows: [null, `\u0000tanstack-db:object:null`, true],
    changes: [
      { kind: `insert`, g: `\u0000tanstack-db:boolean:true` },
      { kind: `delete`, index: 0 },
    ],
  },
]

// ---------------------------------------------------------------------------
// Production driver and refinement check
// ---------------------------------------------------------------------------

type Reach = ReturnType<
  typeof createOracleReach<
    | `nullish-group-published`
    | `lookalike-groups-published`
    | `group-key-kept-across-change`
  >
>

let collectionSerial = 0

async function runHistory(history: History, reach?: Reach): Promise<void> {
  reach?.beginHistory()
  const serial = collectionSerial++
  let nextId = 0
  const rows: Array<Row> = history.rows.map((g) => ({ id: nextId++, g }))
  const source = createCollection(
    mockSyncCollectionOptions<Row>({
      id: `group-key-source-${serial}`,
      getKey: (row) => row.id,
      initialData: rows.map((row) => ({ ...row })),
    }),
  )
  const live = createLiveQueryCollection((q) =>
    q
      .from({ row: source })
      .groupBy(({ row }) => row.g)
      .select(({ row }) => ({ g: row.g, n: count(row.id) })),
  )
  let previousKeys = new Map<string, unknown>()
  const check = (checkpoint: string) => {
    const published = new Map<string, number>()
    const keys = new Map<string, unknown>()
    for (const [key, row] of live.entries()) {
      expect(
        typeof key === `string` || typeof key === `number`,
        `${checkpoint}: key ${String(key)} of type ${typeof key}`,
      ).toBe(true)
      const group = describeGroup((row as { g: unknown }).g)
      published.set(group, (row as { n: number }).n)
      keys.set(group, key)
    }
    expect([...published].sort(), checkpoint).toEqual(
      [...expectedGroups(rows)].sort(),
    )
    expect(new Set(keys.values()).size, `${checkpoint}: distinct keys`).toBe(
      published.size,
    )
    expect(live.size, `${checkpoint}: key count`).toBe(published.size)
    for (const [group, key] of keys) {
      if (!previousKeys.has(group)) continue
      reach?.reach(`group-key-kept-across-change`)
      expect(
        Object.is(previousKeys.get(group), key),
        `${checkpoint}: ${group} keeps its key`,
      ).toBe(true)
    }
    previousKeys = keys
    const groups = [...published.keys()]
    if (
      groups.some(
        (group) =>
          group.startsWith(`object:null`) || group.startsWith(`undefined:`),
      )
    )
      reach?.reach(`nullish-group-published`)
    const printed = new Set(
      groups
        .filter((group) => !group.startsWith(`string:`))
        .map((group) => group.slice(group.indexOf(`:`) + 1)),
    )
    if (
      groups.some(
        (group) => group.startsWith(`string:`) && printed.has(group.slice(7)),
      )
    )
      reach?.reach(`lookalike-groups-published`)
  }
  await withOracleCleanup(async () => {
    await live.preload()
    check(`after preload`)
    for (const [step, change] of history.changes.entries()) {
      source.utils.begin()
      if (change.kind === `insert`) {
        const row = { id: nextId++, g: change.g }
        rows.push(row)
        source.utils.write({ type: `insert`, value: { ...row } })
      } else {
        if (rows.length === 0) {
          source.utils.commit()
          continue
        }
        const index = change.index % rows.length
        const target = rows[index]!
        if (change.kind === `delete`) {
          rows.splice(index, 1)
          source.utils.write({ type: `delete`, value: { ...target } })
        } else {
          target.g = change.g
          source.utils.write({ type: `update`, value: { ...target } })
        }
      }
      source.utils.commit()
      check(`after change ${step} (${change.kind})`)
    }
  }, [() => live.cleanup(), () => source.cleanup()])
}

describe(`grouped result key oracle`, () => {
  for (const [index, history] of pinnedHistories.entries()) {
    it(`keeps lookalike group values apart (pinned ${index})`, () =>
      runHistory(history))
  }

  it.each([92_604_118, undefined])(
    `publishes one key of the key type per group (seed %s)`,
    async (seed) => {
      const reach = createOracleReach(
        property,
        [
          `nullish-group-published`,
          `lookalike-groups-published`,
          `group-key-kept-across-change`,
        ],
        { minimum: 5 },
      )
      await fc.assert(
        fc.asyncProperty(historyArbitrary, (history) =>
          runHistory(history, reach),
        ),
        seed === undefined
          ? oraclePropertyOptions(80, property)
          : { seed, numRuns: oracleRuns(80) },
      )
      if (process.env.TANSTACK_DB_ORACLE_REACH_REPORT)
        console.log(property, seed ?? `random`, [...reach.counts()])
      reach.assertReached()
    },
  )
})
