import { describe, expect, it, vi } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import { BTree } from '../src/utils/btree.js'

/**
 * # When does the B+ tree behave like a sorted Map?
 *
 * The B+ tree can split, merge, collapse, and reuse private nodes. None of
 * those shapes are public. For numeric keys, the public contract is a Map with
 * one added rule: traversal and neighbor operations use numeric key order.
 *
 * After each action, this oracle checks four laws:
 *
 * 1. Point operations return the same result as the Map model.
 * 2. A full range scan returns each modeled key once in sorted order.
 * 3. Neighbor operations return the closest strict key and its exact payload.
 * 4. A missing lookup returns the fallback object supplied by the caller.
 *
 * The model stores both the payload reference and its original value. This
 * detects a wrong payload and later mutation of a shared payload. A key-only
 * model would miss both faults.
 *
 * Generated histories vary puts, overwrites, deletes, reads, and clears. Small
 * node sizes force structural changes. A fixed long campaign gives stable
 * depth, while the fast-check lane supplies new and shrinkable histories.
 */

type Payload = { v: number }
type Stored = Readonly<{ reference: Payload; v: number }>
type ReferenceModel = Map<number, Stored>
type Action =
  | { type: `put`; key: number; v: number }
  | { type: `delete` | `read` | `clear`; key: number }
type ActionResult = boolean | undefined

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

// The model uses only Map operations and the declared numeric order. It does
// not use the tree's nodes, search helpers, or traversal code.
function stepModel(
  model: ReferenceModel,
  action: Action,
  value: Payload | undefined,
): ActionResult {
  if (action.type === `put`) {
    const inserted = !model.has(action.key)
    model.set(action.key, Object.freeze({ reference: value!, v: action.v }))
    return inserted
  }
  if (action.type === `delete`) return model.delete(action.key)
  if (action.type === `clear`) model.clear()
  return undefined
}

// The driver invokes the public BTree API. It shares only the generated input
// payload with the model.
function stepTree(
  tree: BTree<number, Payload>,
  action: Action,
  value: Payload | undefined,
): ActionResult {
  if (action.type === `put`) return tree.set(action.key, value!)
  if (action.type === `delete`) return tree.delete(action.key)
  if (action.type === `clear`) tree.clear()
  return undefined
}

function applyAction(
  tree: BTree<number, Payload>,
  model: ReferenceModel,
  action: Action,
): void {
  const value = action.type === `put` ? { v: action.v } : undefined
  const expectedResult = stepModel(model, action, value)
  const actualResult = stepTree(tree, action, value)
  expect(actualResult).toBe(expectedResult)

  // Mutation return values alone cannot expose stale deletes/overwrites.
  expectValue(tree.get(action.key), model.get(action.key))
  expect(tree.has(action.key)).toBe(model.has(action.key))
  expect(tree.size).toBe(model.size)
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
  model: ReferenceModel,
): void {
  expect(actual).toEqual(
    key === undefined ? undefined : [key, model.get(key)!.reference],
  )
  if (key !== undefined) expectValue(actual?.[1], model.get(key))
}

// This is the refinement check. It compares all public observations used by
// the index code with the independent Map model at the current history cut.
function expectRefinement(
  tree: BTree<number, Payload>,
  model: ReferenceModel,
  probe: number,
): void {
  const sorted = [...model.keys()].sort((a, b) => a - b)
  // A missing key must return the caller's fallback on either side of the
  // tree, including when growth splits the root or deletion collapses it.
  const fallback = { v: probe }
  for (const key of [probe, (sorted[0] ?? 0) - 1, (sorted.at(-1) ?? 0) + 1]) {
    expect(tree.get(key, fallback)).toBe(
      model.has(key) ? model.get(key)!.reference : fallback,
    )
  }
  expect(tree.size).toBe(model.size)
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
      expectValue(value, model.get(key))
    },
  )
  expect(seen).toEqual(sorted)
  expectPair(
    tree.nextHigherPair(probe),
    sorted.find((key) => key > probe),
    model,
  )
  expectPair(
    tree.nextLowerPair(probe),
    [...sorted].reverse().find((key) => key < probe),
    model,
  )
  expectPair(tree.nextHigherPair(undefined), sorted[0], model)
  expectPair(tree.nextLowerPair(undefined), sorted[sorted.length - 1], model)
}

