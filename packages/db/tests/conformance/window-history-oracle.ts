/**
 * An outer limit/offset change moves the existing window. It does not replace
 * the live-query Collection or recompile its upstream plan (maintainer decision,
 * 2026-10-30, issue #2291). This extends the recompilation law in contract.ts.
 * Query identity still includes the page for cache/hydration lookup.
 *
 * This owner checks adapter-owned ordered list queries without a DbClient.
 * An explicit key still owns invalidation: an unchanged key keeps its query.
 * A changed key can reuse a window only when both plans have stable structured
 * identities and differ solely in the outer window. Opaque callbacks retain
 * their existing keyed recompilation behavior. Nested limits are plan inputs.
 *
 * At each driver's settled framework cut, rows equal a full sort/filter/slice.
 * Same-plan page moves retain the public Collection; plan changes replace it.
 * This model has no graph, subscription, identity hash, or incremental cache.
 * React's abandoned-render cut is checked by its receiving driver separately.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { declareOracle } from '../oracle-declaration'
import { createOracleReach } from '../oracle-reach'
import {
  atOracleCheckpoint,
  createOracleFailureFidelity,
} from '../oracle-failure-fidelity'
import {
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from '../oracle-config'
import { expectOrderedRows, expectUnorderedRows } from './result-laws'
import { ScenarioLifetime } from './scenario-lifetime'
import type {
  ControllableHandle,
  LiveQueryDriver,
  QueryBuild,
} from './contract'

export interface WindowRow {
  id: string
  rank: number
}
export interface WindowInput {
  offset: number
  limit: number
  minimum: number
  descending: boolean
  nestedLimit: number
  source?: number
  projectRank?: boolean
  gcTime?: number
}
export interface WindowHistory {
  rows: Array<WindowRow>
  inputs: Array<WindowInput>
  nested?: boolean
}

// Authored clauses, source objects and Collection options identify the plan.
// Only offset and limit select its outer window; gcTime changes its lifecycle.
export function sameWindowPlan(a: WindowInput, b: WindowInput): boolean {
  return (
    a.minimum === b.minimum &&
    a.descending === b.descending &&
    a.nestedLimit === b.nestedLimit &&
    a.source === b.source &&
    a.projectRank === b.projectRank &&
    (a.gcTime ?? 10) === (b.gcTime ?? 10)
  )
}
export function windowRows(
  rows: ReadonlyArray<WindowRow>,
  input: WindowInput,
  nested = true,
) {
  const sourceRows = [...rows]
    .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
    .slice(0, nested ? input.nestedLimit : undefined)
  const ordered = sourceRows
    .filter((row) => row.rank > input.minimum)
    .sort(
      (a, b) =>
        (input.descending ? b.rank - a.rank : a.rank - b.rank) ||
        a.id.localeCompare(b.id),
    )
  return ordered
    .slice(input.offset, input.offset + input.limit)
    .map((row) => (input.projectRank === false ? { id: row.id } : { ...row }))
}

export function checkWindowObservation(
  actual: { rows: unknown; collection: unknown },
  expected: {
    rows: ReadonlyArray<{ id: string }>
    previousCollection?: unknown
    retain: boolean
  },
  checkpoint = `window observation`,
): void {
  atOracleCheckpoint(`ordered window rows`, checkpoint, () =>
    expectOrderedRows(actual.rows, expected.rows),
  )
  atOracleCheckpoint(`enabled window Collection`, checkpoint, () =>
    expect(actual.collection, `enabled window Collection`).not.toBeNull(),
  )
  if (expected.previousCollection !== undefined) {
    if (expected.retain)
      atOracleCheckpoint(`outer window retains Collection`, checkpoint, () =>
        expect(actual.collection, `outer window retains Collection`).toBe(
          expected.previousCollection,
        ),
      )
    else
      atOracleCheckpoint(`changed plan replaces Collection`, checkpoint, () =>
        expect(actual.collection, `changed plan replaces Collection`).not.toBe(
          expected.previousCollection,
        ),
      )
  }
}

// The keyed public view owes the same rows as data, including while demand is
// held. Keeping only data stale would otherwise hide an early map publication.
export function checkWindowState(
  actual: ReadonlyMap<unknown, unknown> | undefined,
  expected: ReadonlyArray<{ id: string }>,
  checkpoint: string,
): void {
  atOracleCheckpoint(`keyed window rows`, checkpoint, () => {
    expect(actual, `enabled keyed window`).toBeDefined()
    expectUnorderedRows([...actual!.values()], expected)
  })
}

interface WindowSubscriptionObservation {
  owners: ReadonlyArray<unknown>
  previousSubscriberCount: number
  subscriberCount: number
}

// Moving the page keeps the existing upstream subscriptions (contract.ts).
// Owner continuity alone loses overlapping replacement subscriptions because
// Collection.subscribers groups them by owner. Public count transitions keep
// that distinction. Retired Collections may finish GC during a retained move,
// so their decrements remain legal; a page move starts no new subscription.
export function checkWindowSubscriptions(
  observations: ReadonlyArray<WindowSubscriptionObservation>,
  previousCollection: unknown,
  checkpoint = `upstream window ownership`,
): void {
  for (const observation of observations) {
    atOracleCheckpoint(`retained upstream ownership`, checkpoint, () =>
      expect(observation.owners, `retained upstream ownership`).toContain(
        previousCollection,
      ),
    )
    atOracleCheckpoint(`retained upstream subscription count`, checkpoint, () =>
      expect(
        observation.subscriberCount,
        `retained upstream subscription count`,
      ).toBeLessThanOrEqual(observation.previousSubscriberCount),
    )
  }
}

const inputArbitrary = fc.record({
  offset: fc.integer({ min: 0, max: 12 }),
  limit: fc.integer({ min: 0, max: 6 }),
  minimum: fc.integer({ min: -1, max: 8 }),
  descending: fc.boolean(),
  source: fc.integer({ min: 0, max: 1 }),
  projectRank: fc.boolean(),
  nestedLimit: fc.integer({ min: 0, max: 12 }),
  gcTime: fc.integer({ min: 1, max: 100 }),
})
// Compulsory page moves and adjacent plan/option changes make every campaign
// reach the distinctions even at the ordinary budget. The tail permits repeats,
// reversals, zero windows, empty sources, and jumps beyond the final row.
export const windowHistoryArbitrary = fc
  .tuple(
    fc.array(fc.integer({ min: 0, max: 20 }), { maxLength: 12 }),
    inputArbitrary,
    fc.boolean(),
    fc.array(inputArbitrary, { maxLength: 6 }),
  )
  .map(([ranks, first, nested, tail]): WindowHistory => ({
    nested,
    rows: ranks.map((rank, id) => ({ id: String(id).padStart(2, `0`), rank })),
    inputs: [
      first,
      { ...first, offset: first.offset + 1 },
      { ...first, offset: first.offset + 1, limit: first.limit + 1 },
      { ...first, offset: Number.MAX_SAFE_INTEGER, limit: 3 },
      { ...first, offset: 0, limit: Number.MAX_SAFE_INTEGER },
      { ...first, minimum: first.minimum + 1 },
      { ...first, descending: !first.descending },
      { ...first, nestedLimit: first.nestedLimit + 1 },
      { ...first, source: 1 - first.source, offset: first.offset + 1 },
      { ...first, projectRank: !first.projectRank },
      { ...first, offset: first.offset + 1, gcTime: first.gcTime + 1 },
      ...tail.map((input) => ({ ...input, gcTime: first.gcTime + 1 })),
    ],
  }))

export const windowHistoryExamples: Array<[WindowHistory]> = [
  [
    {
      rows: Array.from({ length: 6 }, (_, id) => ({
        id: String(id),
        rank: id,
      })),
      inputs: [
        { offset: 0, limit: 2, minimum: -1, descending: false, nestedLimit: 6 },
        { offset: 2, limit: 2, minimum: -1, descending: false, nestedLimit: 6 },
        { offset: 2, limit: 0, minimum: -1, descending: false, nestedLimit: 6 },
        {
          offset: Number.MAX_SAFE_INTEGER,
          limit: 3,
          minimum: -1,
          descending: false,
          nestedLimit: 6,
        },
        {
          offset: 0,
          limit: Number.MAX_SAFE_INTEGER,
          minimum: -1,
          descending: false,
          nestedLimit: 6,
        },
        { offset: 0, limit: 3, minimum: 0, descending: false, nestedLimit: 6 },
        { offset: 0, limit: 3, minimum: 0, descending: true, nestedLimit: 6 },
        { offset: 0, limit: 3, minimum: 0, descending: true, nestedLimit: 2 },
        {
          offset: 1,
          limit: 3,
          minimum: 0,
          descending: true,
          nestedLimit: 2,
          source: 1,
        },
        {
          offset: 1,
          limit: 3,
          minimum: 0,
          descending: true,
          nestedLimit: 2,
          source: 1,
          projectRank: false,
        },
        {
          offset: 2,
          limit: 3,
          minimum: 0,
          descending: true,
          nestedLimit: 2,
          source: 1,
          projectRank: false,
          gcTime: 100,
        },
      ],
    },
  ],
]
const states = [
  `offset move`,
  `limit move`,
  `large offset move`,
  `large limit move`,
  `filter change`,
  `order change`,
  `nested window change`,
  `source change`,
  `projection change`,
  `Collection option change`,
  `source write`,
  `source growth`,
  `stable key`,
  `opaque key change`,
] as const

export async function runWindowHistory(
  driver: LiveQueryDriver,
  history: WindowHistory,
  keyed: boolean,
  reach: ReturnType<typeof createOracleReach<(typeof states)[number]>>,
  keyPolicy: `changing` | `stable` | `opaque` = `changing`,
) {
  const lifetime = new ScenarioLifetime()
  let handle: ControllableHandle<WindowInput> | undefined
  lifetime.defer(() => handle?.unmount())
  await lifetime.run(async () => {
    const source = driver.makeSource(history.rows)
    lifetime.defer(() => source.collection.cleanup({ dependents: true }))
    const alternateRows = history.rows.map((row) => ({
      id: `b${row.id}`,
      rank: row.rank + 3,
    }))
    const alternate = driver.makeSource(
      alternateRows,
      keyed ? source.collection.id : undefined,
    )
    lifetime.defer(() => alternate.collection.cleanup({ dependents: true }))
    const modelRows = [history.rows.map((row) => ({ ...row })), alternateRows]
    // Only the current live query's ownership is constrained. A previously
    // replaced Collection may finish its GC during this step.
    const subscriptionSnapshots: Array<WindowSubscriptionObservation> = []
    const recordSubscribers = (event: {
      previousSubscriberCount: number
      subscriberCount: number
    }) =>
      subscriptionSnapshots.push({
        owners: [
          ...source.collection.subscribers.map((owner) => owner.collection),
          ...alternate.collection.subscribers.map((owner) => owner.collection),
        ],
        previousSubscriberCount: event.previousSubscriberCount,
        subscriberCount: event.subscriberCount,
      })
    const stop = source.collection.on(`subscribers:change`, recordSubscribers)
    const stopAlternate = alternate.collection.on(
      `subscribers:change`,
      recordSubscribers,
    )
    lifetime.defer(stop)
    lifetime.defer(stopAlternate)
    const build = (q: Parameters<QueryBuild>[0], input: WindowInput) => {
      const from = input.source === 1 ? alternate.collection : source.collection
      const innerSource =
        history.nested === false
          ? from
          : q
              .from({ inner: from })
              .orderBy(({ inner }: { inner: WindowRow }) => inner.rank)
              .orderBy(({ inner }: { inner: WindowRow }) => inner.id)
              .limit(input.nestedLimit)
              .select(({ inner }: { inner: WindowRow }) => ({
                id: inner.id,
                rank: inner.rank,
              }))
      const query = q.from({ row: innerSource })
      const filtered =
        keyPolicy === `opaque`
          ? query.fn.where(
              ({ row }: { row: WindowRow }) => row.rank > input.minimum,
            )
          : query.where(({ row }: { row: WindowRow }) =>
              driver.ops.gt(row.rank, input.minimum),
            )
      const built = filtered
        .orderBy(
          ({ row }: { row: WindowRow }) => row.rank,
          input.descending ? `desc` : `asc`,
        )
        .orderBy(({ row }: { row: WindowRow }) => row.id)
        .limit(input.limit)
        .offset(input.offset)
        .select(({ row }: { row: WindowRow }) =>
          input.projectRank === false
            ? { id: row.id }
            : { id: row.id, rank: row.rank },
        )
      // The bare query callback accepts Collection options. The keyed receiving
      // form wraps this callback in its own config, so it keeps the query shape.
      return keyed ? built : { query: built, gcTime: input.gcTime ?? 10 }
    }
    const first = history.inputs[0]!
    const mounted = keyed
      ? driver.mountKeyedControllable!(
          build,
          (input) =>
            keyPolicy === `stable`
              ? [`window-history`]
              : [`window-history`, { ...input, gcTime: undefined }],
          first,
        )
      : driver.mountControllable(build, first)
    handle = mounted
    await mounted.flush()
    let previous = first
    let previousCollection: unknown
    const failures: Array<unknown> = []
    try {
      for (const [index, requested] of history.inputs.entries()) {
        const authored = keyPolicy === `stable` ? first : requested
        const input = keyed ? { ...authored, gcTime: undefined } : authored
        const beforeSubscriptions = subscriptionSnapshots.length
        if (index > 0) await mounted.setParam(requested)
        // A direct query does not author nestedLimit, so its value cannot require
        // replacement. The same independent plan rule judges both input shapes.
        const samePlan = sameWindowPlan(
          history.nested === false ? { ...previous, nestedLimit: 0 } : previous,
          history.nested === false ? { ...input, nestedLimit: 0 } : input,
        )
        const retain =
          keyPolicy === `stable` ||
          (keyPolicy === `opaque`
            ? JSON.stringify(previous) === JSON.stringify(input)
            : samePlan)
        if (index > 0) {
          if (keyPolicy === `stable`) reach.reach(`stable key`)
          if (keyPolicy === `opaque`) reach.reach(`opaque key change`)
          if (retain) {
            if (previous.offset !== input.offset) reach.reach(`offset move`)
            if (previous.limit !== input.limit) reach.reach(`limit move`)
            if (input.offset === Number.MAX_SAFE_INTEGER)
              reach.reach(`large offset move`)
            if (input.limit === Number.MAX_SAFE_INTEGER)
              reach.reach(`large limit move`)
          }
          if (!keyed && (previous.gcTime ?? 10) !== (input.gcTime ?? 10))
            reach.reach(`Collection option change`)
          if (previous.minimum !== input.minimum) reach.reach(`filter change`)
          if (previous.descending !== input.descending)
            reach.reach(`order change`)
          if (
            history.nested !== false &&
            previous.nestedLimit !== input.nestedLimit
          )
            reach.reach(`nested window change`)
          if (previous.source !== input.source) reach.reach(`source change`)
          if (previous.projectRank !== input.projectRank)
            reach.reach(`projection change`)
        }
        const rows = modelRows[input.source === 1 ? 1 : 0]!
        const compare = () => {
          const expected = windowRows(rows, input, history.nested !== false)
          checkWindowObservation(
            { rows: mounted.current().data, collection: mounted.collection() },
            {
              rows: expected,
              previousCollection,
              retain,
            },
            `input ${index}`,
          )
          if (!keyed)
            atOracleCheckpoint(
              `authored Collection option`,
              `input ${index}`,
              () =>
                expect(
                  mounted.collection()!.config.gcTime,
                  `authored Collection option`,
                ).toBe(input.gcTime ?? 10),
            )
          atOracleCheckpoint(`keyed window rows`, `input ${index}`, () =>
            expectUnorderedRows(
              [...mounted.current().state!.values()],
              expected,
            ),
          )
          if (index > 0 && retain && keyPolicy !== `opaque`)
            checkWindowSubscriptions(
              subscriptionSnapshots.slice(beforeSubscriptions),
              previousCollection,
              `input ${index}`,
            )
        }
        // Keep neighboring checkpoints even when retention fails. This reports
        // baseline row/plan evidence without changing the law or hiding a failure.
        try {
          compare()
        } catch (error) {
          failures.push(error)
        }
        previous = input
        previousCollection = mounted.collection()
        // Bounds describe future rows too. Growing the direct source after a
        // huge move rejects a resolver that stores bounds clamped to row count.
        if (
          input.offset === Number.MAX_SAFE_INTEGER ||
          input.limit === Number.MAX_SAFE_INTEGER
        ) {
          const row = {
            id: `grown-${index}`,
            rank:
              Math.max(input.minimum, ...rows.map((entry) => entry.rank), 0) +
              1,
          }
          rows.push(row)
          await mounted.apply(() =>
            (input.source === 1 ? alternate : source).insert({ ...row }),
          )
          reach.reach(`source growth`)
          try {
            const expected = windowRows(rows, input, history.nested !== false)
            atOracleCheckpoint(
              `ordered window rows`,
              `input ${index}/source growth`,
              () => expectOrderedRows(mounted.current().data, expected),
            )
            atOracleCheckpoint(
              `keyed window rows`,
              `input ${index}/source growth`,
              () =>
                expectUnorderedRows(
                  [...mounted.current().state!.values()],
                  expected,
                ),
            )
          } catch (error) {
            failures.push(error)
          }
        }
        if (rows.length > 0) {
          rows[0] = { ...rows[0]!, rank: rows[0]!.rank + 1 }
          await mounted.apply(() =>
            (input.source === 1 ? alternate : source).update({ ...rows[0]! }),
          )
          reach.reach(`source write`)
          try {
            const expected = windowRows(rows, input, history.nested !== false)
            atOracleCheckpoint(
              `ordered window rows`,
              `input ${index}/source write`,
              () => expectOrderedRows(mounted.current().data, expected),
            )
            atOracleCheckpoint(
              `keyed window rows`,
              `input ${index}/source write`,
              () =>
                expectUnorderedRows(
                  [...mounted.current().state!.values()],
                  expected,
                ),
            )
          } catch (error) {
            failures.push(error)
          }
        }
      }
    } catch (error) {
      failures.push(error)
    }
    if (failures.length)
      throw new AggregateError(
        failures,
        `Window history mismatches: ${failures.map((error) => String(error)).join('; ')}`,
        {
          cause: failures[0],
        },
      )
  })
}

// Each registration runs the same grammar and comparison with a fixed and fresh
// seed. Reach belongs to one driver and input form; one framework cannot supply
// another's missing witness. Replay goes directly to the requested campaign.
export function registerWindowHistoryOracle(driver: LiveQueryDriver) {
  describe(`window history :: ${driver.name}`, () => {
    oracleReplayTest(it)(
      `rejects a pending keyed map that differs from the settled rows`,
      () => {
        const history = windowHistoryExamples[0]![0]
        const input = history.inputs[0]!
        const rows = windowRows(history.rows, input, false)
        const collection = {}
        // data and Collection are valid. The empty map alone is the wrong answer.
        checkWindowObservation(
          { rows, collection },
          { rows, previousCollection: collection, retain: true },
          `held acquisition`,
        )
        expect(() =>
          checkWindowState(new Map(), rows, `held acquisition`),
        ).toThrow(`keyed window rows at held acquisition`)
        checkWindowState(
          new Map(rows.map((row) => [row.id, row])),
          rows,
          `held acquisition`,
        )
      },
    )
    // These controls use the campaign's shared comparison. Owner-only recording
    // accepts 1 -> 2 -> 1 when a replacement subscribes before its predecessor
    // retires. A retired Collection's 2 -> 1 decrement must still be accepted.
    oracleReplayTest(it)(
      `retained subscriptions distinguish overlapping replacement from GC`,
      () => {
        const collection = {}
        const overlappingReplacement = [
          {
            owners: [collection],
            previousSubscriberCount: 1,
            subscriberCount: 2,
          },
          {
            owners: [collection],
            previousSubscriberCount: 2,
            subscriberCount: 1,
          },
        ]
        expect(() =>
          checkWindowSubscriptions(overlappingReplacement, collection),
        ).toThrow(`retained upstream subscription count`)
        checkWindowSubscriptions(
          [
            {
              owners: [collection],
              previousSubscriberCount: 2,
              subscriberCount: 1,
            },
          ],
          collection,
        )
      },
    )
    registerPendingWindowOracle(driver)
    registerPublicationWindowOracle(driver)
    for (const nested of [false, true]) {
      for (const keyed of driver.mountKeyedControllable
        ? [false, true]
        : [false]) {
        for (const keyPolicy of keyed
          ? ([`changing`, `stable`, `opaque`] as const)
          : ([`changing`] as const)) {
          for (const campaign of [`fixed`, `fresh`] as const) {
            const form = `${keyed ? keyPolicy : `derived`}/${nested ? `nested` : `direct`}`
            const property = `framework.window-history`
            const test =
              campaign === `fixed`
                ? oracleReplayTest(it)
                : oracleReplayTest(it, property)
            test(`${form} window histories (${campaign})`, async () => {
              // Registration's replay selector is the same one the ordinary suite uses.
              const reach = createOracleReach(
                `${driver.name}/${form}/${campaign}`,
                states.filter((state) =>
                  keyed && state === `Collection option change`
                    ? false
                    : keyPolicy === `stable`
                      ? state === `stable key` || state === `source write`
                      : keyPolicy === `opaque`
                        ? ![
                            `stable key`,
                            `offset move`,
                            `limit move`,
                            `large offset move`,
                            `large limit move`,
                          ].includes(state) &&
                          (nested || state !== `nested window change`)
                        : ![`stable key`, `opaque key change`].includes(
                            state,
                          ) &&
                          (nested || state !== `nested window change`),
                ),
                {
                  fixedHistories: windowHistoryExamples.length,
                },
              )
              let historyIndex = 0
              const fidelity = createOracleFailureFidelity<WindowHistory>()
              const propertyUnderTest = fc.asyncProperty(
                windowHistoryArbitrary,
                async (history) => {
                  reach.beginHistory({
                    fixed: historyIndex++ < windowHistoryExamples.length,
                  })
                  const exercised = { ...history, nested }
                  await fidelity.run(exercised, () =>
                    runWindowHistory(
                      driver,
                      exercised,
                      keyed,
                      reach,
                      keyPolicy,
                    ),
                  )
                },
              )
              try {
                await fidelity.assert(() =>
                  fc.assert(
                    propertyUnderTest,
                    campaign === `fixed`
                      ? {
                          numRuns:
                            oracleRuns(12) + windowHistoryExamples.length,
                          seed: 2291,
                          examples: windowHistoryExamples,
                        }
                      : oraclePropertyOptions(12, property, {
                          examples: windowHistoryExamples,
                        }),
                  ),
                )
              } finally {
                console.info(
                  `window reach ${driver.name}/${form}/${campaign}`,
                  Object.fromEntries(reach.counts()),
                )
              }
              reach.assertReached()
            }, 30_000)
          }
        }
      }
    }
  })
}

declareOracle({
  model: [sameWindowPlan, windowRows],
  grammar: [windowHistoryArbitrary],
  check: [
    checkWindowObservation,
    checkWindowState,
    checkWindowSubscriptions,
    runWindowHistory,
  ],
})

/**
 * Pending window moves keep the last settled page. A later commit supersedes
 * the requested window; an older acquisition cannot publish its own page. This
 * receiving lane uses each real adapter over an on-demand source that already
 * holds the rows but has not settled its demand. Available rows alone prove no
 * coverage (ARCHITECTURE.md, atomic window publication). Settlement is explicit;
 * no timer stands in for provider completion. The core ordered-window owner
 * separately checks source delivery, failures and repair chains.
 */
