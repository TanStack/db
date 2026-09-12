import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { TopKRelation } from './topk-relation-oracle.js'

describe(`Signed top-K observation controls`, () => {
  it(`shrinks and replays duplicate-weight detection through the same checker`, () => {
    const property = fc.property(fc.integer({ min: 10, max: 100 }), (id) => {
      const valid = new TopKRelation<null, number>()
      valid.add([[[null, [{ id, value: `a` }, 0]], 1]])
      valid.expectRows([[null, id, `a`]], 0)
      valid.add([[[null, [{ id, value: `a` }, 0]], 1]])
      valid.expectRows([[null, id, `a`]], 0)
    })
    const failure = fc.check(property, { seed: 409032 })
    expect(failure.failed).toBe(true)
    expect(failure.numShrinks).toBeGreaterThan(0)
    expect(failure.errorInstance).toMatchObject({ name: `AssertionError` })
    const replay = fc.check(property, {
      seed: failure.seed,
      path: failure.counterexamplePath!,
      endOnFailure: true,
    })
    expect(replay.counterexample).toEqual(failure.counterexample)
    expect(replay.failed).toBe(true)
    expect(replay.errorInstance).toMatchObject({ name: `AssertionError` })
  })

  it.each([`index`, `retraction`, `weight`, `update`] as const)(
    `rejects a wrong moved-row %s while preserving unchanged anchors`,
    (fault) => {
      const check = (corrupt: boolean) => {
        const relation = new TopKRelation<number, string>()
        relation.add([
          [[1, [{ id: 1, value: `a` }, `a0`]], 1],
          [[2, [{ id: 2, value: `b` }, `a1`]], 1],
          [[3, [{ id: 3, value: `c` }, `a2`]], 1],
        ])
        relation.expectRows([
          [1, 1, `a`],
          [2, 2, `b`],
          [3, 3, `c`],
        ])
        if (!corrupt || fault !== `retraction`)
          relation.add([[[1, [{ id: 1, value: `a` }, `a0`]], -1]])
        if (!corrupt || fault !== `update`)
          relation.add([
            [
              [
                1,
                [
                  { id: 1, value: `d` },
                  corrupt && fault === `index` ? `a0` : `a3`,
                ],
              ],
              corrupt && fault === `weight` ? 2 : 1,
            ],
          ])
        relation.expectRows([
          [2, 2, `b`],
          [3, 3, `c`],
          [1, 1, `d`],
        ])
      }
      check(false)
      expect(() => check(true)).toThrowError(
        expect.objectContaining({ name: `AssertionError` }),
      )
    },
  )

  it(`retains negative residue and copies captured payloads`, () => {
    const row = { id: 1, value: `a` }
    const relation = new TopKRelation<null, number>()
    relation.add([[[null, [row, 0]], 1]])
    row.value = `changed after capture`
    relation.expectRows([[null, 1, `a`]], 0)
    relation.add([[[null, [{ id: 1, value: `a` }, 0]], -1]])
    relation.expectRows([], 0)
    relation.add([[[null, [{ id: 1, value: `a` }, 0]], -1]])
    expect(() => relation.expectRows([], 0)).toThrowError(
      expect.objectContaining({ name: `AssertionError` }),
    )
  })

  it(`checks numeric offset rather than only relative index order`, () => {
    const relation = new TopKRelation<null, number>()
    relation.add([[[null, [{ id: 2, value: `b` }, 1]], 1]])
    relation.expectRows([[null, 2, `b`]], 1)
    expect(() => relation.expectRows([[null, 2, `b`]], 0)).toThrowError(
      expect.objectContaining({ name: `AssertionError` }),
    )
  })
})