describe(`BTree Map oracle`, () => {
  // The 120,000-operation corpus takes about nine seconds with CI coverage.
  // This fixed lane is a stable depth campaign, not random discovery. Keep
  // every operation and assertion. This is not a five-second performance budget.
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
        const model: ReferenceModel = new Map()
        const history: Array<Action> = []
        try {
          expectRefinement(tree, model, 0)
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
            applyAction(tree, model, action)
            if (step % 97 === 0)
              expectRefinement(tree, model, Math.floor(rnd() * 200))
          }
          expectRefinement(tree, model, 100)
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
      const model: ReferenceModel = new Map()
      expectRefinement(tree, model, 0)
      for (const action of actions) {
        applyAction(tree, model, action)
        expectRefinement(tree, model, action.key)
      }
    },
  )

  it.each([4, 5, 6, 7, 8])(
    `preserves every cut through dense growth, retirement and reuse with node size %s`,
    (nodeSize) => {
      const tree = new BTree<number, Payload>((a, b) => a - b, nodeSize)
      const model: ReferenceModel = new Map()
      expectRefinement(tree, model, 0)
      // 64 entries exceed every selected leaf capacity. Deleting all then
      // reinserting exercises collapse/reuse without asserting private shape.
      const keys = Array.from({ length: 64 }, (_, key) => key)
      for (const key of keys) {
        const value = { v: key }
        expect(tree.set(key, value)).toBe(true)
        model.set(key, Object.freeze({ reference: value, v: key }))
        expectRefinement(tree, model, key)
      }
      for (const key of [...keys].reverse()) {
        expect(tree.delete(key)).toBe(true)
        model.delete(key)
        expectValue(tree.get(key), undefined)
        expectRefinement(tree, model, key)
      }
      for (const key of keys) {
        const value = { v: key + 100 }
        expect(tree.set(key, value)).toBe(true)
        model.set(key, Object.freeze({ reference: value, v: key + 100 }))
        expectRefinement(tree, model, key)
        const replacement = { v: key + 200 }
        expect(tree.set(key, replacement)).toBe(false)
        model.set(key, Object.freeze({ reference: replacement, v: key + 200 }))
        expectRefinement(tree, model, key)
      }
      tree.clear()
      model.clear()
      expectRefinement(tree, model, 0)
      const value = { v: 500 }
      tree.set(0, value)
      model.set(0, Object.freeze({ reference: value, v: 500 }))
      expectRefinement(tree, model, 0)
    },
  )

  it(`rejects wrong pair payloads, shared payload mutation and transient stale state`, () => {
    const tree = new BTree<number, Payload>((a, b) => a - b, 4)
    const value = { v: 1 }
    const model: ReferenceModel = new Map([
      [1, Object.freeze({ reference: value, v: 1 })],
    ])
    tree.set(1, value)
    expectRefinement(tree, model, 0)
    const wrongPair = vi
      .spyOn(tree, `nextHigherPair`)
      .mockReturnValue([1, { v: 2 }])
    try {
      expect(() => expectRefinement(tree, model, 0)).toThrowError(/expected/)
    } finally {
      wrongPair.mockRestore()
    }
    value.v = 2
    expect(tree.get(1)).toBe(value) // The former identity-only check stays green.
    expect(() => expectRefinement(tree, model, 0)).toThrowError(/expected/)
    value.v = 1
    expectRefinement(tree, model, 0)
    // A stale delete result can vanish at a later clear. Judge the earlier cut.
    expect(() => expectRefinement(tree, new Map(), 0)).toThrowError(/expected/)
    tree.clear()
    expectRefinement(tree, new Map(), 0)
    const staleScan = vi
      .spyOn(tree, `forRange`)
      .mockImplementation((_low, _high, _inclusive, callback) => {
        callback?.(1, value, 0)
        return 1
      })
    try {
      expect(() => expectRefinement(tree, new Map(), 0)).toThrowError(
        /expected/,
      )
    } finally {
      staleScan.mockRestore()
    }
    expectRefinement(tree, new Map(), 0)
  })

  it(`shrinks and replays a wrong neighbor payload without losing its pair key`, () => {
    const property = fc.property(
      fc.array(fc.integer({ min: 0, max: 20 }), { minLength: 1, maxLength: 8 }),
      (values) => {
        const tree = new BTree<number, Payload>((a, b) => a - b, 4)
        const model: ReferenceModel = new Map()
        values.forEach((v, key) =>
          applyAction(tree, model, { type: `put`, key, v }),
        )
        expectRefinement(tree, model, -1)
        // This pair keeps the expected key but has a wrong payload. The former
        // key-only law accepted it.
        const wrongPair: [number, Payload] = [0, { v: values[0]! + 1 }]
        expect(wrongPair[0]).toBe(0)
        expectPair(wrongPair, 0, model)
      },
    )
    const failed = fc.check(property, { seed: 303102, numRuns: 1 })
    expect(failed.failed).toBe(true)
    expect(failed.error).toMatch(/expected/)
    expect(failed.counterexample?.[0].length).toBeGreaterThan(0)
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
