import fc from 'fast-check'
import { Temporal } from 'temporal-polyfill'
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
  oraclePropertyOptions,
  oracleRuns,
  readOracleRunConfig,
} from '../oracle-config.js'
import { runTrace } from '../trace-runner.js'
import type { Collection } from '../../src/collection/index.js'
import type {
  ChangeMessage,
  LoadSubsetOptions,
  SyncConfig,
} from '../../src/types.js'

/**
 * # Does a cold join reconcile to independent relational truth?
 *
 * A live join may begin before its on-demand child source contains rows. The
 * compiled query must acquire that source, publish the complete join, then keep
 * it equal to a fresh relational recomputation through child deletion,
 * restoration, and route moves. Join equality must follow the same established
 * value classes as predicate equality without merging binary, string, or
 * nullish domains.
 *
 * Plain parent and child arrays plus a Map-based backend form the model. The
 * reference joins matching keys from scratch after each command. The production
 * driver starts with a cold child Collection and observes the actual acquisition,
 * raw batches, reconstructed replica, and live rows across scan and indexed
 * paths. Observation mutants prove that a hidden acquisition, dropped delete,
 * or wrong result is detected independently.
 *
 * The Identity and Initial demand sections of live/ARCHITECTURE.md authorize
 * the equality and acquisition laws. The test-only replica folds public change
 * messages; it does not represent an internal Collection or D2 relation.
 * The compound section extends equality and source-history coverage to AND.
 * Demand minimization remains outside this contract. The
 * cold witness requires real acquisition and correct rows, not a particular
 * optimization plan.
 */

type Parent = { id: number; name: string }
type Child = { id: number; parentId: number; amount: number }
type Joined = { id: number; parentId: number; name: string; amount: number }
type Step = { type: `delete`; id: number } | { type: `put`; row: Child }
type ObservationMutant = `hide-acquisition` | `drop-delete` | `wrong-result`

const parents: ReadonlyArray<Parent> = [
  { id: 1, name: `Ada` },
  { id: 2, name: `Grace` },
]
const initial: ReadonlyArray<Child> = [
  { id: 10, parentId: 1, amount: 1 },
  { id: 20, parentId: 1, amount: 2 },
  { id: 30, parentId: 2, amount: 3 },
]
const plain = ({ id, parentId, name, amount }: Joined): Joined => ({
  id,
  parentId,
  name,
  amount,
})
const ordered = (rows: Iterable<Joined>) =>
  [...rows].map(plain).sort((a, b) => a.id - b.id)

