import { D2, MultiSet, output } from '@tanstack/db-ivm'
import { describe, expect, test } from 'vitest'
import { coalesce } from '../../../src/query/builder/functions.js'
import { processGroupBy } from '../../../src/query/compiler/group-by.js'
import { grouping } from '../../../src/query/compiler/grouping.js'
import { createValueIdentity } from '../../../src/query/equality-value-identity.js'
import { Aggregate, Func, PropRef, Value } from '../../../src/query/ir.js'
import { oracleRoute } from '../../oracle-config.js'
import { declareOracle } from '../../oracle-declaration.js'
import { createOracleReach } from '../../oracle-reach.js'
import type { Select } from '../../../src/query/ir.js'
import type { KeyedNamespacedRow } from '../../../src/types.js'

/**
 * Group reduction agrees with batch partitioning and aggregation after each
 * input replacement: one keyed selection per nonempty group that HAVING keeps.
 * Authority: the aggregate/group laws in live/ARCHITECTURE.md. The 2026-11-05
 * boundary-only metadata decision assigns Collection attribution at publication,
 * so this compiler component judges keys and selected values, not source pending,
 * origin or Collection IDs. Public metadata remains owned by the publication
 * oracle; this component does not exercise a Collection or correlated routes.
 *
 * The finite grammar preserves all thirty prior combinations of explicit or
 * implicit grouping, no/plain/wrapped selection and five HAVING forms. Every
 * history starts empty, installs rows, moves a member while changing its value,
 * empties the relation and reenters. Pending source flags vary independently of
 * the partition/sum law. Ordering of groups is not promised here.
 */
type Row = { id: number; group: number; amount: number; local: boolean }
type Result = { key: unknown; selected: unknown }

const totalAlias = `__tanstack_group_synced`
const initial: Array<Row> = [
  { id: 1, group: 1, amount: 2, local: false },
  { id: 2, group: 1, amount: 5, local: true },
  { id: 3, group: 2, amount: 9, local: false },
]
const snapshots = [
  { checkpoint: `empty-start`, rows: [] },
  { checkpoint: `populated`, rows: initial },
  {
    checkpoint: `member-move`,
    rows: [initial[0]!, { ...initial[1]!, group: 2, amount: 3, local: false }],
  },
  { checkpoint: `empty-after-delete`, rows: [] },
  { checkpoint: `reentry`, rows: initial },
]

const cases = [false, true].flatMap((grouped) =>
  ([`none`, `plain`, `wrapped`] as const).flatMap((selection) =>
    ([`none`, `expression`, `function`, `false`, `null`] as const).map(
      (having) => ({ grouped, selection, having }),
    ),
  ),
)
type Case = (typeof cases)[number]

// Batch recomputation uses plain rows and arithmetic, never compiler evaluators,
// internal aggregate aliases or the reducer's retained state. Empty groups have
// no row. Wrapped selection adds the group value after summing its members.
function expectedGroupRows(
  rows: ReadonlyArray<Row>,
  scenario: Case,
): Array<Result> {
  const groups = new Map<number | string, Array<Row>>()
  for (const row of rows) {
    const key = scenario.grouped ? row.group : `single_group`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups].flatMap(([key, members]) => {
    if (scenario.having === `false` || scenario.having === `null`) return []
    const amount =
      members.reduce((sum, row) => sum + row.amount, 0) +
      (scenario.selection === `wrapped` && scenario.grouped ? Number(key) : 0)
    if (
      scenario.having !== `none` &&
      scenario.selection !== `none` &&
      amount <= 5
    )
      return []
    return [
      {
        key,
        selected:
          scenario.selection === `none`
            ? scenario.grouped
              ? { __key_0: key }
              : {}
            : {
                ...(scenario.grouped ? { group: key } : {}),
                [totalAlias]: amount,
              },
      },
    ]
  })
}

// Accumulated deltas must contain each expected row exactly once. Inspecting
// weights and cardinality separately rejects duplicates and lost retractions.
function compareGroupRows(
  actual: MultiSet<Result>,
  expected: Array<Result>,
): void {
  const observed = actual.getInner().map(([row, weight]) => {
    expect(weight).toBe(1)
    return row
  })
  expect(observed).toHaveLength(expected.length)
  expect(observed).toEqual(expect.arrayContaining(expected))
}

