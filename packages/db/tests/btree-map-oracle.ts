// For numeric keys, the BTree public API refines a Map with numeric traversal:
// point results retain payload identity/value, ranges and neighbors follow key
// order, and missing reads return the caller's fallback. The product grammar
// bounds keys, payloads and node sizes; comparator validation belongs to the
// index-update oracle. Product campaigns and ordinary shrink/replay controls
// use this same independent judgment.
import { expect } from 'vitest'
import { fc } from '@fast-check/vitest'
import { BTree } from '../src/utils/btree.js'
import { oracleAssertion } from './oracle-assertion-adapter.js'

export type Payload = { v: number }
export type Stored = Readonly<{ reference: Payload; v: number }>
export type ReferenceModel = Map<number, Stored>
export type Action =
  | { type: `put`; key: number; v: number }
  | { type: `delete` | `read` | `clear`; key: number }
export type ActionResult = boolean | undefined

export const arbitraryAction: fc.Arbitrary<Action> = fc.oneof(
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

// A fixed campaign and a random campaign run the same history grammar. A path
// replay of this property runs only its random campaign from the recorded seed
// and shrink path: TANSTACK_DB_ORACLE_SEED, TANSTACK_DB_ORACLE_PATH, and
// TANSTACK_DB_ORACLE_PROPERTY=btree-map.history with
// `pnpm exec vitest run packages/db/tests/btree-map-oracle.test.ts`.

export function runMapHistory(nodeSize: number, actions: Array<Action>): void {
  const tree = new BTree<number, Payload>((a, b) => a - b, nodeSize)
  const model: ReferenceModel = new Map()
  expectRefinement(tree, model, 0)
  for (const action of actions) {
    applyAction(tree, model, action)
    expectRefinement(tree, model, action.key)
  }
}

export const mapHistoryProperty = fc.property(
  fc.integer({ min: 4, max: 8 }),
  fc.array(arbitraryAction, { minLength: 1, maxLength: 64 }),
  runMapHistory,
)

// The model uses only Map operations and the declared numeric order. It does
// not use the tree's nodes, search helpers, or traversal code.
export function stepModel(
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
export function stepTree(
  tree: BTree<number, Payload>,
  action: Action,
  value: Payload | undefined,
): ActionResult {
  if (action.type === `put`) return tree.set(action.key, value!)
  if (action.type === `delete`) return tree.delete(action.key)
  if (action.type === `clear`) tree.clear()
  return undefined
}

export function applyAction(
  tree: BTree<number, Payload>,
  model: ReferenceModel,
  action: Action,
): void {
  const value = action.type === `put` ? { v: action.v } : undefined
  const expectedResult = stepModel(model, action, value)
  const actualResult = stepTree(tree, action, value)
  oracleAssertion('applyAction', () =>
    expect(actualResult).toBe(expectedResult),
  )

  // Mutation return values alone cannot expose stale deletes/overwrites.
  expectValue(tree.get(action.key), model.get(action.key))
  oracleAssertion('applyAction', () =>
    expect(tree.has(action.key)).toBe(model.has(action.key)),
  )
  oracleAssertion('applyAction', () => expect(tree.size).toBe(model.size))
}

export function expectValue(
  actual: Payload | undefined,
  expected: Stored | undefined,
): void {
  oracleAssertion('expectValue', () => expect(actual).toBe(expected?.reference))
  oracleAssertion('expectValue', () => expect(actual?.v).toBe(expected?.v))
}

export function expectPair(
  actual: [number, Payload] | undefined,
  key: number | undefined,
  model: ReferenceModel,
): void {
  oracleAssertion('expectPair', () =>
    expect(actual).toEqual(
      key === undefined ? undefined : [key, model.get(key)!.reference],
    ),
  )
  if (key !== undefined) expectValue(actual?.[1], model.get(key))
}

// Law 2 for one range. The expected keys come from the sorted model keys, not
// from the tree's search or traversal code.
export function expectRange(
  tree: BTree<number, Payload>,
  model: ReferenceModel,
  sorted: ReadonlyArray<number>,
  low: number,
  high: number,
  includeHigh: boolean,
): void {
  const expected = sorted.filter(
    (key) => key >= low && (includeHigh ? key <= high : key < high),
  )
  const seen: Array<number> = []
  tree.forRange(low, high, includeHigh, (key, value) => {
    seen.push(key)
    expectValue(value, model.get(key))
  })
  oracleAssertion(`forRange(${low}, ${high}, ${includeHigh})`, () =>
    expect(seen, `forRange(${low}, ${high}, ${includeHigh})`).toEqual(expected),
  )
}

// This is the refinement check. It compares all public observations used by
// the index code with the independent Map model at the current history cut.
export function expectRefinement(
  tree: BTree<number, Payload>,
  model: ReferenceModel,
  probe: number,
): void {
  const sorted = [...model.keys()].sort((a, b) => a - b)
  // A missing key must return the caller's fallback on either side of the
  // tree, including when growth splits the root or deletion collapses it.
  const fallback = { v: probe }
  for (const key of [probe, (sorted[0] ?? 0) - 1, (sorted.at(-1) ?? 0) + 1]) {
    oracleAssertion('expectRefinement', () =>
      expect(tree.get(key, fallback)).toBe(
        model.has(key) ? model.get(key)!.reference : fallback,
      ),
    )
  }
  oracleAssertion('expectRefinement', () => expect(tree.size).toBe(model.size))
  oracleAssertion('expectRefinement', () =>
    expect(tree.minKey()).toBe(sorted[0]),
  )
  oracleAssertion('expectRefinement', () =>
    expect(tree.maxKey()).toBe(sorted[sorted.length - 1]),
  )
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
  oracleAssertion('expectRefinement', () => expect(seen).toEqual(sorted))
  // Bounds on existing keys test the inclusive and exclusive edges. Bounds
  // around the probe test ranges that start or end between keys, and the
  // reversed pair tests an empty range.
  const rangeBounds: Array<[number, number]> = [
    [probe - 23, probe + 37],
    [probe, probe],
    [probe + 5, probe - 5],
    [sorted[1] ?? probe, sorted.at(-2) ?? probe],
    [sorted[0] ?? probe, sorted[0] ?? probe],
  ]
  for (const [low, high] of rangeBounds) {
    for (const includeHigh of [true, false]) {
      expectRange(tree, model, sorted, low, high, includeHigh)
    }
  }
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
