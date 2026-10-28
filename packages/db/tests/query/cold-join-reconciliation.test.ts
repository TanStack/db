/**
 * Ordinary unit tests moved out of cold-join-reconciliation-oracle.test.ts.
 * Each one checks a fixed result written in the test: a cleanup failure, a
 * binary and nullish join class, a lifecycle of equal and unequal replacements,
 * a raw binary demand, and an unsupported compound predicate. The laws they
 * touch are owned by cold-join-reconciliation-oracle.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { Func } from '../../src/query/ir.js'
import { JoinConditionMustBeEqualityError } from '../../src/errors.js'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import {
  Query,
  and,
  createLiveQueryCollection,
  eq,
  gt,
  or,
} from '../../src/query/index.js'
import {
  checkWithCleanup,
  createEqualitySource,
  sortJoinPairs,
} from './cold-join-support.js'
import type { EqualityRow, JoinPair } from './cold-join-support.js'
import type { LoadSubsetOptions } from '../../src/types.js'

it(`preserves the primary mismatch and releases every resource after cleanup failure`, async () => {
  const mismatch = new Error(`join result mismatch`)
  const cleanupFailure = new Error(`first cleanup failed`)
  const released: Array<string> = []
  let reported: unknown
  try {
    await checkWithCleanup(
      async () => {
        throw mismatch
      },
      {
        cleanup: () => {
          released.push(`first`)
          throw cleanupFailure
        },
      },
      {
        cleanup: async () => {
          released.push(`second`)
        },
      },
    )
  } catch (error) {
    reported = error
  }
  expect(reported).toBeInstanceOf(AggregateError)
  expect((reported as AggregateError).cause).toBe(mismatch)
  expect((reported as AggregateError).errors).toEqual([
    mismatch,
    expect.objectContaining({ errors: [cleanupFailure] }),
  ])
  expect(released).toEqual([`first`, `second`])
})

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  )
}

let equalitySourceId = 0

describe.each([`off`, `eager`] as const)(
  `join equality oracle with auto-index %s`,
  (autoIndex) => {
    it(`keeps binary encodings and nullish operands in disjoint join classes`, async () => {
      const bytes = new Uint8Array([65])
      const text = `\u0000tanstack-db:binary:A`
      const binaryLeft = createEqualitySource<EqualityRow>(
        `binary-disjoint-left`,
        [{ id: 1, value: bytes }],
        autoIndex,
      )
      const binaryRight = createEqualitySource<EqualityRow>(
        `binary-disjoint-right`,
        [
          { id: 10, value: new Uint8Array(bytes) },
          { id: 20, value: text },
        ],
        autoIndex,
      )
      const binaryJoin = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ left: binaryLeft })
            .innerJoin({ right: binaryRight }, ({ left, right }) =>
              eq(left.value, right.value),
            )
            .select(({ right }) => ({ id: right.id })),
      })

      type NullishRow = { id: number; value: null | undefined | string }
      const nullishRows: Array<NullishRow> = [
        { id: 1, value: null },
        { id: 2, value: undefined },
        { id: 3, value: `\0m` },
        { id: 4, value: `\0j` },
      ]
      const nullishLeft = createEqualitySource(
        `nullish-left`,
        nullishRows,
        autoIndex,
      )
      const nullishRight = createEqualitySource(
        `nullish-right`,
        nullishRows,
        autoIndex,
      )
      const fullJoin = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ left: nullishLeft })
            .fullJoin({ right: nullishRight }, ({ left, right }) =>
              eq(left.value, right.value),
            )
            .select(({ left, right }) => ({
              leftId: left.id,
              rightId: right.id,
            })),
      })

      await checkWithCleanup(
        async () => {
          await Promise.all([binaryJoin.preload(), fullJoin.preload()])
          expect(binaryJoin.toArray).toMatchObject([{ id: 10 }])
          expect(
            sortJoinPairs(
              fullJoin.toArray.map(
                ({ leftId, rightId }) => [leftId, rightId] as const,
              ),
            ),
          ).toEqual([
            [1, undefined],
            [2, undefined],
            [3, 3],
            [4, 4],
            [undefined, 1],
            [undefined, 2],
          ])
        },
        binaryJoin,
        fullJoin,
        binaryRight,
        binaryLeft,
        nullishRight,
        nullishLeft,
      )
    })

    it(`preserves equality classes through equal, unequal, and nullish replacements`, async () => {
      type LifecycleRow = { id: number; value: Uint8Array | number | null }
      const left = createEqualitySource<LifecycleRow>(
        `lifecycle-left`,
        [
          { id: 1, value: new Uint8Array([1, 2, 3]) },
          { id: 2, value: null },
        ],
        autoIndex,
      )
      const right = createEqualitySource<LifecycleRow>(
        `lifecycle-right`,
        [
          { id: 10, value: new Uint8Array([1, 2, 3]) },
          { id: 20, value: null },
          { id: 30, value: null },
        ],
        autoIndex,
      )
      const joined = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ left })
            .fullJoin({ right }, ({ left: l, right: r }) =>
              eq(l.value, r.value),
            )
            .select(({ left: l, right: r }) => ({
              leftId: l.id,
              rightId: r.id,
            })),
      })
      const pairs = () =>
        sortJoinPairs(
          joined.toArray.map(
            ({ leftId, rightId }) => [leftId, rightId] as const,
          ),
        )
      const duplicateNullPair: JoinPair = [undefined, 30]
      const expectPairs = (expected: Array<JoinPair>) => {
        expect(
          pairs(),
          `duplicate same-side null outer row must remain observable`,
        ).toEqual([...expected, duplicateNullPair])
      }
      await checkWithCleanup(
        async () => {
          await joined.preload()
          expectPairs([
            [1, 10],
            [2, undefined],
            [undefined, 20],
          ])
          await right.oracleReplace({
            id: 10,
            value: new Uint8Array([1, 2, 3]),
          })
          expectPairs([
            [1, 10],
            [2, undefined],
            [undefined, 20],
          ])
          await right.oracleReplace({
            id: 10,
            value: new Uint8Array([1, 2, 4]),
          })
          expectPairs([
            [1, undefined],
            [2, undefined],
            [undefined, 10],
            [undefined, 20],
          ])
          await right.oracleReplace({
            id: 10,
            value: new Uint8Array([1, 2, 3]),
          })
          expectPairs([
            [1, 10],
            [2, undefined],
            [undefined, 20],
          ])
          await right.oracleReplace({ id: 20, value: 1 })
          expectPairs([
            [1, 10],
            [2, undefined],
            [undefined, 20],
          ])
          await left.oracleReplace({ id: 2, value: 1 })
          expectPairs([
            [1, 10],
            [2, 20],
          ])
          await left.oracleReplace({ id: 2, value: null })
          expectPairs([
            [1, 10],
            [2, undefined],
            [undefined, 20],
          ])
        },
        joined,
        right,
        left,
      )
    })

    it(`passes raw binary equality demand through the lazy join path`, async () => {
      type BinaryRow = { id: number; binaryId: Uint8Array }
      const activeKey = new Uint8Array([1, 2, 3])
      const active = createEqualitySource<BinaryRow>(
        `binary-demand-active`,
        [{ id: 1, binaryId: activeKey }],
        autoIndex,
      )
      const backend: Array<BinaryRow> = [
        { id: 10, binaryId: new Uint8Array(activeKey) },
        { id: 20, binaryId: new Uint8Array([1, 2, 4]) },
      ]
      let loadCalls = 0
      let candidateChecks = 0
      const requestedValues: Array<unknown> = []
      const lazy = createCollection<BinaryRow>({
        id: `binary-demand-lazy-${autoIndex}-${equalitySourceId++}`,
        getKey: (row) => row.id,
        autoIndex,
        defaultIndexType: autoIndex === `eager` ? BTreeIndex : undefined,
        syncMode: `on-demand`,
        sync: {
          sync: (actions) => {
            actions.markReady()
            return {
              loadSubset: (options: LoadSubsetOptions) => {
                loadCalls++
                const where = options.where
                if (where?.type !== `func` || where.name !== `in`)
                  throw new Error(`expected binary demand to use IN`)
                const candidates = where.args[1]
                if (
                  candidates?.type !== `val` ||
                  !Array.isArray(candidates.value)
                )
                  throw new Error(`expected binary demand candidates`)
                requestedValues.push(...candidates.value)
                const requested = candidates.value[0]
                if (!(requested instanceof Uint8Array))
                  throw new Error(`expected raw binary demand value`)
                actions.begin()
                for (const row of backend) {
                  candidateChecks++
                  if (bytesEqual(row.binaryId, requested))
                    actions.write({ type: `insert`, value: row })
                }
                const receipt = actions.commit()
                return receipt === true ? true : receipt
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const joined = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ left: active })
            .leftJoin({ right: lazy }, ({ left, right }) =>
              eq(left.binaryId, right.binaryId),
            )
            .select(({ left, right }) => ({
              leftId: left.id,
              rightId: right.id,
            })),
      })

      await checkWithCleanup(
        async () => {
          await joined.preload()
          expect(loadCalls).toBe(1)
          expect(candidateChecks).toBe(2)
          expect(requestedValues).toHaveLength(1)
          expect(requestedValues[0]).toBeInstanceOf(Uint8Array)
          expect(Array.from(requestedValues[0] as Uint8Array)).toEqual(
            Array.from(activeKey),
          )
          expect(joined.toArray).toMatchObject([{ leftId: 1, rightId: 10 }])
        },
        joined,
        lazy,
        active,
      )
    })
  },
)

// Admission is a finite predicate grammar. OR, inequalities, and empty AND
// are outside the feature contract, including when buried in a valid AND.
// Rejection must happen at the builder boundary, before source acquisition.
it.each([`or`, `inequality`, `empty`, `nested-invalid`] as const)(
  `rejects unsupported compound join predicate %s`,
  async (shape) => {
    const source = () =>
      createCollection<{ id: number }>({
        getKey: (row) => row.id,
        sync: {
          sync: () => {
            throw new Error(`unexpected acquisition`)
          },
        },
      })
    const left = source()
    const right = source()
    await checkWithCleanup(
      () => {
        expect(() =>
          new Query()
            .from({ left })
            .innerJoin({ right }, ({ left: l, right: r }) => {
              const equality = eq(l.id, r.id)
              if (shape === `or`) return or(equality, equality)
              if (shape === `inequality`) return gt(l.id, r.id)
              if (shape === `empty`) return new Func<boolean>(`and`, [])
              return and(equality, and(equality, gt(l.id, r.id)))
            }),
        ).toThrow(JoinConditionMustBeEqualityError)
        return Promise.resolve()
      },
      left,
      right,
    )
  },
)