async function runColdJoin(
  steps: ReadonlyArray<Step>,
  mutant?: ObservationMutant,
) {
  const model = new Map(initial.map((row) => [row.id, { ...row }]))
  const backend = new Map(initial.map((row) => [row.id, { ...row }]))
  const installed = new Set<number>()
  const calls: Array<{ rows: Array<Child> }> = []
  const batches: Array<Array<ChangeMessage<Joined>>> = []
  const replica = new Map<string | number, Joined>()
  let sync!: Parameters<SyncConfig<Child>[`sync`]>[0]
  const parentSource = createCollection<Parent>({
    getKey: (row) => row.id,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const row of parents) write({ type: `insert`, value: { ...row } })
        commit()
        markReady()
      },
    },
  })
  const children = createCollection<Child>({
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (actions) => {
        sync = actions
        actions.markReady()
        return {
          loadSubset: (options) => {
            if (
              options.where ||
              options.orderBy ||
              options.cursor ||
              options.limit !== undefined ||
              (options.offset !== undefined && options.offset !== 0)
            )
              throw new Error(
                `cold join fixture requires a whole-source demand`,
              )
            // This join acquires the full child source. Demand minimization is
            // not a contract; the witness is that cold acquisition really runs.
            const rows = [...backend.values()]
            calls.push({
              rows: rows.map((row) => ({ ...row })),
            })
            actions.begin()
            for (const row of rows) {
              if (installed.has(row.id)) continue
              installed.add(row.id)
              actions.write({ type: `insert`, value: { ...row } })
            }
            const applied = actions.commit()
            return applied === true ? true : applied
          },
          // This bounded provider retains cached rows on release. There is no
          // external transport resource; lease eviction is a different oracle.
          unloadSubset: () => {},
        }
      },
    },
  })
  const live = createLiveQueryCollection((q) =>
    q
      .from({ parent: parentSource })
      .innerJoin({ child: children }, ({ parent, child }) =>
        eq(parent.id, child.parentId),
      )
      .select(({ parent, child }) => ({
        id: child.id,
        parentId: parent.id,
        name: parent.name,
        amount: child.amount,
      })),
  )
  let subscription: ReturnType<typeof live.subscribeChanges> | undefined
  await runTrace({
    steps,
    driver: {
      setup: () => undefined,
      start: async () => {
        expect(children.size).toBe(0)
        expect(calls).toEqual([])
        await parentSource.preload()
        // Never preload the child collection: the compiled join must acquire it.
        subscription = live.subscribeChanges(
          (changes) => {
            const captured = changes.map((change) => ({
              ...change,
              value: plain(change.value),
              ...(change.previousValue && {
                previousValue: plain(change.previousValue),
              }),
            }))
            batches.push(captured)
            for (const change of captured) {
              if (change.type === `delete`) {
                if (mutant !== `drop-delete`) replica.delete(change.key)
              } else replica.set(change.key, change.value)
            }
          },
          { includeInitialState: true },
        )
        await live.preload()
      },
      apply: async (step) => {
        if (step.type === `delete`) {
          model.delete(step.id)
          const previous = backend.get(step.id)
          backend.delete(step.id)
          if (!previous || !installed.delete(step.id)) return
          sync.begin()
          sync.write({ type: `delete`, value: { ...previous } })
        } else {
          model.set(step.row.id, { ...step.row })
          backend.set(step.row.id, { ...step.row })
          sync.begin()
          sync.write({
            type: installed.has(step.row.id) ? `update` : `insert`,
            value: { ...step.row },
          })
          installed.add(step.row.id)
        }
        await sync.commit()
      },
      cleanup: async () => {
        const outcomes = await Promise.allSettled(
          [
            () => subscription?.unsubscribe(),
            () => live.cleanup(),
            () => children.cleanup(),
            () => parentSource.cleanup(),
          ].map((cleanup) => Promise.resolve().then(cleanup)),
        )
        const errors = outcomes.flatMap((outcome) =>
          outcome.status === `rejected` ? [outcome.reason] : [],
        )
        if (errors.length)
          throw new AggregateError(errors, `cold join cleanup failed`)
      },
    },
    projection: {
      observe: () => {
        const rows = ordered(live.values())
        if (mutant === `wrong-result` && rows.length) rows[0]!.amount++
        return {
          rows,
          replica: ordered(replica.values()),
          calls: mutant === `hide-acquisition` ? [] : calls,
        }
      },
      recompute: () =>
        parents.flatMap((parent) =>
          [...model.values()]
            .filter((child) => child.parentId === parent.id)
            .map((child) => ({
              id: child.id,
              parentId: parent.id,
              name: parent.name,
              amount: child.amount,
            })),
        ),
      assertEqual: (actual, expected) => {
        expect(
          actual.calls.some((call) => call.rows.length > 0),
          `a nonempty cold acquisition must reach the provider`,
        ).toBe(true)
        expect(actual.calls[0]?.rows).toEqual(initial)
        expect(actual.rows).toEqual(ordered(expected))
        expect(actual.replica).toEqual(ordered(expected))
        return undefined
      },
    },
  })
  return batches
}

/**
 * Join-equality contract: a compiled equality join must agree with the
 * predicate evaluator over the established ValueIdentity domains. The
 * independent predicate source prevents shared indexes from satisfying path
 * reach. Binary/string and nullish controls, replacement histories, raw lazy
 * demand, and off/eager index modes guard the historical key-normalization
 * defect without claiming compound join syntax.
 */
type EqualityRow = { id: number; value: unknown }
type JoinPair = readonly [number | undefined, number | undefined]
type EqualityMode = `off` | `eager`
type MutableEqualitySource<T extends { id: number }> = Collection<T, number> & {
  oracleReplace: (row: T) => Promise<void>
}

