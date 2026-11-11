import { D2, MultiSet, output } from '@tanstack/db-ivm'
import { expect } from 'vitest'
import { coalesce } from '../../../src/query/builder/functions.js'
import { processGroupBy } from '../../../src/query/compiler/group-by.js'
import { grouping } from '../../../src/query/compiler/grouping.js'
import { createValueIdentity } from '../../../src/query/equality-value-identity.js'
import { Aggregate, Func, PropRef, Value } from '../../../src/query/ir.js'
import { oracleProperty, pass, violation } from '../../oracle-config.js'
import { declareOracle } from '../../oracle-declaration.js'
import type { Observation, Verdict } from '../../oracle-config.js'
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

// The finite histories keep the original thirty combinations and all five
// replacement checkpoints. The checker requires each checkpoint, so removing
// one cannot silently remove its former reach obligation.
function modelGroupHistory(scenario: Case) {
  return snapshots.map(({ checkpoint, rows }) => ({
    checkpoint,
    rows: expectedGroupRows(rows, scenario),
  }))
}

function driveGroupHistory(
  scenario: Case,
  observe: (checkpoint: string, value: unknown) => void,
): void {
  const { grouped, selection, having } = scenario
  const graph = new D2()
  const input = graph.newInput<KeyedNamespacedRow>()
  const groupRef = new PropRef([`row`, `group`])
  const total = new Aggregate(`sum`, [new PropRef([`row`, `amount`])], grouping)
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
            observe(`group key`, { key, reportedKey: row.$key })
            return { key, selected: row.$selected }
          }),
        )
        .consolidate()
    }),
  )
  graph.finalize()

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
    observe(checkpoint, actual.getInner())
  }
}

function checkGroupHistory(
  _scenario: Case,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof modelGroupHistory>,
): Verdict {
  for (const observation of trace) {
    if (observation.checkpoint !== `group key`) continue
    const { key, reportedKey } = observation.value as {
      key: unknown
      reportedKey: unknown
    }
    if (!Object.is(key, reportedKey))
      return violation(
        `group key`,
        `the group row reports a different key`,
        `group key`,
      )
  }
  for (const snapshot of expected) {
    const observation = trace.find(
      ({ checkpoint }) => checkpoint === snapshot.checkpoint,
    )
    if (observation === undefined)
      return violation(
        snapshot.checkpoint,
        `the replacement checkpoint is missing`,
        `group batch`,
      )
    try {
      compareGroupRows(
        new MultiSet(observation.value as Array<[Result, number]>),
        snapshot.rows,
      )
    } catch (error) {
      return {
        kind: `violation`,
        checkpoint: snapshot.checkpoint,
        difference: String(error),
        law: `group batch`,
        cause: error,
      }
    }
  }
  return pass
}

declareOracle({
  model: [expectedGroupRows, modelGroupHistory],
  check: [compareGroupRows, checkGroupHistory],
  grammar: [cases, snapshots],
})

oracleProperty({
  id: `compiler.group-by.batch`,
  law: {
    statement: `Group reduction agrees with batch partitioning and aggregation after every input replacement, with one keyed selection per retained nonempty group.`,
    authority: `The aggregate and group laws in live/ARCHITECTURE.md and the boundary-only metadata decision of 2026-11-05, stated above.`,
    limits: `The original thirty finite grouping, selection and HAVING combinations over five replacement snapshots; no Collection, correlated-route, metadata-attribution or group-ordering claim.`,
  },
  owns: [`src/query/compiler/group-by.ts#processGroupBy`],
  histories: cases,
  label: ({ grouped, selection, having }) =>
    `grouped=${grouped}, select=${selection}, having=${having}`,
  model: modelGroupHistory,
  driver: driveGroupHistory,
  check: checkGroupHistory,
  calibrations: (
    [`lost group`, `wrong key`, `wrong value`, `duplicate weight`] as const
  ).map((fault) => ({
    name: fault,
    law: `group batch`,
    corrupt: (trace: ReadonlyArray<Observation>) => {
      const populated = trace.find(
        ({ checkpoint }) => checkpoint === `populated`,
      )
      if (populated === undefined) return undefined
      const original = populated.value as Array<[Result, number]>
      if (original.length === 0) return undefined
      const rows = original.map(([row, weight]): [Result, number] => [
        { ...row },
        weight,
      ])
      if (fault === `lost group`) rows.pop()
      if (fault === `wrong key`) rows[0]![0].key = `wrong-group`
      if (fault === `wrong value`) rows[0]![0].selected = { [totalAlias]: -1 }
      if (fault === `duplicate weight`) rows[0]![1] = 2
      return trace.map((observation) =>
        observation === populated
          ? { ...observation, value: rows }
          : observation,
      )
    },
  })),
})
