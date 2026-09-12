import { describe, expect, it, vi } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import { BTree } from '../src/utils/btree.js'

type Payload = { v: number }
type Stored = Readonly<{ reference: Payload; v: number }>
type Action =
  | { type: `put`; key: number; v: number }
  | { type: `delete` | `read` | `clear`; key: number }

const arbitraryAction: fc.Arbitrary<Action> = fc.oneof(
  fc.record({
    type: fc.constant(`put` as const),
    key: fc.integer({ min: 0, max: 199 }),
    v: fc.integer(),
  }),
  fc.record({
    type: fc.constantFrom(`delete` as const, `read` as const, `clear` as const),
    key: fc.integer({ min: 0, max: 199 }),
  }),
)

function applyAction(
  tree: BTree<number, Payload>,
  oracle: Map<number, Stored>,
  action: Action,
): void {
  if (action.type === `put`) {
    const value = { v: action.v }
    expect(tree.set(action.key, value)).toBe(!oracle.has(action.key))
    oracle.set(action.key, Object.freeze({ reference: value, v: action.v }))
  } else if (action.type === `delete`) {
    expect(tree.delete(action.key)).toBe(oracle.delete(action.key))
  } else if (action.type === `clear`) {
    tree.clear()
    oracle.clear()
  }
  // Mutation return values alone cannot expose stale deletes/overwrites.
  expectValue(tree.get(action.key), oracle.get(action.key))
  expect(tree.has(action.key)).toBe(oracle.has(action.key))
  expect(tree.size).toBe(oracle.size)
}

function expectValue(
  actual: Payload | undefined,
  expected: Stored | undefined,
): void {
  expect(actual).toBe(expected?.reference)
  expect(actual?.v).toBe(expected?.v)
}

function expectPair(
  actual: [number, Payload] | undefined,
  key: number | undefined,
  oracle: Map<number, Stored>,
): void {
  expect(actual).toEqual(
    key === undefined ? undefined : [key, oracle.get(key)!.reference],
  )
  if (key !== undefined) expectValue(actual?.[1], oracle.get(key))
}

function expectTree(
  tree: BTree<number, Payload>,
  oracle: Map<number, Stored>,
  probe: number,
): void {
  const sorted = [...oracle.keys()].sort((a, b) => a - b)
  expect(tree.size).toBe(oracle.size)
  expect(tree.minKey()).toBe(sorted[0])
  expect(tree.maxKey()).toBe(sorted[sorted.length - 1])
  const seen: Array<number> = []
  // Always invoke the scanner, including at initial/cleared/final empty cuts.
  tree.forRange(
    sorted[0] ?? -Infinity,
    sorted[sorted.length - 1] ?? Infinity,
    true,
    (key, value) => {
      seen.push(key)
      expectValue(value, oracle.get(key))
    },
  )
  expect(seen).toEqual(sorted)
  expectPair(
    tree.nextHigherPair(probe),
    sorted.find((key) => key > probe),
    oracle,
  )
  expectPair(
    tree.nextLowerPair(probe),
    [...sorted].reverse().find((key) => key < probe),
    oracle,
  )
  expectPair(tree.nextHigherPair(undefined), sorted[0], oracle)
  expectPair(tree.nextLowerPair(undefined), sorted[sorted.length - 1], oracle)
}