const equalityJoinCases = [
  {
    label: `scalar strings`,
    createValues: () => ({ left: `match`, right: `match`, other: `other` }),
  },
  {
    label: `small binary values`,
    createValues: () => ({
      left: new Uint8Array(16).fill(7),
      right: new Uint8Array(16).fill(7),
      other: new Uint8Array(16).fill(8),
    }),
  },
  {
    label: `large binary values`,
    createValues: () => ({
      left: new Uint8Array(200).fill(7),
      right: new Uint8Array(200).fill(7),
      other: new Uint8Array(200).fill(8),
    }),
  },
  {
    label: `Uint8Array and Buffer values`,
    createValues: () => ({
      left: new Uint8Array(16).fill(7),
      right: Buffer.alloc(16, 7),
      other: new Uint8Array(16).fill(8),
    }),
  },
  {
    label: `Date timestamps`,
    createValues: () => ({
      left: new Date(1),
      right: new Date(1),
      other: new Date(2),
    }),
  },
  {
    label: `Temporal values`,
    createValues: () => ({
      left: Temporal.PlainDate.from(`2024-04-05`),
      right: Temporal.PlainDate.from(`2024-04-05`),
      other: Temporal.PlainDate.from(`2024-04-06`),
    }),
  },
  {
    label: `BigInt values`,
    createValues: () => ({
      left: 9007199254740993n,
      right: 9007199254740993n,
      other: 1n,
    }),
  },
  {
    label: `NaN values`,
    createValues: () => ({ left: Number.NaN, right: Number.NaN, other: 0 }),
  },
  {
    label: `non-finite numbers`,
    createValues: () => ({
      left: Number.POSITIVE_INFINITY,
      right: Number.POSITIVE_INFINITY,
      other: Number.NEGATIVE_INFINITY,
    }),
  },
  {
    label: `opaque shared references`,
    createValues: () => {
      const shared = { code: 1 }
      return { left: shared, right: shared, other: { code: 1 } }
    },
  },
] as const

let equalitySourceId = 0

function createEqualitySource<T extends { id: number }>(
  label: string,
  rows: ReadonlyArray<T>,
  autoIndex: EqualityMode,
): MutableEqualitySource<T> {
  let actions!: Parameters<SyncConfig<T, number>[`sync`]>[0]
  const collection = createCollection<T, number>({
    id: `${label}-${equalitySourceId++}`,
    getKey: (row) => row.id,
    autoIndex,
    defaultIndexType: autoIndex === `eager` ? BTreeIndex : undefined,
    startSync: true,
    sync: {
      sync: (nextActions) => {
        actions = nextActions
        const { begin, write, commit, markReady } = nextActions
        begin()
        for (const row of rows) write({ type: `insert`, value: { ...row } })
        commit()
        markReady()
      },
    },
  })
  return Object.assign(collection, {
    oracleReplace: async (row: T) => {
      actions.begin()
      actions.write({ type: `update`, value: row })
      await actions.commit()
    },
  })
}

function sortJoinPairs(pairs: Array<JoinPair>): Array<JoinPair> {
  return pairs.sort(
    ([leftA, rightA], [leftB, rightB]) =>
      (leftA ?? Number.POSITIVE_INFINITY) -
        (leftB ?? Number.POSITIVE_INFINITY) ||
      (rightA ?? Number.POSITIVE_INFINITY) -
        (rightB ?? Number.POSITIVE_INFINITY),
  )
}

async function cleanupAll(
  ...resources: Array<{ cleanup: () => Promise<void> }>
) {
  const results = await Promise.allSettled(
    resources.map((resource) =>
      Promise.resolve().then(() => resource.cleanup()),
    ),
  )
  const errors = results.flatMap((result) =>
    result.status === `rejected` ? [result.reason] : [],
  )
  if (errors.length)
    throw new AggregateError(errors, `join oracle cleanup failed`)
}

