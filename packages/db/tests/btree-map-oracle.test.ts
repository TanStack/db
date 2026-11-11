import { describe, expect, vi } from 'vitest'
import { fc } from '@fast-check/vitest'
import { BTree } from '../src/utils/btree.js'
import { oracleProperty } from './oracle-config.js'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
  rejectAt,
} from './oracle-assertion-adapter.js'
import { clean, rejection } from './calibration-rejection.js'

import {
  applyAction,
  arbitraryAction,
  expectRange,
  expectRefinement,
  expectValue,
  runMapHistory,
} from './btree-map-oracle.js'
import type { Action, Payload, ReferenceModel } from './btree-map-oracle.js'

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
 * 2. A range scan returns each modeled key in `[low, high]` once in sorted
 *    order. When `includeHigh` is false, the range is `[low, high)`. A range
 *    with `low > high` is empty. `BTreeIndex.rangeQuery` uses arbitrary
 *    bounds in both modes, so the oracle checks partial and boundary ranges
 *    as well as the full scan.
 * 3. Neighbor operations return the closest strict key and its exact payload.
 * 4. A missing lookup returns the fallback object supplied by the caller.
 *
 * The model stores both the payload reference and its original value. This
 * detects a wrong payload and later mutation of a shared payload. A key-only
 * model would miss both faults.
 *
 * Generated histories vary puts, overwrites, deletes, reads, and clears. Small
 * node sizes force structural changes. A fixed long campaign gives stable
 * depth, while matched fixed-seed and random fast-check campaigns supply
 * shrinkable histories.
 */

// The tree trusts its comparator to return a valid order; BTreeIndex rejects
// invalid custom-comparator results before they reach the tree, so that law
// lives in index-update-oracle.property.test.ts.

// Splitting already determines the new child's position from the insertion
// index. A redundant comparison after mutation must not misplace it. Each
// fixture returns NaN only for the pair such a comparison would use, so the
// split must succeed without consulting it. Observe inserted-key reads and
// whole ranges; the invalid pair is not a lookup order.
function runSplitComparator([size, rightKey]: [number, number]): void {
  const insertedKey = size * 2
  const tree = new BTree<number, Payload>(
    (left, right) =>
      left === insertedKey && right === rightKey ? NaN : left - right,
    4,
  )
  const model: ReferenceModel = new Map()
  for (let key = 0; key < insertedKey; key += 2)
    applyAction(tree, model, { type: `put`, key, v: key })
  for (const key of [insertedKey, insertedKey + 2]) {
    applyAction(tree, model, { type: `put`, key, v: key })
    const sorted = [...model.keys()].sort((left, right) => left - right)
    expectRange(tree, model, sorted, -Infinity, Infinity, true)
    expect(tree.minKey()).toBe(sorted[0])
    expect(tree.maxKey()).toBe(sorted.at(-1))
  }
}

const btreeAuthority = `BTree public API numeric Map contract stated above`

oracleProperty({
  id: `btree-map.split-comparator`,
  law: {
    statement: `A split determines the new child's position from the insertion index, so the tree stays a sorted Map without consulting the comparator pair that a redundant comparison would use.`,
    authority: btreeAuthority,
    limits: `Node size 4 after 16 and 32 accepted entries, with NaN returned only for the pair such a comparison would use.`,
  },
  owns: [`src/utils/btree.ts`],
  histories: [
    [16, 14],
    [32, 46],
  ] as Array<[number, number]>,
  label: ([size]) =>
    `preserves the Map across a split after ${size} accepted entries`,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(`btree-map.split-comparator`, plan, observe, () =>
      runSplitComparator(plan.history),
    ),
  check: forwardAssertionJudgment,
})

function runInfiniteComparator(): void {
  const tree = new BTree<number, Payload>((left, right) =>
    left === right ? 0 : left < right ? -Infinity : Infinity,
  )
  const model: ReferenceModel = new Map()
  for (const key of [2, 0, 1]) {
    applyAction(tree, model, { type: `put`, key, v: key })
    expectRefinement(tree, model, key)
  }
}