const pendingWindowArbitrary = fc.record({
  width: fc.integer({ min: 1, max: 3 }),
  jump: fc.integer({ min: 1, max: 4 }),
})
const pendingExamples = [[{ width: 2, jump: 2 }]]
const pendingStates = [
  `initial loading move`,
  `initial oldest settled while latest pending`,
  `initial ready`,
  `overlap pending`,
  `oldest settled while latest pending`,
  `settled latest`,
  `unmounted pending`,
] as const

async function checkPendingWindowHistory(
  driver: LiveQueryDriver,
  history: { width: number; jump: number },
  reach: ReturnType<typeof createOracleReach<(typeof pendingStates)[number]>>,
) {
  const lifetime = new ScenarioLifetime()
  let unmount: (() => void) | undefined
  lifetime.defer(() => unmount?.())
  await lifetime.run(async () => {
    const source = driver.makeLaggingSource<WindowRow>()
    lifetime.defer(() => source.collection.cleanup({ dependents: true }))
    const rows = Array.from({ length: 30 }, (_, id) => ({
      id: String(id).padStart(2, `0`),
      rank: id,
    }))
    source.emit(rows)
    const build = (q: Parameters<QueryBuild>[0], offset: number) =>
      q
        .from({ row: source.collection })
        .orderBy(({ row }: { row: WindowRow }) => row.rank)
        .limit(history.width)
        .offset(offset)
        .select(({ row }: { row: WindowRow }) => ({
          id: row.id,
          rank: row.rank,
        }))
    const handle = driver.mountControllable<number>(build, 0)
    unmount = () => handle.unmount()
    const expected = (offset: number) =>
      windowRows(
        rows,
        {
          offset,
          limit: history.width,
          minimum: -1,
          descending: false,
          nestedLimit: rows.length,
        },
        false,
      )
    await handle.flush()
    const collection = handle.collection()
    const failures: Array<unknown> = []
    const readiness = (ready: boolean, checkpoint: string) =>
      atOracleCheckpoint(`initial-query readiness`, checkpoint, () =>
        expect(handle.current().isReady).toBe(ready),
      )
    const acquisitionPending = (pending: boolean, checkpoint: string) =>
      atOracleCheckpoint(`acquisition pending premise`, checkpoint, () =>
        expect(source.loadStarted()).toBe(pending),
      )
    // Before initial-query readiness there is no settled public snapshot. The
    // same shared comparison therefore expects no rows; later cuts name the
    // last settled offset and recompute that page independently.
    const compare = (offset: number | undefined, checkpoint: string) => {
      try {
        const expectedRows = offset === undefined ? [] : expected(offset)
        checkWindowObservation(
          { rows: handle.current().data, collection: handle.collection() },
          {
            rows: expectedRows,
            previousCollection: collection,
            retain: true,
          },
          checkpoint,
        )
        checkWindowState(handle.current().state, expectedRows, checkpoint)
      } catch (error) {
        failures.push(error)
      }
    }
    // A page move is legal while the first acquisition is still held. It keeps
    // the initial Collection, and settling the obsolete page alone neither
    // opens readiness nor publishes that page. Every generated history enters
    // this state, separately for each adapter's scheduler.
    let interruption: { error: unknown } | undefined
    try {
      readiness(false, `initial pending`)
      acquisitionPending(true, `initial pending`)
      compare(undefined, `initial pending`)
      await handle.setParam(history.jump)
      readiness(false, `initial loading move`)
      reach.reach(`initial loading move`)
      compare(undefined, `initial loading move`)
      source.settleNext()
      await handle.flush()
      acquisitionPending(true, `initial oldest settled while latest pending`)
      readiness(false, `initial oldest settled while latest pending`)
      reach.reach(`initial oldest settled while latest pending`)
      compare(undefined, `initial oldest settled while latest pending`)
      for (let turn = 0; turn < 20 && source.loadStarted(); turn++) {
        source.settle()
        await handle.flush()
      }
      acquisitionPending(false, `initial ready`)
      readiness(true, `initial ready`)
      reach.reach(`initial ready`)
      compare(history.jump, `initial ready`)

      const firstMove = history.jump + history.width + 1
      const latestMove = firstMove + history.jump + 1
      await handle.setParam(firstMove)
      acquisitionPending(true, `first move pending`)
      compare(history.jump, `first move pending`)
      await handle.setParam(latestMove)
      acquisitionPending(true, `overlap pending`)
      reach.reach(`overlap pending`)
      compare(history.jump, `overlap pending`)
      // One old request settles while its replacement remains held. Its result
      // cannot establish the later requested window on its own.
      source.settleNext()
      await handle.flush()
      acquisitionPending(true, `oldest settled while latest pending`)
      reach.reach(`oldest settled while latest pending`)
      compare(history.jump, `oldest settled while latest pending`)
      for (let turn = 0; turn < 20 && source.loadStarted(); turn++) {
        source.settle()
        await handle.flush()
      }
      acquisitionPending(false, `settled latest`)
      reach.reach(`settled latest`)
      compare(latestMove, `settled latest`)
      await handle.setParam(20)
      acquisitionPending(true, `unmounted pending`)
      reach.reach(`unmounted pending`)
      unmount()
      unmount = undefined
      source.settle()
      await handle.flush()
    } catch (error) {
      interruption = { error }
    }
    // A later action/premise failure cannot erase an earlier comparison. Keep
    // it as a secondary diagnostic; ScenarioLifetime adds cleanup separately.
    const errors = [...failures, ...(interruption ? [interruption.error] : [])]
    if (errors.length)
      throw new AggregateError(
        errors,
        `Pending window mismatches${interruption ? `; history interrupted` : ``}: ${errors.map(String).join(`; `)}`,
        { cause: errors[0] },
      )
  })
}

