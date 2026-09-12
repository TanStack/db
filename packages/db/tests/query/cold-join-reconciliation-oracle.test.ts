import { expect, it } from 'vitest'
import fc from 'fast-check'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { runTrace } from '../trace-runner.js'
import type { ChangeMessage, SyncConfig } from '../../src/types.js'

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
