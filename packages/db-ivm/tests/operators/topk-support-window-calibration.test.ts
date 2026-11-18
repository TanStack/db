// Calibrations of the top-K support window oracle's signed-output checker.
// Each test feeds TopKRelation a planted wrong relation and requires it to
// reject the answer; no production operator runs. The production campaigns
// are in topk-support-window-oracle.test.ts.
import { expect, it } from 'vitest'
import { TopKRelation } from './topk-relation-oracle.js'
import {
  keys,
  orderedKeys,
  selectedWindowKeys,
} from './topk-window-model-oracle.js'
import type { Key } from './topk-window-model-oracle.js'

// Rival interpretations must disagree with the rank predicate. Feed their
// wrong rows to the same signed-output checker; no production helper supplies
// the expected answer, and no output normalization removes the distinction.
it(`rejects end-relative slicing and offset-first clamping`, () => {
  const present = orderedKeys.slice(0, 3)
  for (const window of [
    { offset: -2, limit: 1 },
    { offset: -1, limit: 2 },
  ]) {
    const expected = selectedWindowKeys(present, window).map(
      (key): [Key, number, string] => [key, 10 - keys.indexOf(key), `tie`],
    )
    const wrong =
      window.limit === 1
        ? present.slice(window.offset, window.offset + window.limit)
        : present.slice(0, window.limit)
    const relation = new TopKRelation<Key>()
    relation.add(
      wrong.map((key, index) => [
        [key, [{ id: 10 - keys.indexOf(key), value: `tie` }, `a${index}`]],
        1,
      ]),
    )
    expect(() => relation.expectRows(expected)).toThrow()
  }
})

it.each([-2, 2])(
  `rejects excess signed weight %s across a moved window`,
  (weight) => {
    const check = (corrupt: boolean) => {
      const relation = new TopKRelation<Key>()
      relation.add([[[1, [{ id: 9, value: `tie` }, `a0`]], 1]])
      relation.expectRows([[1, 9, `tie`]])
      relation.add([
        [
          [1, [{ id: 9, value: `tie` }, `a0`]],
          corrupt && weight < 0 ? weight : -1,
        ],
        [
          [`1`, [{ id: 8, value: `tie` }, `a1`]],
          corrupt && weight > 0 ? weight : 1,
        ],
      ])
      relation.expectRows([[`1`, 8, `tie`]])
    }
    check(false)
    expect(() => check(true)).toThrowError(
      expect.objectContaining({ name: `AssertionError` }),
    )
  },
)