async function checkWithCleanup(
  check: () => Promise<void>,
  ...resources: Array<{ cleanup: () => Promise<void> }>
): Promise<void> {
  let primaryFailure: unknown
  let checkFailed = false
  try {
    await check()
  } catch (error) {
    primaryFailure = error
    checkFailed = true
  }

  try {
    await cleanupAll(...resources)
  } catch (cleanupFailure) {
    if (checkFailed) {
      throw new AggregateError(
        [primaryFailure, cleanupFailure],
        `join oracle check and cleanup failed`,
        { cause: primaryFailure },
      )
    }
    throw cleanupFailure
  }
  if (checkFailed) throw primaryFailure
}

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

describe.each([`off`, `eager`] as const)(
  `join equality oracle with auto-index %s`,
  (autoIndex) => {
    it.each(equalityJoinCases)(
      `$label joins agree with equality predicates`,
      async ({ label, createValues }) => {
        const { left: leftValue, right: rightValue, other } = createValues()
        const left = createEqualitySource<EqualityRow>(
          `equality-left-${label}`,
          [{ id: 1, value: leftValue }],
          autoIndex,
        )
        const rightRows = [
          { id: 10, value: rightValue },
          { id: 20, value: other },
        ]
        const right = createEqualitySource<EqualityRow>(
          `equality-right-${label}`,
          rightRows,
          autoIndex,
        )
        const predicateRight = createEqualitySource<EqualityRow>(
          `equality-predicate-${label}`,
          rightRows,
          autoIndex,
        )
        const joined = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ left })
              .innerJoin({ right }, ({ left: l, right: r }) =>
                eq(l.value, r.value),
              )
              .select(({ right: row }) => ({ id: row.id })),
        })
        const filtered = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ right: predicateRight })
              .where(({ right: row }) => eq(row.value, leftValue))
              .select(({ right: row }) => ({ id: row.id })),
        })

        await checkWithCleanup(
          async () => {
            await Promise.all([joined.preload(), filtered.preload()])
            const expected = [{ id: 10 }]
            expect(joined.toArray, `${label} join result`).toMatchObject(
              expected,
            )
            expect(filtered.toArray, `${label} predicate result`).toMatchObject(
              expected,
            )
            expect(joined.toArray.map(({ id }) => ({ id }))).toEqual(
              filtered.toArray.map(({ id }) => ({ id })),
            )
            if (autoIndex === `eager`)
              expect(
                right.indexes.size,
                `${label} join auto-index reach`,
              ).toBeGreaterThan(0)
            else expect(right.indexes.size, `${label} join scan path`).toBe(0)
          },
          joined,
          filtered,
          predicateRight,
          right,
          left,
        )
      },
    )

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

const history: ReadonlyArray<Step> = [
  { type: `delete`, id: 10 },
  { type: `put`, row: { id: 10, parentId: 2, amount: 7 } },
  { type: `put`, row: { id: 20, parentId: 2, amount: 8 } },
  { type: `delete`, id: 30 },
  { type: `put`, row: { id: 20, parentId: 1, amount: 9 } },
]
// History grammar: start with three unique child keys, then delete any key or
// put one keyed replacement. Deleting an absent key is a legal no-op. The
// fixed prefix reconstructs delete, restore, and both directions of a route
// move; random tails add a fresh key (40), repeated replacements, and absent
// deletes. Removing delete loses retraction; removing put loses restoration
// and route movement; fixing parentId loses movement; excluding key 40 loses
// fresh insertion. The bounded tail uses keys 10/20/30/40, parent IDs 1/2,
// amounts -5..5, and lengths 0..15. It excludes simultaneous duplicate child
// keys, which a keyed Collection cannot represent, and unmatched parent IDs.
it(`reconciles cold join acquisition, deletion, restoration and route moves`, async () => {
  const batches = await runColdJoin(history)
  expect(
    batches.flat().filter((change) => change.type === `delete`).length,
  ).toBeGreaterThanOrEqual(2)
})
const coldJoinProperty = `cold-join.reconciliation`
const { replayPath, replayProperty } = readOracleRunConfig()
const coldJoinSeeds =
  replayPath !== undefined && replayProperty === coldJoinProperty
    ? [undefined]
    : [941207, undefined]