describe(`BTree Map oracle`, () => {
  // The 120,000-operation corpus takes about nine seconds with CI coverage.
  // Keep every operation and assertion; this is not a five-second perf budget.
  it(
    `matches a Map oracle under random insert/delete/overwrite with small nodes`,
    { timeout: 30_000 },
    () => {
      let seed = 12345
      const rnd = () =>
        (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
      for (let round = 0; round < 40; round++) {
        const nodeSize = 4 + Math.floor(rnd() * 5)
        const tree = new BTree<number, Payload>((a, b) => a - b, nodeSize)
        const oracle = new Map<number, Stored>()
        const history: Array<Action> = []
        try {
          expectTree(tree, oracle, 0)
          for (let step = 0; step < 3000; step++) {
            const key = Math.floor(rnd() * 200)
            const op = rnd()
            const action: Action =
              op < 0.5
                ? { type: `put`, key, v: step }
                : {
                    type: op < 0.85 ? `delete` : op < 0.9 ? `clear` : `read`,
                    key,
                  }
            history.push(action)
            applyAction(tree, oracle, action)
            if (step % 97 === 0)
              expectTree(tree, oracle, Math.floor(rnd() * 200))
          }
          expectTree(tree, oracle, 100)
        } catch (cause) {
          throw new Error(
            JSON.stringify({
              law: `BT-map`,
              initialSeed: 12345,
              seed,
              round,
              nodeSize,
              history,
            }),
            { cause },
          )
        }
      }
    },
  )

  fcTest.prop([
    fc.integer({ min: 4, max: 8 }),
    fc.array(arbitraryAction, { minLength: 1, maxLength: 64 }),
  ])(
    `matches complete Map cuts across shrinkable histories`,
    (nodeSize, actions) => {
      const tree = new BTree<number, Payload>((a, b) => a - b, nodeSize)
      const oracle = new Map<number, Stored>()
      expectTree(tree, oracle, 0)
      for (const action of actions) {
        applyAction(tree, oracle, action)
        expectTree(tree, oracle, action.key)
      }
    },
  )

  it.each([4, 5, 6, 7, 8])(
    `preserves every cut through dense growth, retirement and reuse with node size %s`,
    (nodeSize) => {
      const tree = new BTree<number, Payload>((a, b) => a - b, nodeSize)
      const oracle = new Map<number, Stored>()
      expectTree(tree, oracle, 0)
      // 64 entries exceed every selected leaf capacity. Deleting all then
      // reinserting exercises collapse/reuse without asserting private shape.
      const keys = Array.from({ length: 64 }, (_, key) => key)
      for (const key of keys) {
        const value = { v: key }
        expect(tree.set(key, value)).toBe(true)
        oracle.set(key, Object.freeze({ reference: value, v: key }))
        expectTree(tree, oracle, key)
      }
      for (const key of [...keys].reverse()) {
        expect(tree.delete(key)).toBe(true)
        oracle.delete(key)
        expectValue(tree.get(key), undefined)
        expectTree(tree, oracle, key)
      }
      for (const key of keys) {
        const value = { v: key + 100 }
        expect(tree.set(key, value)).toBe(true)
        oracle.set(key, Object.freeze({ reference: value, v: key + 100 }))
        expectTree(tree, oracle, key)
        const replacement = { v: key + 200 }
        expect(tree.set(key, replacement)).toBe(false)
        oracle.set(key, Object.freeze({ reference: replacement, v: key + 200 }))
        expectTree(tree, oracle, key)
      }
      tree.clear()
      oracle.clear()
      expectTree(tree, oracle, 0)
      const value = { v: 500 }
      tree.set(0, value)
      oracle.set(0, Object.freeze({ reference: value, v: 500 }))
      expectTree(tree, oracle, 0)
    },
  )

  it(`rejects wrong pair payloads, shared payload mutation and transient stale state`, () => {
    const tree = new BTree<number, Payload>((a, b) => a - b, 4)
    const value = { v: 1 }
    const oracle = new Map<number, Stored>([
      [1, Object.freeze({ reference: value, v: 1 })],
    ])
    tree.set(1, value)
    expectTree(tree, oracle, 0)
    const wrongPair = vi
      .spyOn(tree, `nextHigherPair`)
      .mockReturnValue([1, { v: 2 }])
    try {
      expect(() => expectTree(tree, oracle, 0)).toThrowError(/expected/)
    } finally {
      wrongPair.mockRestore()
    }
    value.v = 2
    expect(tree.get(1)).toBe(value) // The former identity-only check stays green.
    expect(() => expectTree(tree, oracle, 0)).toThrowError(/expected/)
    value.v = 1
    expectTree(tree, oracle, 0)
    // A stale delete result can vanish at a later clear; judge the earlier cut.
    expect(() => expectTree(tree, new Map(), 0)).toThrowError(/expected/)
    tree.clear()
    expectTree(tree, new Map(), 0)
    const staleScan = vi
      .spyOn(tree, `forRange`)
      .mockImplementation((_low, _high, _inclusive, callback) => {
        callback?.(1, value, 0)
        return 1
      })
    try {
      expect(() => expectTree(tree, new Map(), 0)).toThrowError(/expected/)
    } finally {
      staleScan.mockRestore()
    }
    expectTree(tree, new Map(), 0)
  })

  it(`shrinks and replays a wrong neighbor payload without losing its pair key`, () => {
    const property = fc.property(
      fc.array(fc.integer({ min: 0, max: 20 }), { minLength: 1, maxLength: 8 }),
      (values) => {
        const tree = new BTree<number, Payload>((a, b) => a - b, 4)
        const oracle = new Map<number, Stored>()
        values.forEach((v, key) =>
          applyAction(tree, oracle, { type: `put`, key, v }),
        )
        expectTree(tree, oracle, -1)
        // Correct key, wrong payload: the previous key-only law accepted this.
        const wrongPair: [number, Payload] = [0, { v: values[0]! + 1 }]
        expect(wrongPair[0]).toBe(0)
        expectPair(wrongPair, 0, oracle)
      },
    )
    const failed = fc.check(property, { seed: 303102, numRuns: 1 })
    expect(failed.failed).toBe(true)
    expect(failed.error).toMatch(/expected/)
    expect(failed.counterexample).toEqual([[0]])
    expect(failed.counterexamplePath).toBe(`0:0:0`)
    if (failed.counterexamplePath === null)
      throw new Error(`Missing calibration replay path`)
    const replay = fc.check(property, {
      seed: failed.seed,
      path: failed.counterexamplePath,
      numRuns: 1,
      endOnFailure: true,
    })
    expect(replay.failed).toBe(true)
    expect(replay.error).toMatch(/expected/)
    expect(replay.counterexample).toEqual(failed.counterexample)
  })
})
