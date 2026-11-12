/**
 * Ordinary grammar and checker-projection tests for the change-event history
 * oracle. The mirror law is owned by change-event-history-oracle.test.ts,
 * which runs the generated histories through its check.
 */

import { describe, expect, it } from 'vitest'
import { BasicIndex } from '../src/index'
import { PropRef } from '../src/query/ir'
import {
  assertIndexAgreement,
  expectedEventTrace,
  expectedRowsAfter,
  perKeyEventTrace,
} from './change-event-history-model-oracle.js'
import {
  cases,
  generateSequences,
  mirrorRows,
  oneKeyCases,
  replacement,
  twoKeyCases,
} from './change-event-history-fixture.js'
import type { Key, Op } from './change-event-history-fixture.js'

describe(`change-event history oracle`, () => {
  it(`reaches reinsertion and rejects missing or extra mirrored rows`, () => {
    const witness: Array<Op> = [
      { kind: `insert`, key: 1, step: 1 },
      { kind: `delete`, key: 1, step: 2 },
      { kind: `insert`, key: 1, step: 3 },
    ]
    expect(generateSequences(4, [1])).toContainEqual(witness)
    expect(oneKeyCases).toHaveLength(22)
    expect(twoKeyCases).toHaveLength(344)
    expect(generateSequences(3, [1, 2], [], new Set<Key>([1]))).toContainEqual([
      { kind: `update`, key: 1, step: 1 },
      { kind: `insert`, key: 2, step: 2 },
      { kind: `delete`, key: 1, step: 3 },
    ])
    expect(
      generateSequences(3, [1, 2], [], new Set<Key>([1])),
    ).not.toContainEqual([{ kind: `insert`, key: 1, step: 1 }])
    expect(new Set(cases.map(({ id }) => id)).size).toBe(cases.length)
    const expected = [[1, { id: 1, name: `v3`, fileId: `f1` }]]
    expect(mirrorRows(new Map())).not.toEqual(expected)
    expect(
      mirrorRows(new Map([[1, { id: 1, name: `wrong`, fileId: `f1` }]])),
    ).not.toEqual(expected)
    expect(
      mirrorRows(
        new Map([
          [1, { id: 1, name: `v3`, fileId: `f1` }],
          [2, { id: 2, name: `ghost`, fileId: `f2` }],
        ]),
      ),
    ).not.toEqual(expected)
  })

  it(`rejects a deferred message with the right name but wrong row fields`, () => {
    const sequence: Array<Op> = [
      { kind: `insert`, key: 1, step: 1 },
      { kind: `update`, key: 1, step: 2 },
    ]
    const expected = expectedEventTrace(sequence)
    expect(
      perKeyEventTrace([
        {
          type: `insert`,
          key: 1,
          value: { id: 1, name: `v1`, fileId: `f2` },
        },
        {
          type: `update`,
          key: 1,
          value: { id: 1, name: `v2`, fileId: `f1` },
          previousValue: { id: 1, name: `v1`, fileId: `f2` },
        },
      ]),
    ).not.toEqual(expected)
  })

  it(`rejects a missing live key in the index checker`, () => {
    expect(replacement.map(({ kind, key }) => [kind, key])).toEqual([
      [`delete`, 1],
      [`delete`, 2],
      [`insert`, 1],
      [`insert`, 2],
    ])
    const expected = expectedRowsAfter([1, 2], replacement)
    const index = new BasicIndex<number>(1, new PropRef([`fileId`]))
    index.build([...expected])
    assertIndexAgreement(index, expected)
    index.remove(1, expected.get(1))
    expect(() => assertIndexAgreement(index, expected)).toThrowError(/expected/)
  })
})