// The fixed and random campaigns use one grammar and checker. A seed and
// shrink path replay only the requested campaign through oraclePropertyOptions.
it.each(coldJoinSeeds)(`checks cold join histories, seed=%s`, async (seed) => {
  const step: fc.Arbitrary<Step> = fc.oneof(
    fc
      .constantFrom(10, 20, 30, 40)
      .map((id) => ({ type: `delete` as const, id })),
    fc
      .record({
        id: fc.constantFrom(10, 20, 30, 40),
        parentId: fc.integer({ min: 1, max: 2 }),
        amount: fc.integer({ min: -5, max: 5 }),
      })
      .map((row) => ({ type: `put` as const, row })),
  )
  await fc.assert(
    fc.asyncProperty(
      fc.array(step, { minLength: 0, maxLength: 15 }),
      async (steps) => {
        await runColdJoin([...history, ...steps])
      },
    ),
    seed === undefined
      ? oraclePropertyOptions(50, coldJoinProperty)
      : { seed, numRuns: oracleRuns(50) },
  )
})
it.each([`hide-acquisition`, `drop-delete`, `wrong-result`] as const)(
  `rejects %s through the real cold join trace checker`,
  async (mutant) => {
    await runColdJoin(history)
    await expect(runColdJoin(history, mutant)).rejects.toMatchObject({
      name: `TraceAssertionError`,
      cause: { name: `AssertionError` },
    })
  },
)

/**
 * Compound joins extend the same equality law to a nonempty conjunction. Every
 * operand must be TRUE; UNKNOWN never matches, and outer joins preserve each
 * unmatched source row. The feature request authorizes AND-of-equality syntax;
 * ARCHITECTURE.md's Identity law supplies each operand's established meaning.
 *
 * The model below joins integer labels from an explicit equality-class table.
 * Labels are a test abstraction for values, not production keys. It never
 * calls the evaluator, normalizer, identity encoder, or join compiler.
 *
 * The grammar varies two/three terms, nested AND, term order, operand reversal,
 * all four join types, scan/index paths, and eager/cold joined sources. Histories put,
 * replace, delete and restore keyed rows; removing an absent key is a no-op in
 * the driver. The cold provider publishes its whole finite table on demand;
 * this proves acquisition and row truth, not demand minimality or real I/O.
 * A positive acquisition witness requires a satisfiable left tuple. A nullish
 * component prevents a match and may require no acquisition, in any term order.
 * Reads and a replica reconstructed from public events are checked after
 * preload and each applied sync transaction. No optimistic or replay law is
 * claimed here. Correlated parent transport has its own includes oracle.
 */
type CompoundRow = {
  id: number
  a: unknown
  b: number | null
  c: number
  revision: number
}
type CompoundModelRow = {
  id: number
  atom: number
  b: number | null
  c: number
}
type CompoundJoin = `inner` | `left` | `right` | `full`
type CompoundStep = {
  side: `left` | `right`
  row: CompoundModelRow
  remove: boolean
}
type CompoundHistory = {
  left: Array<CompoundModelRow>
  right: Array<CompoundModelRow>
  steps: Array<CompoundStep>
  join: CompoundJoin
  width: 2 | 3
  atomFirst: boolean
  nested: boolean
  reversed: boolean
  autoIndex: EqualityMode
  cold: boolean
}

