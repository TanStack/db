import fc from 'fast-check'
import { Temporal } from 'temporal-polyfill'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { runTrace } from '../trace-runner.js'
import type { Collection } from '../../src/collection/index.js'
import type {
  ChangeMessage,
  LoadSubsetOptions,
  SyncConfig,
} from '../../src/types.js'

type Parent = { id: number; name: string }
type Child = { id: number; parentId: number; amount: number }
type Joined = { id: number; parentId: number; name: string; amount: number }
type Step = { type: `delete`; id: number } | { type: `put`; row: Child }
type Fault = `hide-acquisition` | `drop-delete` | `wrong-result`

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

async function runColdJoin(steps: ReadonlyArray<Step>, fault?: Fault) {
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
                if (fault !== `drop-delete`) replica.delete(change.key)
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
        if (fault === `wrong-result` && rows.length) rows[0]!.amount++
        return {
          rows,
          replica: ordered(replica.values()),
          calls: fault === `hide-acquisition` ? [] : calls,
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
    resources.map((resource) => resource.cleanup()),
  )
  const errors = results.flatMap((result) =>
    result.status === `rejected` ? [result.reason] : [],
  )
  if (errors.length)
    throw new AggregateError(errors, `join oracle cleanup failed`)
}

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

        try {
          await Promise.all([joined.preload(), filtered.preload()])
          const expected = [{ id: 10 }]
          expect(joined.toArray, `${label} join result`).toMatchObject(expected)
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
        } finally {
          await cleanupAll(joined, filtered, predicateRight, right, left)
        }
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

      try {
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
      } finally {
        await cleanupAll(
          binaryJoin,
          fullJoin,
          binaryRight,
          binaryLeft,
          nullishRight,
          nullishLeft,
        )
      }
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
      try {
        await joined.preload()
        expect(pairs()).toEqual([
          [1, 10],
          [2, undefined],
          [undefined, 20],
        ])
        await right.oracleReplace({
          id: 10,
          value: new Uint8Array([1, 2, 3]),
        })
        expect(pairs()).toEqual([
          [1, 10],
          [2, undefined],
          [undefined, 20],
        ])
        await right.oracleReplace({
          id: 10,
          value: new Uint8Array([1, 2, 4]),
        })
        expect(pairs()).toEqual([
          [1, undefined],
          [2, undefined],
          [undefined, 10],
          [undefined, 20],
        ])
        await right.oracleReplace({
          id: 10,
          value: new Uint8Array([1, 2, 3]),
        })
        expect(pairs()).toEqual([
          [1, 10],
          [2, undefined],
          [undefined, 20],
        ])
        await right.oracleReplace({ id: 20, value: 1 })
        expect(pairs()).toEqual([
          [1, 10],
          [2, undefined],
          [undefined, 20],
        ])
        await left.oracleReplace({ id: 2, value: 1 })
        expect(pairs()).toEqual([
          [1, 10],
          [2, 20],
        ])
        await left.oracleReplace({ id: 2, value: null })
        expect(pairs()).toEqual([
          [1, 10],
          [2, undefined],
          [undefined, 20],
        ])
      } finally {
        await cleanupAll(joined, right, left)
      }
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

      try {
        await joined.preload()
        expect(loadCalls).toBe(1)
        expect(candidateChecks).toBe(2)
        expect(requestedValues).toHaveLength(1)
        expect(requestedValues[0]).toBeInstanceOf(Uint8Array)
        expect(Array.from(requestedValues[0] as Uint8Array)).toEqual(
          Array.from(activeKey),
        )
        expect(joined.toArray).toMatchObject([{ leftId: 1, rightId: 10 }])
      } finally {
        await cleanupAll(joined, lazy, active)
      }
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
it(`reconciles cold join acquisition, deletion, restoration and route moves`, async () => {
  const batches = await runColdJoin(history)
  expect(
    batches.flat().filter((change) => change.type === `delete`).length,
  ).toBeGreaterThanOrEqual(2)
})
it.each([941207, undefined])(
  `checks cold join histories, seed=%s`,
  async (seed) => {
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
      { seed, numRuns: 50 },
    )
  },
)
it.each([`hide-acquisition`, `drop-delete`, `wrong-result`] as const)(
  `rejects %s through the real cold join trace checker`,
  async (fault) => {
    await runColdJoin(history)
    await expect(runColdJoin(history, fault)).rejects.toMatchObject({
      name: `TraceAssertionError`,
      cause: { name: `AssertionError` },
    })
  },
)
