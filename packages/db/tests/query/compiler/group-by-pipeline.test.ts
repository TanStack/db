import { D2, MultiSet, output } from '@tanstack/db-ivm'
import { describe, expect, test } from 'vitest'
import { NonAggregateExpressionNotInGroupByError } from '../../../src/errors.js'
import { processGroupBy } from '../../../src/query/compiler/group-by.js'
import { createValueIdentity } from '../../../src/query/equality-value-identity.js'
import { PropRef } from '../../../src/query/ir.js'
import type { KeyedNamespacedRow } from '../../../src/types.js'

describe(`group-by production pipeline`, () => {
  // Group reduction emits a keyed selection before Collection publication.
  // Source pending state does not change this grouping-only result.
  test.each([
    {
      name: `pending row`,
      rows: [{ key: `first`, pending: true }],
    },
    {
      name: `settled row`,
      rows: [{ key: `first`, pending: false }],
    },
    {
      name: `mixed pending and settled rows`,
      rows: [
        { key: `first`, pending: true },
        { key: `second`, pending: false },
      ],
    },
  ] as const)(
    `groups contributions independently of source pending state: $name`,
    ({ rows }) => {
      const graph = new D2()
      const input = graph.newInput<KeyedNamespacedRow>()
      let actual = new MultiSet<KeyedNamespacedRow>()
      processGroupBy(
        input,
        [],
        createValueIdentity(),
        (ref: { path: Array<string> }) => ref.path[0] === `row`,
      ).pipe(
        output((delta) => {
          actual = actual.concat(delta).consolidate()
        }),
      )
      graph.finalize()

      input.sendData(
        new MultiSet<KeyedNamespacedRow>(
          rows.map(({ key, pending }): [KeyedNamespacedRow, number] => [
            [
              key,
              {
                row: {
                  id: key,
                  $hasPendingWrites: pending,
                },
              },
            ],
            1,
          ]),
        ),
      )
      graph.run()

      expect(actual.getInner()).toHaveLength(1)
      const grouped = actual.getInner()[0]![0][1]
      expect(grouped.$key).toBe(`single_group`)
      expect(grouped.$selected).toEqual({})
    },
  )

  // A source field that is not grouped has no single value, with or without
  // groupBy, so both compiles throw.
  test.each([false, true])(
    `rejects an ungrouped source field in SELECT: grouped=%s`,
    (grouped) => {
      const graph = new D2()
      const compile = () =>
        processGroupBy(
          graph.newInput<KeyedNamespacedRow>(),
          grouped ? [new PropRef([`row`, `group`])] : [],
          createValueIdentity(),
          (ref: { path: Array<string> }) => ref.path[0] === `row`,
          undefined,
          { amount: new PropRef([`row`, `amount`]) },
        )
      expect(compile).toThrow(NonAggregateExpressionNotInGroupByError)
    },
  )
})