function compoundAtoms(): Array<{ value: unknown; group: string | null }> {
  const shared = { code: 1 }
  const symbol = Symbol(`key`)
  return [
    { value: 0, group: `zero` },
    { value: -0, group: `zero` },
    { value: new Date(0), group: `zero` },
    { value: new Date(0).toISOString(), group: `date-string` },
    { value: NaN, group: `nan` },
    { value: new Date(NaN), group: `nan` },
    { value: Infinity, group: `positive-infinity` },
    { value: -Infinity, group: `negative-infinity` },
    { value: 1n, group: `bigint` },
    { value: `1`, group: `string` },
    { value: 1, group: `number` },
    { value: shared, group: `shared-object` },
    { value: shared, group: `shared-object` },
    { value: { code: 1 }, group: `other-object` },
    { value: symbol, group: `shared-symbol` },
    { value: symbol, group: `shared-symbol` },
    { value: Symbol(`key`), group: `other-symbol` },
    { value: new Uint8Array([1, 2]), group: `bytes` },
    { value: new Uint8Array([1, 2]), group: `bytes` },
    { value: Temporal.PlainDate.from(`2024-04-05`), group: `temporal` },
    { value: Temporal.PlainDate.from(`2024-04-05`), group: `temporal` },
    { value: null, group: null },
    { value: undefined, group: null },
  ]
}

// Independent nested loops retain multiplicity and explicitly add unmatched
// rows. Swapping term order or operand direction cannot change this result.
function compoundPairs(
  scenario: Pick<CompoundHistory, `join` | `width`>,
  left: Iterable<CompoundModelRow>,
  right: Iterable<CompoundModelRow>,
  groups: Array<string | null>,
): Array<JoinPair> {
  const pairs: Array<JoinPair> = []
  const rightRows = [...right]
  const matchedRight = new Set<number>()
  for (const l of left) {
    const matches = rightRows.filter(
      (r) =>
        groups[l.atom] !== null &&
        groups[l.atom] === groups[r.atom] &&
        l.b !== null &&
        l.b === r.b &&
        (scenario.width === 2 || l.c === r.c),
    )
    for (const r of matches) {
      pairs.push([l.id, r.id])
      matchedRight.add(r.id)
    }
    if (
      matches.length === 0 &&
      (scenario.join === `left` || scenario.join === `full`)
    )
      pairs.push([l.id, undefined])
  }
  if (scenario.join === `right` || scenario.join === `full`) {
    for (const r of rightRows) {
      if (!matchedRight.has(r.id)) pairs.push([undefined, r.id])
    }
  }
  return sortJoinPairs(pairs)
}