declareOracle({
  grammar: [pendingWindowArbitrary],
  check: [checkPendingWindowHistory],
})

function registerPendingWindowOracle(driver: LiveQueryDriver) {
  for (const campaign of [`fixed`, `fresh`] as const) {
    const property = `framework.pending-window-history`
    const test =
      campaign === `fixed`
        ? oracleReplayTest(it)
        : oracleReplayTest(it, property)
    test(`pending window histories (${campaign})`, async () => {
      const reach = createOracleReach(
        `${driver.name}/${property}/${campaign}`,
        pendingStates,
        { fixedHistories: pendingExamples.length },
      )
      let index = 0
      const fidelity = createOracleFailureFidelity<{
        width: number
        jump: number
      }>()
      const propertyUnderTest = fc.asyncProperty(
        pendingWindowArbitrary,
        async (history) => {
          reach.beginHistory({ fixed: index++ < pendingExamples.length })
          await fidelity.run(history, () =>
            checkPendingWindowHistory(driver, history, reach),
          )
        },
      )
      try {
        await fidelity.assert(() =>
          fc.assert(
            propertyUnderTest,
            campaign === `fixed`
              ? {
                  numRuns: oracleRuns(6) + pendingExamples.length,
                  seed: 2291,
                  examples: pendingExamples,
                }
              : oraclePropertyOptions(6, property, {
                  examples: pendingExamples,
                }),
          ),
        )
      } finally {
        console.info(
          `pending reach ${driver.name}/${campaign}`,
          Object.fromEntries(reach.counts()),
        )
      }
      reach.assertReached()
    }, 30_000)
  }
}