declareOracle({
  owns: [`src/query/compiler/group-by.ts#processGroupBy`],
  model: [expectedGroupRows],
  check: [compareGroupRows],
  grammar: [cases, snapshots],
})

describe(`group-by component batch refinement`, () => {
  test.each(cases)(
    `recomputes keyed selections: grouped=$grouped, select=$selection, having=$having`,
    (scenario) => {
      oracleRoute(`case`)
      const { grouped, selection, having } = scenario
      const graph = new D2()
      const input = graph.newInput<KeyedNamespacedRow>()
      const groupRef = new PropRef([`row`, `group`])
      const total = new Aggregate(
        `sum`,
        [new PropRef([`row`, `amount`])],
        grouping,
      )
      // The selected alias deliberately resembles a compiler-generated field.
      const select: Select | undefined =
        selection === `none`
          ? undefined
          : {
              ...(grouped ? { group: groupRef } : {}),
              [totalAlias]:
                selection === `plain`
                  ? total
                  : new Func(`add`, [
                      coalesce(total, 0),
                      grouped ? groupRef : new Value(0),
                    ]),
            }
      let actual = new MultiSet<Result>()
      processGroupBy(
        input,
        grouped ? [groupRef] : [],
        createValueIdentity(),
        (ref: { path: Array<string> }) => ref.path[0] === `row`,
        having === `expression`
          ? [
              selection === `none`
                ? new Value(true)
                : new Func(`gt`, [
                    new PropRef([`$selected`, totalAlias]),
                    new Value(5),
                  ]),
            ]
          : having === `false` || having === `null`
            ? [
                having === `false`
                  ? new Value(false)
                  : new Func<boolean>(`gt`, [new Value(null), new Value(5)]),
              ]
            : undefined,
        select,
        having === `function`
          ? [
              (row: { $selected: Record<string, number> }) =>
                selection === `none` || row.$selected[totalAlias]! > 5,
            ]
          : undefined,
      ).pipe(
        output((delta) => {
          actual = actual
            .concat(
              delta.map(([key, row]) => {
                expect(row.$key).toBe(key)
                return { key, selected: row.$selected }
              }),
            )
            .consolidate()
        }),
      )
      graph.finalize()

      const reach = createOracleReach(
        `compiler.group-by.batch`,
        snapshots.map(({ checkpoint }) => checkpoint),
      )
      reach.beginHistory()
      let previous = new MultiSet<KeyedNamespacedRow>()
      // Each snapshot is delivered as a weighted replacement. Compare only after
      // the actual D2 graph drains; no public Collection is synthesized by the test.
      for (const { checkpoint, rows } of snapshots) {
        const next = new MultiSet<KeyedNamespacedRow>(
          rows.map((row) => [
            [
              String(row.id),
              {
                row: {
                  ...row,
                  $hasPendingWrites: row.local,
                  $origin: row.local ? `local` : `remote`,
                },
              },
            ],
            1,
          ]),
        )
        input.sendData(previous.negate().concat(next))
        graph.run()
        previous = next
        reach.reach(checkpoint)
        compareGroupRows(actual, expectedGroupRows(rows, scenario))
      }
      reach.assertReached()
    },
  )

  test.each([
    `lost group`,
    `wrong key`,
    `wrong value`,
    `duplicate weight`,
  ] as const)(`rejects a batch observation with %s`, (fault) => {
    oracleRoute(`calibration`)
    const expected = expectedGroupRows(initial, {
      grouped: true,
      selection: `plain`,
      having: `none`,
    })
    const rows = expected.map((row): [Result, number] => [{ ...row }, 1])
    if (fault === `lost group`) rows.pop()
    if (fault === `wrong key`) rows[0]![0].key = `wrong-group`
    if (fault === `wrong value`) rows[0]![0].selected = { [totalAlias]: -1 }
    if (fault === `duplicate weight`) rows[0]![1] = 2
    expect(() => compareGroupRows(new MultiSet(rows), expected)).toThrow()
  })
})