async function runCompoundHistory(
  scenario: CompoundHistory,
  mutant?: `hide-acquisition`,
): Promise<void> {
  const atoms = compoundAtoms()
  const model = {
    left: new Map(scenario.left.map((row) => [row.id, row])),
    right: new Map(scenario.right.map((row) => [row.id, row])),
  }
  let revision = 0
  const toRow = (row: CompoundModelRow): CompoundRow => ({
    id: row.id,
    a: atoms[row.atom]!.value,
    b: row.b,
    c: row.c,
    revision: revision++,
  })
  const actions: Partial<
    Record<
      `left` | `right`,
      Parameters<SyncConfig<CompoundRow, number>[`sync`]>[0]
    >
  > = {}
  let acquisitions = 0
  const installed = { left: new Set<number>(), right: new Set<number>() }
  const makeSource = (side: `left` | `right`) =>
    createCollection<CompoundRow, number>({
      getKey: (row) => row.id,
      autoIndex: scenario.autoIndex,
      defaultIndexType: scenario.autoIndex === `eager` ? BTreeIndex : undefined,
      syncMode: scenario.cold && side === `right` ? `on-demand` : `eager`,
      sync: {
        sync: (sync) => {
          actions[side] = sync
          const publish = () => {
            sync.begin()
            for (const row of model[side].values()) {
              if (installed[side].has(row.id)) continue
              installed[side].add(row.id)
              sync.write({ type: `insert`, value: toRow(row) })
            }
            return sync.commit()
          }
          if (!(scenario.cold && side === `right`)) publish()
          sync.markReady()
          return {
            loadSubset: () => {
              acquisitions++
              return publish()
            },
          }
        },
      },
    })
  const left = makeSource(`left`)
  const right = makeSource(`right`)
  // Construction belongs inside cleanup ownership: the RED implementation
  // rejects the public syntax before a live-query Collection exists.
  let cleanupLive = () => Promise.resolve()
  let subscription: ReturnType<Collection[`subscribeChanges`]> | undefined
  const replica = new Map<string | number, JoinPair>()
  await checkWithCleanup(
    async () => {
      const live = createLiveQueryCollection((q) =>
        q
          .from({ left })
          .join(
            { right },
            ({ left: l, right: r }) => {
              const a = scenario.reversed ? eq(r.a, l.a) : eq(l.a, r.a)
              const b = scenario.reversed ? eq(l.b, r.b) : eq(r.b, l.b)
              const c = eq(l.c, r.c)
              const [first, second] = scenario.atomFirst ? [a, b] : [b, a]
              if (scenario.width === 2) return and(first, second)
              if (scenario.nested) return and(first, and(second, c))
              return and(first, second, c)
            },
            scenario.join,
          )
          .select(({ left: l, right: r }) => ({ leftId: l.id, rightId: r.id })),
      )
      cleanupLive = () => live.cleanup()
      subscription = live.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            if (change.type === `delete`) replica.delete(change.key)
            else
              replica.set(change.key, [
                change.value.leftId,
                change.value.rightId,
              ])
          }
        },
        { includeInitialState: true },
      )
      const check = () => {
        const expected = compoundPairs(
          scenario,
          model.left.values(),
          model.right.values(),
          atoms.map((atom) => atom.group),
        )
        expect(
          sortJoinPairs(live.toArray.map((row) => [row.leftId, row.rightId])),
          `compound public pairs`,
        ).toEqual(expected)
        expect(
          sortJoinPairs([...replica.values()]),
          `compound event replica`,
        ).toEqual(expected)
        expect(live.size).toBe(expected.length)
      }
      await live.preload()
      check()
      if (
        scenario.cold &&
        scenario.left.some(
          (row) => atoms[row.atom]!.group !== null && row.b !== null,
        )
      )
        expect(
          mutant === `hide-acquisition` ? 0 : acquisitions,
          `cold source acquisition`,
        ).toBeGreaterThan(0)
      for (const step of scenario.steps) {
        const { side, row, remove } = step
        const sync = actions[side]!
        if (remove) model[side].delete(row.id)
        else model[side].set(row.id, row)
        sync.begin()
        if (remove) {
          if (installed[side].delete(row.id))
            sync.write({ type: `delete`, value: toRow(row) })
        } else {
          sync.write({
            type: installed[side].has(row.id) ? `update` : `insert`,
            value: toRow(row),
          })
          installed[side].add(row.id)
        }
        await sync.commit()
        check()
      }
    },
    {
      cleanup: async () => {
        subscription?.unsubscribe()
        await cleanupLive()
      },
    },
    left,
    right,
  )
}

// All atom classes occur in the initial matrix. Partial matches differ only
// in the last term; nulls occur in both tuple positions. The pinned scenario
// leaves, restores, deletes and reinserts a match on each side.
const compoundBoundaryRows = compoundAtoms().map((_, atom) => ({
  id: atom,
  atom,
  b: 1,
  c: 1,
}))
const compoundWitness: CompoundHistory = {
  left: [...compoundBoundaryRows, { id: 30, atom: 10, b: null, c: 1 }],
  right: [
    ...compoundBoundaryRows,
    { id: 30, atom: 10, b: null, c: 1 },
    { id: 31, atom: 10, b: 1, c: 2 },
  ],
  steps: [
    { side: `left`, row: { id: 10, atom: 10, b: 2, c: 1 }, remove: false },
    { side: `right`, row: { id: 10, atom: 10, b: 2, c: 1 }, remove: false },
    { side: `left`, row: { id: 10, atom: 10, b: 2, c: 1 }, remove: true },
    { side: `left`, row: { id: 10, atom: 10, b: 2, c: 1 }, remove: false },
    { side: `right`, row: { id: 10, atom: 10, b: 2, c: 1 }, remove: true },
    { side: `right`, row: { id: 10, atom: 10, b: 2, c: 1 }, remove: false },
  ],
  join: `inner`,
  width: 3,
  atomFirst: true,
  nested: true,
  reversed: true,
  autoIndex: `off`,
  cold: false,
}