/**
 * A source publication may cause application code to change the input that a
 * framework binding reads. The declarative limit/offset contract still applies:
 * at the driver's settled host cut, the same Collection shows the new window.
 * The application never calls imperative setWindow, whose reentrancy guard is
 * outside this input language (contract.ts; maintainer decision 2026-10-30).
 *
 * This receiving lane uses all six real framework drivers. A direct Collection
 * change callback changes the binding's parameter while source publication is
 * on the stack. The callback entry is measured; no delayed trigger simulates it.
 * A one-shot guard permits the moved window to publish without another input
 * change. The model is the existing full sort/filter/slice over authored rows.
 * These histories bound the claim to eager sources, direct ordered list queries,
 * and one callback-driven move; core owns imperative reentrancy and repair.
 */
const publicationWindowArbitrary = fc.record({
  width: fc.integer({ min: 1, max: 3 }),
  jump: fc.integer({ min: 1, max: 4 }),
  descending: fc.boolean(),
  move: fc.constantFrom(`offset` as const, `limit` as const, `both` as const),
})
const publicationWindowExamples = [
  [{ width: 1, jump: 1, descending: false, move: `offset` as const }],
  [{ width: 2, jump: 2, descending: true, move: `limit` as const }],
  [{ width: 3, jump: 3, descending: false, move: `both` as const }],
]
const publicationWindowStates = [
  `publication callback entered`,
  `offset requested in callback`,
  `limit requested in callback`,
  `callback update settled`,
] as const