oracleProperty({
  id: `btree-map.infinite-comparator`,
  law: {
    statement: `Numeric BTree observations agree with the sorted Map when the comparator returns infinite results that still provide an order.`,
    authority: btreeAuthority,
    limits: `One fixed history of three puts under a comparator that returns -Infinity, 0 or Infinity.`,
  },
  owns: [`src/utils/btree.ts`],
  histories: [
    `accepts infinite comparison results that still provide an order`,
  ],
  label: (name) => name,
  resolve: (name) => ({ name }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(
      `btree-map.infinite-comparator`,
      plan,
      observe,
      () => runInfiniteComparator(),
    ),
  check: forwardAssertionJudgment,
})

describe(`BTree Map oracle`, () => {
  // The 120,000-operation corpus takes about nine seconds with CI coverage.
  // This fixed-seed campaign is a stable depth campaign, not random discovery. Keep
  // every operation and assertion. This is not a five-second performance budget.
  oracleProperty({
    id: `btree-map.long-campaign`,
    law: {
      statement: `Numeric BTree point, range, fallback and neighbor observations agree with the independent sorted Map after every action.`,
      authority: btreeAuthority,
      limits: `One deterministic depth campaign: 40 rounds of 3,000 random puts, deletes, clears and reads over 200 keys with node sizes 4 through 8, from seed 12345.`,
    },
    owns: [`src/utils/btree.ts`],
    histories: [
      `matches a Map oracle under random insert/delete/overwrite with small nodes`,
    ],
    label: (name) => name,
    resolve: (name) => ({ name }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`BTree Map refinement`, plan, observe, () => {
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
      }),
    check: forwardAssertionJudgment,
    timeout: 30_000,
  })

  oracleProperty({
    id: `btree-map.history`,
    law: {
      statement: `Numeric BTree point, range, fallback and neighbor observations agree with the independent sorted Map after every action.`,
      authority: `BTree public API numeric Map contract stated above`,
      limits: `Numeric keys, plain payloads and node sizes 4 through 8; comparator validation belongs to the index-update oracle.`,
    },
    // What this oracle owns: the gap report judges the B+ tree in
    // utils/btree.ts by this file's tests. The refinement check and the Map model
    // judge every public observation of the tree.
    owns: [`src/utils/btree.ts`],
    histories: {
      arbitrary: fc.tuple(
        fc.integer({ min: 4, max: 8 }),
        fc.array(arbitraryAction, { minLength: 1, maxLength: 64 }),
      ),
      runs: 100,
      fixedSeeds: [20260930],
    },
    resolve: ([nodeSize, actions]) => ({ nodeSize, actions }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`BTree Map refinement`, plan, observe, () =>
        runMapHistory(plan.nodeSize, plan.actions),
      ),
    check: forwardAssertionJudgment,
    // Each calibration replays its old body. The refinement check must reject
    // every wrong answer with an error that the old matcher accepted, and
    // every clean check in the body must still pass.
    calibrations: [
      {
        name: `rejects wrong pair payloads, shared payload mutation and transient stale state`,
        law: `BTree Map refinement`,
        driver: (plan, observe) =>
          recordAssertionJudgment(`BTree Map refinement`, plan, observe, () => {
            const expected = (error: Error) => /expected/.test(error.message)
            const rejections: Array<Error> = []
            const tree = new BTree<number, Payload>((a, b) => a - b, 4)
            const value = { v: 1 }
            const model: ReferenceModel = new Map([
              [1, Object.freeze({ reference: value, v: 1 })],
            ])
            tree.set(1, value)
            clean(() => expectRefinement(tree, model, 0))
            const wrongPair = vi
              .spyOn(tree, `nextHigherPair`)
              .mockReturnValue([1, { v: 2 }])
            try {
              rejections.push(
                rejection(expected, () => expectRefinement(tree, model, 0)),
              )
            } finally {
              wrongPair.mockRestore()
            }
            value.v = 2
            expect(tree.get(1)).toBe(value) // The former identity-only check stays green.
            rejections.push(
              rejection(expected, () => expectRefinement(tree, model, 0)),
            )
            value.v = 1
            clean(() => expectRefinement(tree, model, 0))
            // A stale delete result can vanish at a later clear. Judge the earlier cut.
            rejections.push(
              rejection(expected, () => expectRefinement(tree, new Map(), 0)),
            )
            tree.clear()
            clean(() => expectRefinement(tree, new Map(), 0))
            const staleScan = vi
              .spyOn(tree, `forRange`)
              .mockImplementation((_low, _high, _inclusive, callback) => {
                callback(1, value)
              })
            try {
              rejections.push(
                rejection(expected, () => expectRefinement(tree, new Map(), 0)),
              )
            } finally {
              staleScan.mockRestore()
            }
            clean(() => expectRefinement(tree, new Map(), 0))
            rejectAt(
              `calibration: wrong pair payloads, shared payload mutation and transient stale state`,
              rejections[0]!,
            )
          }),
      },
      // Law 2 calibration. Each wrapper keeps the full scan correct, so only
      // the partial and boundary range checks can reject it.
      ...[
        {
          design: `ignores includeHigh`,
          wrap: (scan: BTree<number, Payload>[`forRange`]) =>
            ((low, high, _includeHigh, onFound) =>
              scan(low, high, true, onFound)) as typeof scan,
        },
        {
          design: `ignores the low bound`,
          wrap: (scan: BTree<number, Payload>[`forRange`]) =>
            ((_low, high, includeHigh, onFound) =>
              scan(-Infinity, high, includeHigh, onFound)) as typeof scan,
        },
      ].map(({ design, wrap }) => ({
        name: `rejects a range scan that ${design}`,
        law: `BTree Map refinement`,
        driver: (
          plan: { nodeSize: number; actions: Array<Action> },
          observe: (checkpoint: string, value: unknown) => void,
        ) =>
          recordAssertionJudgment(`BTree Map refinement`, plan, observe, () => {
            const tree = new BTree<number, Payload>((a, b) => a - b, 4)
            const model: ReferenceModel = new Map()
            for (let key = 0; key < 40; key += 2)
              applyAction(tree, model, { type: `put`, key, v: key })
            clean(() => expectRefinement(tree, model, 21))
            const scan = tree.forRange.bind(tree)
            const wrongScan = vi
              .spyOn(tree, `forRange`)
              .mockImplementation(wrap(scan))
            let rejected: Error
            try {
              rejected = rejection(
                (error) => /forRange\(/.test(error.message),
                () => expectRefinement(tree, model, 21),
              )
            } finally {
              wrongScan.mockRestore()
            }
            clean(() => expectRefinement(tree, model, 21))
            rejectAt(`calibration: range scan that ${design}`, rejected)
          }),
      })),
    ],
  })

  const runDenseCuts = (nodeSize: number) => {
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
  }
  oracleProperty({
    id: `btree-map.dense-cuts`,
    law: {
      statement: `Numeric BTree point, range, fallback and neighbor observations agree with the independent sorted Map after every action.`,
      authority: btreeAuthority,
      limits: `64 dense puts, reverse deletes, reinsertion with overwrite, clear and one put, at node sizes 4 through 8.`,
    },
    owns: [`src/utils/btree.ts`],
    histories: [4, 5, 6, 7, 8],
    label: (nodeSize) =>
      `preserves every cut through dense growth, retirement and reuse with node size ${nodeSize}`,
    resolve: (nodeSize) => ({ nodeSize }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`BTree Map refinement`, plan, observe, () =>
        runDenseCuts(plan.nodeSize),
      ),
    check: forwardAssertionJudgment,
  })
})