describe(`compound join relational oracle`, () => {
  // A nullish component makes the whole tuple unsatisfiable, regardless of
  // term order. Such a row may need no acquisition. The nonnull neighbor must
  // acquire even when the empty right source gives the same unmatched output.
  describe(`compound demand premise`, () => {
    for (const autoIndex of [`off`, `eager`] as const) {
      for (const atomFirst of [false, true]) {
        for (const atom of [0, 21]) {
          for (const b of [null, 0]) {
            it(`checks nullish and satisfiable tuples: index=${autoIndex}, atomFirst=${atomFirst}, atom=${atom}, b=${b}`, async () => {
              await runCompoundHistory({
                ...compoundWitness,
                left: [{ id: 0, atom, b, c: 0 }],
                right: [],
                steps: [],
                join: `left`,
                width: 2,
                atomFirst,
                autoIndex,
                cold: true,
              })
            })
          }
        }
      }
    }
  })
  it.each([
    { name: `distinct objects`, leftAtom: 11, rightAtom: 13 },
    { name: `opposite infinities`, leftAtom: 6, rightAtom: 7 },
    { name: `Date and ISO string`, leftAtom: 2, rightAtom: 3 },
    { name: `bigint`, leftAtom: 8, rightAtom: 8 },
  ])(`preserves compound $name equality`, async ({ leftAtom, rightAtom }) => {
    await runCompoundHistory({
      ...compoundWitness,
      atomFirst: false,
      left: [{ id: 1, atom: leftAtom, b: 1, c: 1 }],
      right: [{ id: 2, atom: rightAtom, b: 1, c: 1 }],
      steps: [],
    })
  })
  for (const join of [`inner`, `left`, `right`, `full`] as const) {
    for (const cold of [false, true]) {
      it(`preserves all equality classes through ${join} histories, cold=${cold}`, async () => {
        await runCompoundHistory({ ...compoundWitness, join, cold })
      })
    }
  }
  it.each([`off`, `eager`] as const)(
    `rejects a hidden acquisition for a satisfiable tuple, index=%s`,
    async (autoIndex) => {
      await expect(
        runCompoundHistory(
          {
            ...compoundWitness,
            left: [{ id: 0, atom: 0, b: 0, c: 0 }],
            right: [],
            steps: [],
            join: `left`,
            width: 2,
            atomFirst: false,
            autoIndex,
            cold: true,
          },
          `hide-acquisition`,
        ),
      ).rejects.toThrow(`cold source acquisition`)
    },
  )
  const property = `cold-join.compound`
  const config = readOracleRunConfig()
  const seeds =
    config.replayProperty === property ? [undefined] : [861593, undefined]
  it.each(seeds)(
    `recomputes generated compound histories, seed=%s`,
    async (seed) => {
      const rowArbitrary = fc.record({
        id: fc.integer({ min: 0, max: 3 }),
        atom: fc.integer({ min: 0, max: compoundBoundaryRows.length - 1 }),
        b: fc.constantFrom<number | null>(0, 1, null),
        c: fc.integer({ min: 0, max: 1 }),
      })
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            left: fc.uniqueArray(rowArbitrary, {
              selector: (row) => row.id,
              maxLength: 4,
            }),
            right: fc.uniqueArray(rowArbitrary, {
              selector: (row) => row.id,
              maxLength: 4,
            }),
            steps: fc.array(
              fc.record({
                side: fc.constantFrom<`left` | `right`>(`left`, `right`),
                row: rowArbitrary,
                remove: fc.boolean(),
              }),
              { maxLength: 8 },
            ),
            join: fc.constantFrom<CompoundJoin>(
              `inner`,
              `left`,
              `right`,
              `full`,
            ),
            width: fc.constantFrom<2 | 3>(2, 3),
            atomFirst: fc.boolean(),
            nested: fc.boolean(),
            reversed: fc.boolean(),
            autoIndex: fc.constantFrom<EqualityMode>(`off`, `eager`),
            cold: fc.boolean(),
          }),
          (scenario) => runCompoundHistory(scenario),
        ),
        seed === undefined
          ? oraclePropertyOptions(60, property)
          : { seed, numRuns: oracleRuns(60) },
      )
    },
  )
})

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