async function checkPublicationWindowHistory(
  driver: LiveQueryDriver,
  history: {
    width: number
    jump: number
    descending: boolean
    move: `offset` | `limit` | `both`
  },
  reach: ReturnType<
    typeof createOracleReach<(typeof publicationWindowStates)[number]>
  >,
) {
  const lifetime = new ScenarioLifetime()
  let handle: ControllableHandle<WindowInput> | undefined
  let unsubscribe: (() => void) | undefined
  lifetime.defer(() => unsubscribe?.())
  lifetime.defer(() => handle?.unmount())
  await lifetime.run(async () => {
    const rows = Array.from({ length: 8 }, (_, index) => ({
      id: String(index).padStart(2, `0`),
      rank: index,
    }))
    const source = driver.makeSource(rows)
    lifetime.defer(() => source.collection.cleanup({ dependents: true }))
    const initial: WindowInput = {
      offset: 0,
      limit: history.width,
      minimum: -10,
      descending: history.descending,
      nestedLimit: rows.length,
    }
    const next: WindowInput = {
      ...initial,
      offset: history.move === `limit` ? 0 : history.jump,
      limit: history.move === `offset` ? history.width : history.width + 1,
    }
    const mounted = driver.mountControllable<WindowInput>(
      (q: Parameters<QueryBuild>[0], input) =>
        q
          .from({ row: source.collection })
          .orderBy(
            ({ row }: { row: WindowRow }) => row.rank,
            input.descending ? `desc` : `asc`,
          )
          .orderBy(({ row }: { row: WindowRow }) => row.id)
          .limit(input.limit)
          .offset(input.offset)
          .select(({ row }: { row: WindowRow }) => ({
            id: row.id,
            rank: row.rank,
          })),
      initial,
    )
    handle = mounted
    await mounted.flush()
    const collection = mounted.collection()
    checkWindowObservation(
      { rows: mounted.current().data, collection },
      { rows: windowRows(rows, initial, false), retain: true },
      `initial window`,
    )
    atOracleCheckpoint(`enabled window Collection`, `initial window`, () =>
      expect(collection, `mounted callback owner`).not.toBeNull(),
    )
    let entered = false
    let update:
      | Promise<{ fulfilled: true } | { fulfilled: false; error: unknown }>
      | undefined
    const subscription = collection!.subscribeChanges(
      () => {
        if (entered) return
        entered = true
        reach.reach(`publication callback entered`)
        if (next.offset !== initial.offset)
          reach.reach(`offset requested in callback`)
        if (next.limit !== initial.limit)
          reach.reach(`limit requested in callback`)
        // Observe rejection immediately. The source may publish before the
        // native scheduler's update promise settles, so an unhandled rejection
        // would otherwise replace the intended callback-update comparison.
        update = mounted.setParam(next).then(
          () => ({ fulfilled: true as const }),
          (error: unknown) => ({ fulfilled: false as const, error }),
        )
      },
      { includeInitialState: false },
    )
    unsubscribe = () => subscription.unsubscribe()
    const inserted = {
      id: `new`,
      rank: history.descending ? 100 : -1,
    }
    rows.push(inserted)
    // setParam supplies the driver's native update scope. Wrapping this source
    // write in apply as well would overlap two async React act scopes; the
    // callback itself must remain on the source publication stack.
    source.insert({ ...inserted })
    atOracleCheckpoint(
      `publication callback premise`,
      `callback entered`,
      () => {
        expect(entered, `source publication invoked the callback`).toBe(true)
        expect(update, `callback submitted the parameter update`).toBeDefined()
      },
    )
    const outcome = await update!
    atOracleCheckpoint(
      `callback update fulfills`,
      `callback update settled`,
      () => {
        if (!outcome.fulfilled)
          throw new Error(
            `Publication callback window update rejected: ${String(outcome.error)}`,
            { cause: outcome.error },
          )
      },
    )
    reach.reach(`callback update settled`)
    await mounted.flush()
    const expected = windowRows(rows, next, false)
    checkWindowObservation(
      { rows: mounted.current().data, collection: mounted.collection() },
      { rows: expected, previousCollection: collection, retain: true },
      `callback update settled`,
    )
    atOracleCheckpoint(`keyed window rows`, `callback update settled`, () =>
      expectUnorderedRows([...mounted.current().state!.values()], expected),
    )
  })
}

