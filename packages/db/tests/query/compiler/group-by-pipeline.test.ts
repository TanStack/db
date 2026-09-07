import { D2, MultiSet, output } from '@tanstack/db-ivm'
import { describe, expect, test } from 'vitest'
import { NonAggregateExpressionNotInGroupByError } from '../../../src/errors.js'
import { coalesce } from '../../../src/query/builder/functions.js'
import { processGroupBy } from '../../../src/query/compiler/group-by.js'
import { createValueIdentity } from '../../../src/query/equality-value-identity.js'
import { Aggregate, Func, PropRef, Value } from '../../../src/query/ir.js'
import type { Select } from '../../../src/query/ir.js'
import type { KeyedNamespacedRow } from '../../../src/types.js'

type Row = { id: number; group: number; amount: number; local: boolean }

const initial: Array<Row> = [
  { id: 1, group: 1, amount: 2, local: false },
  { id: 2, group: 1, amount: 5, local: true },
  { id: 3, group: 2, amount: 9, local: false },
]
const snapshots = [
  [],
  initial,
  [initial[0]!, { ...initial[1]!, group: 2, amount: 3, local: false }],
  [],
  initial,
]

const cases = [false, true].flatMap((grouped) =>
  ([`none`, `plain`, `wrapped`] as const).flatMap((selection) =>
    ([`none`, `expression`, `function`, `false`, `null`] as const).map(
      (having) => ({
        grouped,
        selection,
        having,
      }),
    ),
  ),
)

describe(`group-by production pipeline`, () => {
  test.each([false, true])(
    `validates ungrouped SELECT references only with grouping keys: %s`,
    (grouped) => {
      const graph = new D2()
      const compile = () =>
        processGroupBy(
          graph.newInput<KeyedNamespacedRow>(),
          grouped ? [new PropRef([`row`, `group`])] : [],
          createValueIdentity(),
          undefined,
          { amount: new PropRef([`row`, `amount`]) },
        )
      if (grouped) {
        expect(compile).toThrow(NonAggregateExpressionNotInGroupByError)
      } else {
        expect(compile).not.toThrow()
      }
    },
  )

  test.each(cases)(
    `recomputes rows and metadata: grouped=$grouped, select=$selection, having=$having`,
    ({ grouped, selection, having }) => {
      const graph = new D2()
      const input = graph.newInput<KeyedNamespacedRow>()
      const groupRef = new PropRef([`row`, `group`])
      const total = new Aggregate(`sum`, [new PropRef([`row`, `amount`])])
      // Exercise generated-field collision avoidance as well as wrapped refs.
      const totalAlias = `__tanstack_group_synced`
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
      type Result = {
        key: unknown
        selected: unknown
        synced: unknown
        origin: unknown
      }
      let actual = new MultiSet<Result>()
      processGroupBy(
        input,
        grouped ? [groupRef] : [],
        createValueIdentity(),
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
        `aggregate-result`,
      ).pipe(
        output((delta) => {
          // Observe the public projection, not transient reducer bookkeeping.
          actual = actual
            .concat(
              delta.map(([key, row]) => {
                expect(row.$key).toBe(key)
                expect(row.$collectionId).toBe(`aggregate-result`)
                return {
                  key,
                  selected: row.$selected,
                  synced: row.$synced,
                  origin: row.$origin,
                }
              }),
            )
            .consolidate()
        }),
      )
      graph.finalize()

      let previous = new MultiSet<KeyedNamespacedRow>()
      for (const rows of snapshots) {
        const next = new MultiSet<KeyedNamespacedRow>(
          rows.map((row) => [
            [
              String(row.id),
              {
                row: {
                  ...row,
                  $synced: !row.local,
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

        // Independent batch model: partition source rows, then sum directly.
        const groups = new Map<number | string, Array<Row>>()
        for (const row of rows) {
          const key = grouped ? row.group : `single_group`
          groups.set(key, [...(groups.get(key) ?? []), row])
        }
        const expected = [...groups].flatMap(([key, members]) => {
          if (having === `false` || having === `null`) return []
          const amount =
            members.reduce((sum, row) => sum + row.amount, 0) +
            (selection === `wrapped` && grouped ? Number(key) : 0)
          if (having !== `none` && selection !== `none` && amount <= 5)
            return []
          return [
            {
              key,
              selected:
                selection === `none`
                  ? grouped
                    ? { __key_0: key }
                    : {}
                  : {
                      ...(grouped ? { group: key } : {}),
                      [totalAlias]: amount,
                    },
              synced: members.every((row) => !row.local),
              origin: members.some((row) => row.local) ? `local` : `remote`,
            },
          ]
        })
        const observed = actual.getInner().map(([row, weight]) => {
          expect(weight).toBe(1)
          return row
        })
        expect(observed).toHaveLength(expected.length)
        expect(observed).toEqual(expect.arrayContaining(expected))
      }
    },
  )
})
