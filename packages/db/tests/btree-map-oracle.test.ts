import { describe, expect, it } from 'vitest'
import { BTree } from '../src/utils/btree.js'

describe(`BTree Map oracle`, () => {
  it(`matches a Map oracle under random insert/delete/overwrite with small nodes`, () => {
    let seed = 12345
    const rnd = () =>
      (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    for (let round = 0; round < 40; round++) {
      const tree = new BTree<number, { v: number }>(
        (a, b) => a - b,
        4 + Math.floor(rnd() * 5),
      )
      const oracle = new Map<number, { v: number }>()
      for (let step = 0; step < 3000; step++) {
        const key = Math.floor(rnd() * 200)
        const op = rnd()
        if (op < 0.5) {
          const val = { v: step }
          const added = tree.set(key, val)
          expect(added).toBe(!oracle.has(key))
          oracle.set(key, val)
        } else if (op < 0.85) {
          const deleted = tree.delete(key)
          expect(deleted).toBe(oracle.delete(key))
        } else if (op < 0.9) {
          tree.clear()
          oracle.clear()
        } else {
          expect(tree.get(key)).toBe(oracle.get(key))
          expect(tree.has(key)).toBe(oracle.has(key))
        }
        if (step % 97 === 0) {
          const sorted = [...oracle.keys()].sort((a, b) => a - b)
          expect(tree.size).toBe(oracle.size)
          expect(tree.minKey()).toBe(sorted[0])
          expect(tree.maxKey()).toBe(sorted[sorted.length - 1])
          const seen: Array<number> = []
          if (sorted.length)
            tree.forRange(
              sorted[0]!,
              sorted[sorted.length - 1]!,
              true,
              (k, v) => {
                seen.push(k)
                expect(v).toBe(oracle.get(k))
              },
            )
          expect(seen).toEqual(sorted)
          const probe = Math.floor(rnd() * 200)
          const higher = sorted.find((k) => k > probe)
          const lower = [...sorted].reverse().find((k) => k < probe)
          expect(tree.nextHigherPair(probe)?.[0]).toBe(higher)
          expect(tree.nextLowerPair(probe)?.[0]).toBe(lower)
          expect(tree.nextHigherPair(undefined)?.[0]).toBe(sorted[0])
          expect(tree.nextLowerPair(undefined)?.[0]).toBe(
            sorted[sorted.length - 1],
          )
        }
      }
    }
  })
})