function registerPublicationWindowOracle(driver: LiveQueryDriver) {
  for (const campaign of [`fixed`, `fresh`] as const) {
    const property = `framework.publication-window-history`
    const test =
      campaign === `fixed`
        ? oracleReplayTest(it)
        : oracleReplayTest(it, property)
    test(`publication callback window histories (${campaign})`, async () => {
      const reach = createOracleReach(
        `${driver.name}/${property}/${campaign}`,
        publicationWindowStates,
        { fixedHistories: publicationWindowExamples.length },
      )
      let index = 0
      const fidelity = createOracleFailureFidelity<{
        width: number
        jump: number
        descending: boolean
        move: `offset` | `limit` | `both`
      }>()
      const propertyUnderTest = fc.asyncProperty(
        publicationWindowArbitrary,
        async (history) => {
          reach.beginHistory({
            fixed: index++ < publicationWindowExamples.length,
          })
          await fidelity.run(history, () =>
            checkPublicationWindowHistory(driver, history, reach),
          )
        },
      )
      try {
        await fidelity.assert(() =>
          fc.assert(
            propertyUnderTest,
            campaign === `fixed`
              ? {
                  numRuns: oracleRuns(6) + publicationWindowExamples.length,
                  seed: 2291,
                  examples: publicationWindowExamples,
                }
              : oraclePropertyOptions(6, property, {
                  examples: publicationWindowExamples,
                }),
          ),
        )
      } finally {
        console.info(
          `publication callback reach ${driver.name}/${campaign}`,
          Object.fromEntries(reach.counts()),
        )
      }
      reach.assertReached()
    }, 30_000)
  }
}

declareOracle({
  grammar: [publicationWindowArbitrary],
  check: [checkPublicationWindowHistory],
})
