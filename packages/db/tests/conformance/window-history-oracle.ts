/**
 * An outer limit/offset change moves the existing window. It does not replace
 * the live-query Collection or recompile its upstream plan (maintainer decision,
 * 2026-10-30, issue #2291). This extends the recompilation law in contract.ts.
 * Query identity still includes the page for cache/hydration lookup.
 *
 * This owner checks adapter-owned ordered list queries across framework drivers,
 * including DbClient and Suspense modes (maintainer decision, 2026-11-03).
 * The React and Svelte client receivers check JSON page seeds before local readiness,
 * handoff to local rows and independent peers. React also checks client switches.
 * Independent Suspense bindings own their Collections; neither may move a peer.
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
import { atOracleCheckpoint } from '../oracle-failure-fidelity'
import {
  oracleProperty,
  oracleReplayTest,
  oracleRoute,
  oracleRuns,
} from '../oracle-config'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../oracle-assertion-adapter'
import { expectOrderedRows, expectUnorderedRows } from './result-laws'
import { ScenarioLifetime } from './scenario-lifetime'
import { expectDisabledResult } from './disabled-laws'
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
  actual: {
    rows: unknown
    collection: unknown
  },
  expected: {
    rows: ReadonlyArray<{
      id: string
    }>
    previousCollection?: unknown
    retain: boolean
  },
  checkpoint = `window observation`,
): void {
  atOracleCheckpoint(`ordered window rows`, checkpoint, () =>
    oracleAssertion('expectOrderedRows', () =>
      expectOrderedRows(actual.rows, expected.rows),
    ),
  )
  atOracleCheckpoint(`enabled window Collection`, checkpoint, () =>
    oracleAssertion(
      'expect(actual.collection, `enabled window Collection`).not.toBeNull()',
      () =>
        expect(actual.collection, `enabled window Collection`).not.toBeNull(),
    ),
  )
  if (expected.previousCollection !== undefined) {
    if (expected.retain)
      atOracleCheckpoint(`outer window retains Collection`, checkpoint, () =>
        oracleAssertion('expect(', () =>
          expect(
            actual.collection === expected.previousCollection,
            `outer window retains Collection`,
          ).toBe(true),
        ),
      )
    else
      atOracleCheckpoint(`changed plan replaces Collection`, checkpoint, () =>
        oracleAssertion('expect(', () =>
          expect(
            actual.collection === expected.previousCollection,
            `changed plan replaces Collection`,
          ).toBe(false),
        ),
      )
  }
}
// The keyed public view owes the same rows as data, including while demand is
// held. Keeping only data stale would otherwise hide an early map publication.
export function checkWindowState(
  actual: ReadonlyMap<unknown, unknown> | undefined,
  expected: ReadonlyArray<{
    id: string
  }>,
  checkpoint: string,
): void {
  atOracleCheckpoint(`keyed window rows`, checkpoint, () => {
    oracleAssertion(
      'expect(actual, `enabled keyed window`).toBeDefined()',
      () => expect(actual, `enabled keyed window`).toBeDefined(),
    )
    oracleAssertion('expectUnorderedRows', () =>
      expectUnorderedRows([...actual!.values()], expected),
    )
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
      oracleAssertion(
        'expect(observation.owners, `retained upstream ownership`).toContain(',
        () =>
          expect(observation.owners, `retained upstream ownership`).toContain(
            previousCollection,
          ),
      ),
    )
    atOracleCheckpoint(`retained upstream subscription count`, checkpoint, () =>
      oracleAssertion('expect(', () =>
        expect(
          observation.subscriberCount,
          `retained upstream subscription count`,
        ).toBeLessThanOrEqual(observation.previousSubscriberCount),
      ),
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
  .map(
    ([ranks, first, nested, tail]): WindowHistory => ({
      nested,
      rows: ranks.map((rank, id) => ({
        id: String(id).padStart(2, `0`),
        rank,
      })),
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
    }),
    (value) => {
      // Reconstruct the generated template without changing its forward map.
      // The differently authored fixed examples use the same driver separately.
      const history = value as WindowHistory
      if (
        history.inputs.length < 11 ||
        history.rows.some((row, id) => row.id !== String(id).padStart(2, `0`))
      )
        throw new Error(`History is outside the generated window template`)
      type Input =
        typeof inputArbitrary extends fc.Arbitrary<infer T> ? T : never
      return [
        history.rows.map((row) => row.rank),
        history.inputs[0] as Input,
        history.nested ?? true,
        // Forward mapping overwrites this otherwise independent tail field.
        history.inputs
          .slice(11)
          .map((input) => ({ ...input, gcTime: 1 }) as Input),
      ] as [Array<number>, Input, boolean, Array<Input>]
    },
  )
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
  reach: {
    reach: (state: (typeof states)[number]) => void
  },
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
          oracleAssertion('checkWindowObservation', () =>
            checkWindowObservation(
              {
                rows: mounted.current().data,
                collection: mounted.collection(),
              },
              {
                rows: expected,
                previousCollection,
                retain,
              },
              `input ${index}`,
            ),
          )
          if (!keyed)
            atOracleCheckpoint(
              `authored Collection option`,
              `input ${index}`,
              () =>
                oracleAssertion('expect(', () =>
                  expect(
                    mounted.collection()!.config.gcTime,
                    `authored Collection option`,
                  ).toBe(input.gcTime ?? 10),
                ),
            )
          atOracleCheckpoint(`keyed window rows`, `input ${index}`, () =>
            oracleAssertion('expectUnorderedRows', () =>
              expectUnorderedRows(
                [...mounted.current().state!.values()],
                expected,
              ),
            ),
          )
          if (index > 0 && retain && keyPolicy !== `opaque`)
            oracleAssertion('checkWindowSubscriptions', () =>
              checkWindowSubscriptions(
                subscriptionSnapshots.slice(beforeSubscriptions),
                previousCollection,
                `input ${index}`,
              ),
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
              () =>
                oracleAssertion('expectOrderedRows', () =>
                  expectOrderedRows(mounted.current().data, expected),
                ),
            )
            atOracleCheckpoint(
              `keyed window rows`,
              `input ${index}/source growth`,
              () =>
                oracleAssertion('expectUnorderedRows', () =>
                  expectUnorderedRows(
                    [...mounted.current().state!.values()],
                    expected,
                  ),
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
              () =>
                oracleAssertion('expectOrderedRows', () =>
                  expectOrderedRows(mounted.current().data, expected),
                ),
            )
            atOracleCheckpoint(
              `keyed window rows`,
              `input ${index}/source write`,
              () =>
                oracleAssertion('expectUnorderedRows', () =>
                  expectUnorderedRows(
                    [...mounted.current().state!.values()],
                    expected,
                  ),
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
// Replay identity includes the production driver. Equal seeds and paths in a
// different framework cannot reproduce a scheduler-specific counterexample.
function windowHistoryProperty(
  driver: LiveQueryDriver,
  family: string,
): string {
  const id = driver.name.replace(/\W+/g, `-`).replace(/-$/, ``)
  return `framework.${id}.${family}`
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
        oracleAssertion('checkWindowObservation', () =>
          checkWindowObservation(
            { rows, collection },
            { rows, previousCollection: collection, retain: true },
            `held acquisition`,
          ),
        )
        oracleAssertion('expect(() =>', () =>
          expect(() =>
            oracleAssertion('checkWindowState', () =>
              checkWindowState(new Map(), rows, `held acquisition`),
            ),
          ).toThrow(`keyed window rows at held acquisition`),
        )
        oracleAssertion('checkWindowState', () =>
          checkWindowState(
            new Map(rows.map((row) => [row.id, row])),
            rows,
            `held acquisition`,
          ),
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
        oracleAssertion('expect(() =>', () =>
          expect(() =>
            oracleAssertion('checkWindowSubscriptions', () =>
              checkWindowSubscriptions(overlappingReplacement, collection),
            ),
          ).toThrow(`retained upstream subscription count`),
        )
        oracleAssertion('checkWindowSubscriptions', () =>
          checkWindowSubscriptions(
            [
              {
                owners: [collection],
                previousSubscriberCount: 2,
                subscriberCount: 1,
              },
            ],
            collection,
          ),
        )
      },
    )
    registerPeerWindowOracle(driver)
    if (driver.mountKeyedControllable) registerImmutableKeyOracle(driver)
    // Disabled input is legal only for ordinary bindings that accept keys.
    for (const receiver of driver.mountKeyedControllable &&
    !driver.features?.suspendsUntilReady
      ? [driver]
      : [])
      registerKeyedAdmissionOracle(receiver)
    registerPendingWindowOracle(driver)
    registerPublicationWindowOracle(driver)
    for (const nested of [false, true])
      for (const keyed of driver.mountKeyedControllable
        ? [false, true]
        : [false])
        for (const keyPolicy of keyed
          ? ([`changing`, `stable`, `opaque`] as const)
          : ([`changing`] as const)) {
          const form = `${keyed ? keyPolicy : `derived`}/${nested ? `nested` : `direct`}`
          const requiredStates = states.filter((state) =>
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
                  : ![`stable key`, `opaque key change`].includes(state) &&
                    (nested || state !== `nested window change`),
          )
          describe(`${form} window histories`, () => {
            // Preserve both original example executions without pretending the
            // authored input list is the generator's compulsory-move template.
            for (const campaign of [`fixed`, `fresh`] as const)
              for (const [index, [history]] of windowHistoryExamples.entries())
                oracleReplayTest(it)(
                  `fixed input ${index}/${campaign}`,
                  async () => {
                    oracleRoute(`fixed history`)
                    const observed = new Set<(typeof states)[number]>()
                    await runWindowHistory(
                      driver,
                      { ...history, nested },
                      keyed,
                      { reach: (state) => observed.add(state) },
                      keyPolicy,
                    )
                    oracleAssertion(
                      'expect(requiredStates.filter((state) => !observed.has(state))).toEqual([])',
                      () =>
                        expect(
                          requiredStates.filter(
                            (state) => !observed.has(state),
                          ),
                        ).toEqual([]),
                    )
                  },
                  oracleRuns(30000),
                )
            oracleProperty({
              id: windowHistoryProperty(driver, `window-history`),
              law: {
                statement: `An adapter-owned outer page move retains its Collection; a changed plan replaces it, and source writes keep the current page live.`,
                authority: `conformance/contract.ts query identity and committed-window laws; maintainer window decision 2026-10-30 and independent-output decision 2026-11-03.`,
                owner: `packages/db/tests/conformance/window-history-oracle.ts`,
                limits: `The unchanged driver-specific direct/nested and derived/changing/stable/opaque-key receiving paths, finite rows and authored move/plan/source-write grammar.`,
              },
              histories: {
                arbitrary: windowHistoryArbitrary,
                runs: 12,
                fixedSeeds: [2291],
                states: requiredStates,
                constructed: [
                  {
                    name: `complete page and plan history`,
                    enters: requiredStates,
                    build: (history) => ({
                      ...history,
                      rows: history.rows.length
                        ? history.rows
                        : [{ id: `00`, rank: 0 }],
                    }),
                  },
                ],
              },
              resolve: (history) => ({ history: { ...history, nested } }),
              model: recordedAssertionJudgment,
              driver: (plan, observe) =>
                recordAssertionJudgment(
                  `adapter-owned page window`,
                  plan,
                  observe,
                  () =>
                    runWindowHistory(
                      driver,
                      plan.history,
                      keyed,
                      { reach: (state) => observe(`reach`, state) },
                      keyPolicy,
                    ),
                ),
              check: forwardAssertionJudgment,
              timeout: oracleRuns(30000),
            })
          })
        }
  })
}
// Owns no production entry in packages/db: this module checks the public
// observations that each framework driver passes it, so the framework packages
// that run it own the entries it judges.
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
 * receiving path uses each real adapter over an on-demand source that already
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
  history: {
    width: number
    jump: number
  },
  reach: {
    reach: (state: (typeof pendingStates)[number]) => void
  },
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
    let collection = handle.collection()
    const failures: Array<unknown> = []
    // Suspense publishes a fallback before its first successful return. It has
    // no public Collection then; after readiness the same retention law applies.
    const suspends = driver.features?.suspendsUntilReady === true
    const readiness = (ready: boolean, checkpoint: string) =>
      atOracleCheckpoint(`initial-query readiness`, checkpoint, () =>
        suspends
          ? oracleAssertion(
              'expect(handle.isSuspended!(), `public Suspense fallback`).toBe(',
              () =>
                expect(handle.isSuspended!(), `public Suspense fallback`).toBe(
                  !ready,
                ),
            )
          : oracleAssertion(
              'expect(handle.current().isReady).toBe(ready)',
              () => expect(handle.current().isReady).toBe(ready),
            ),
      )
    const acquisitionPending = (pending: boolean, checkpoint: string) =>
      atOracleCheckpoint(`acquisition pending premise`, checkpoint, () =>
        oracleAssertion('expect(source.loadStarted()).toBe(pending)', () =>
          expect(source.loadStarted()).toBe(pending),
        ),
      )
    // Before initial-query readiness there is no settled public snapshot. The
    // same shared comparison therefore expects no rows; later cuts name the
    // last settled offset and recompute that page independently.
    const compare = (offset: number | undefined, checkpoint: string) => {
      try {
        if (suspends && offset === undefined) {
          oracleAssertion(
            'expect(handle.isSuspended!(), `initial fallback is visible`).toBe(',
            () =>
              expect(handle.isSuspended!(), `initial fallback is visible`).toBe(
                true,
              ),
          )
          oracleAssertion('expect(', () =>
            expect(
              handle.collection(),
              `no successful hook result yet`,
            ).toBeNull(),
          )
          return
        }
        // The previous complete page remains public during a later move. A
        // stale renderHook result behind a fallback is not that observation.
        if (suspends)
          oracleAssertion(
            'expect(handle.isSuspended!(), `settled page stays visible`).toBe(',
            () =>
              expect(handle.isSuspended!(), `settled page stays visible`).toBe(
                false,
              ),
          )
        const expectedRows = offset === undefined ? [] : expected(offset)
        oracleAssertion('checkWindowObservation', () =>
          checkWindowObservation(
            { rows: handle.current().data, collection: handle.collection() },
            {
              rows: expectedRows,
              previousCollection: collection,
              retain: true,
            },
            checkpoint,
          ),
        )
        oracleAssertion('checkWindowState', () =>
          checkWindowState(handle.current().state, expectedRows, checkpoint),
        )
      } catch (error) {
        failures.push(error)
      }
    }
    // A page move is legal while the first acquisition is still held. It keeps
    // the initial Collection, and settling the obsolete page alone neither
    // opens readiness nor publishes that page. Every generated history enters
    // this state, separately for each adapter's scheduler.
    let interruption:
      | {
          error: unknown
        }
      | undefined
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
      if (suspends) collection = handle.collection()
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
// Owns no production entry in packages/db: this module checks the public
// observations that each framework driver passes it, so the framework packages
// that run it own the entries it judges.
declareOracle({
  grammar: [pendingWindowArbitrary],
  check: [checkPendingWindowHistory],
})
function registerPendingWindowOracle(driver: LiveQueryDriver) {
  oracleProperty({
    id: windowHistoryProperty(driver, `pending-window-history`),
    law: {
      statement: `A pending window keeps its last settled page and only the latest requested window may publish after held acquisitions settle.`,
      authority: `conformance/contract.ts pending-window law and live-query ARCHITECTURE.md atomic publication law.`,
      owner: `packages/db/tests/conformance/window-history-oracle.ts`,
      limits: `The unchanged native framework driver over controlled on-demand rows with explicit oldest/latest settlement and pending unmount.`,
    },
    histories: {
      arbitrary: pendingWindowArbitrary,
      runs: 6,
      fixedSeeds: [2291],
      states: pendingStates,
      fixed: pendingExamples.map(([history], index) => ({
        name: `pending page ${index}`,
        history: history!,
      })),
      constructed: [
        {
          name: `complete held window history`,
          enters: pendingStates,
          build: (history) => ({ ...history }),
        },
      ],
    },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`pending adapter window`, plan, observe, () =>
        checkPendingWindowHistory(driver, plan.history, {
          reach: (state) => observe(`reach`, state),
        }),
      ),
    check: forwardAssertionJudgment,
    timeout: oracleRuns(30000),
  })
}
/**
 * A source publication may cause application code to change the input that a
 * framework binding reads. The declarative limit/offset contract still applies:
 * at the driver's settled host cut, the same Collection shows the new window.
 * The application never calls imperative setWindow, whose reentrancy guard is
 * outside this input language (contract.ts; maintainer decision 2026-10-30).
 *
 * This receiving path uses all six real framework drivers. A direct Collection
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
  reach: {
    reach: (state: (typeof publicationWindowStates)[number]) => void
  },
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
    oracleAssertion('checkWindowObservation', () =>
      checkWindowObservation(
        { rows: mounted.current().data, collection },
        { rows: windowRows(rows, initial, false), retain: true },
        `initial window`,
      ),
    )
    atOracleCheckpoint(`enabled window Collection`, `initial window`, () =>
      oracleAssertion(
        'expect(collection, `mounted callback owner`).not.toBeNull()',
        () => expect(collection, `mounted callback owner`).not.toBeNull(),
      ),
    )
    let entered = false
    let update:
      | Promise<
          | {
              fulfilled: true
            }
          | {
              fulfilled: false
              error: unknown
            }
        >
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
        oracleAssertion(
          'expect(entered, `source publication invoked the callback`).toBe(true)',
          () =>
            expect(entered, `source publication invoked the callback`).toBe(
              true,
            ),
        )
        oracleAssertion(
          'expect(update, `callback submitted the parameter update`).toBeDefined()',
          () =>
            expect(
              update,
              `callback submitted the parameter update`,
            ).toBeDefined(),
        )
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
    oracleAssertion('checkWindowObservation', () =>
      checkWindowObservation(
        { rows: mounted.current().data, collection: mounted.collection() },
        { rows: expected, previousCollection: collection, retain: true },
        `callback update settled`,
      ),
    )
    atOracleCheckpoint(`keyed window rows`, `callback update settled`, () =>
      oracleAssertion('expectUnorderedRows', () =>
        expectUnorderedRows([...mounted.current().state!.values()], expected),
      ),
    )
  })
}
function registerPublicationWindowOracle(driver: LiveQueryDriver) {
  oracleProperty({
    id: windowHistoryProperty(driver, `publication-window-history`),
    law: {
      statement: `A declarative page move requested from a source-publication callback settles on the retained Collection with the new ordered page.`,
      authority: `conformance/contract.ts committed declarative window law and maintainer decision 2026-10-30.`,
      owner: `packages/db/tests/conformance/window-history-oracle.ts`,
      limits: `The unchanged eager direct-query native driver, one callback-driven offset/limit/both move and independent full sort/filter/slice judgment.`,
    },
    histories: {
      arbitrary: publicationWindowArbitrary,
      runs: 6,
      fixedSeeds: [2291],
      states: publicationWindowStates,
      fixed: publicationWindowExamples.map(([history], index) => ({
        name: `publication page ${index}`,
        history: history!,
      })),
      constructed: [
        {
          name: `offset and limit from publication callback`,
          enters: publicationWindowStates,
          build: (history) => ({ ...history, move: `both` as const }),
        },
      ],
    },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(
        `publication callback window`,
        plan,
        observe,
        () =>
          checkPublicationWindowHistory(driver, plan.history, {
            reach: (state) => observe(`reach`, state),
          }),
      ),
    check: forwardAssertionJudgment,
    timeout: oracleRuns(30000),
  })
}
// Owns no production entry in packages/db: this module checks the public
// observations that each framework driver passes it, so the framework packages
// that run it own the entries it judges.
declareOracle({
  grammar: [publicationWindowArbitrary],
  check: [checkPublicationWindowHistory],
})
/** Independent bindings may read the same source, but their mutable pages are
 * local. The shared sort/slice model judges both outputs after declarative and
 * imperative moves, source writes, and retirement of the other binding. A
 * supplied Collection is not generated: sharing one is explicit caller intent.
 */
async function checkPeerWindowHistory(
  driver: LiveQueryDriver,
  history: {
    width: number
    jump: number
  },
  reach: {
    reach: (state: string) => void
  },
) {
  const lifetime = new ScenarioLifetime()
  let first: ControllableHandle<number> | undefined
  let peer: ControllableHandle<number> | undefined
  lifetime.defer(() => first?.unmount())
  lifetime.defer(() => peer?.unmount())
  await lifetime.run(async () => {
    const rows = Array.from({ length: 12 }, (_, rank) => ({
      id: String(rank),
      rank,
    }))
    const source = driver.makeSource(rows)
    lifetime.defer(() => source.collection.cleanup({ dependents: true }))
    const build = (q: Parameters<QueryBuild>[0], offset: number) =>
      q
        .from({ row: source.collection })
        .orderBy(({ row }: { row: WindowRow }) => row.rank)
        .limit(history.width)
        .offset(offset)
        .select(({ row }: { row: WindowRow }) => ({ ...row }))
    const mount = () =>
      driver.mountKeyedControllable
        ? driver.mountKeyedControllable<number>(
            build,
            (offset) => [`peer-window`, offset],
            0,
          )
        : driver.mountControllable<number>(build, 0)
    first = mount()
    peer = mount()
    await first.flush()
    await peer.flush()
    const firstCollection = first.collection()
    const peerCollection = peer.collection()
    const compare = (
      handle: ControllableHandle<number>,
      offset: number,
      checkpoint: string,
      previousCollection: unknown,
    ) => {
      const expected = windowRows(
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
      oracleAssertion('checkWindowObservation', () =>
        checkWindowObservation(
          { rows: handle.current().data, collection: handle.collection() },
          { rows: expected, previousCollection, retain: true },
          checkpoint,
        ),
      )
      oracleAssertion('checkWindowState', () =>
        checkWindowState(handle.current().state, expected, checkpoint),
      )
    }
    oracleAssertion('checkWindowObservation', () =>
      checkWindowObservation(
        { rows: peer!.current().data, collection: peerCollection },
        {
          rows: windowRows(
            rows,
            {
              offset: 0,
              limit: history.width,
              minimum: -1,
              descending: false,
              nestedLimit: rows.length,
            },
            false,
          ),
          previousCollection: firstCollection,
          retain: false,
        },
        `independent equal-query outputs`,
      ),
    )
    reach.reach(`independent outputs`)
    await first.setParam(history.jump)
    compare(first, history.jump, `first hook page`, firstCollection)
    compare(peer, 0, `peer after declarative move`, peerCollection)
    reach.reach(`declarative isolation`)
    // A public imperative move must obey the same ownership law. It does not
    // change the authored input, so the first hook later returns declaratively.
    await first.apply(() => {
      void firstCollection!.utils.setWindow({
        offset: history.jump + 1,
        limit: history.width,
      })
    })
    compare(first, history.jump + 1, `imperative page`, firstCollection)
    compare(peer, 0, `peer after imperative move`, peerCollection)
    reach.reach(`imperative isolation`)
    const changed = { ...rows[0]!, rank: 20 }
    rows[0] = changed
    await peer.apply(() => source.update({ ...changed }))
    compare(peer, 0, `peer source update`, peerCollection)
    compare(first, history.jump + 1, `first source update`, firstCollection)
    reach.reach(`source write isolation`)
    first.unmount()
    first = undefined
    await peer.setParam(history.jump)
    compare(peer, history.jump, `peer after other unmount`, peerCollection)
    reach.reach(`peer survives retirement`)
  })
}
function registerPeerWindowOracle(driver: LiveQueryDriver) {
  const peerStates = [
    `independent outputs`,
    `declarative isolation`,
    `imperative isolation`,
    `source write isolation`,
    `peer survives retirement`,
  ] as const
  oracleProperty({
    id: windowHistoryProperty(driver, `peer-window-history`),
    law: {
      statement: `Equal independent inputs own distinct Collections; declarative and imperative moves retain their own page and an independent peer survives retirement.`,
      authority: `conformance/contract.ts independent output and retained window laws; maintainer independent Suspense-output decision 2026-11-03.`,
      owner: `packages/db/tests/conformance/window-history-oracle.ts`,
      limits: `The unchanged native driver receiving two finite ordered pages, both move APIs, a source write and one reader's unmount.`,
    },
    histories: {
      arbitrary: pendingWindowArbitrary,
      runs: 6,
      fixedSeeds: [2345],
      states: peerStates,
      fixed: pendingExamples.map(([history], index) => ({
        name: `peer page ${index}`,
        history: history!,
      })),
      constructed: [
        {
          name: `complete independent peer history`,
          enters: peerStates,
          build: (history) => ({ ...history }),
        },
      ],
    },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`independent peer page`, plan, observe, () =>
        checkPeerWindowHistory(driver, plan.history, {
          reach: (state) => observe(`reach`, state),
        }),
      ),
    check: forwardAssertionJudgment,
  })
}
declareOracle({
  grammar: [pendingWindowArbitrary],
  check: [checkPeerWindowHistory],
})
// A disabled input admits no authored plan. The enablement contract therefore
// precedes stable-key retention: first admit the enabled plan, then keep it
// until its key changes. These histories cross the two formerly separate lanes.
const keyedAdmissionArbitrary = fc.record({
  count: fc.integer({ min: 2, max: 10 }),
  offset: fc.integer({ min: 0, max: 1 }),
})
async function checkKeyedAdmission(
  driver: LiveQueryDriver,
  history: {
    count: number
    offset: number
  },
  reach: {
    reach: (state: string) => void
  },
) {
  const lifetime = new ScenarioLifetime()
  let mounted:
    | ControllableHandle<{
        enabled: boolean
        minimum: number
        key: number
      }>
    | undefined
  lifetime.defer(() => mounted?.unmount())
  await lifetime.run(async () => {
    const rows = Array.from({ length: history.count }, (_, rank) => ({
      id: String(rank),
      rank,
    }))
    const source = driver.makeSource(rows)
    lifetime.defer(() => source.collection.cleanup({ dependents: true }))
    const page = {
      offset: history.offset,
      limit: history.count,
      minimum: -1,
      descending: false,
      nestedLimit: history.count,
    }
    const first = { enabled: false, minimum: -1, key: 0 }
    mounted = driver.mountKeyedControllable!(
      (q, input: typeof first) =>
        input.enabled
          ? q
              .from({ row: source.collection })
              .where(({ row }: { row: WindowRow }) =>
                driver.ops.gt(row.rank, input.minimum),
              )
              .orderBy(({ row }: { row: WindowRow }) => row.rank)
              .limit(page.limit)
              .offset(page.offset)
              .select(({ row }: { row: WindowRow }) => ({
                id: row.id,
                rank: row.rank,
              }))
          : null,
      (input) => [`admission`, input.key],
      first,
    )
    await mounted.flush()
    oracleAssertion('expectDisabledResult', () =>
      expectDisabledResult(mounted!.current(), driver.disabledRepresentation),
    )
    oracleAssertion('expect(', () =>
      expect(
        mounted!.collection(),
        `disabled input has no authored Collection`,
      ).toBeNull(),
    )
    reach.reach(`initial disabled`)
    await mounted.setParam({ ...first, enabled: true })
    oracleAssertion('checkWindowObservation', () =>
      checkWindowObservation(
        { rows: mounted!.current().data, collection: mounted!.collection() },
        { rows: windowRows(rows, page, false), retain: true },
        `stable key first admits enabled plan`,
      ),
    )
    reach.reach(`enabled under same key`)
    const collection = mounted.collection()
    await mounted.setParam({ enabled: true, minimum: history.count, key: 0 })
    oracleAssertion('checkWindowObservation', () =>
      checkWindowObservation(
        { rows: mounted!.current().data, collection: mounted!.collection() },
        {
          rows: windowRows(rows, page, false),
          previousCollection: collection,
          retain: true,
        },
        `stable key retains admitted plan`,
      ),
    )
    reach.reach(`stable admitted plan`)
    await mounted.setParam({ enabled: true, minimum: history.count, key: 1 })
    oracleAssertion('checkWindowObservation', () =>
      checkWindowObservation(
        { rows: mounted!.current().data, collection: mounted!.collection() },
        {
          rows: windowRows(rows, { ...page, minimum: history.count }, false),
          previousCollection: collection,
          retain: false,
        },
        `changed key admits changed plan`,
      ),
    )
    reach.reach(`changed key`)
  })
}
function registerKeyedAdmissionOracle(driver: LiveQueryDriver) {
  // Disabled inputs remain limited to the original ordinary keyed receivers.
  const admissionStates = [
    `initial disabled`,
    `enabled under same key`,
    `stable admitted plan`,
    `changed key`,
  ] as const
  oracleProperty({
    id: windowHistoryProperty(driver, `keyed-admission`),
    law: {
      statement: `A disabled input admits no plan; enabling it admits the current plan even under the same key, and later equal or changed keys govern invalidation.`,
      authority: `conformance/contract.ts initial disabled keyed-admission law.`,
      owner: `packages/db/tests/conformance/window-history-oracle.ts`,
      limits: `The unchanged ordinary keyed native drivers and finite disabled/enable/stable/changed-key schedule; no Suspense disabled overload.`,
    },
    histories: {
      arbitrary: keyedAdmissionArbitrary,
      runs: 6,
      fixedSeeds: [2345],
      states: admissionStates,
      constructed: [
        {
          name: `complete disabled keyed admission`,
          enters: admissionStates,
          build: (history) => ({ ...history }),
        },
      ],
    },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`initial keyed admission`, plan, observe, () =>
        checkKeyedAdmission(driver, plan.history, {
          reach: (state) => observe(`reach`, state),
        }),
      ),
    check: forwardAssertionJudgment,
  })
}
declareOracle({
  grammar: [keyedAdmissionArbitrary],
  check: [checkKeyedAdmission],
})
// Immutable explicit keys obey contract.ts (maintainer decision, 2026-11-03).
// Equal values keep the authored query even when a new callback proposes a
// different predicate. Changed nested values admit that predicate. Mutation is
// outside the legal grammar; frozen key trees catch accidental fixture writes.
// This lane covers plain records/arrays and JSON scalar leaves, not rich keys,
// disabled admission, pending work, transport seeds or speculative host cuts.
const immutableKeyArbitrary = fc.record({
  count: fc.integer({ min: 3, max: 10 }),
  label: fc.string({ maxLength: 8 }),
  values: fc.array(
    fc.oneof(fc.integer(), fc.string(), fc.boolean(), fc.constant(null)),
    {
      maxLength: 4,
    },
  ),
  tail: fc.array(
    fc.record({
      object: fc.integer({ min: 0, max: 2 }),
      array: fc.integer({ min: 0, max: 2 }),
      minimum: fc.integer({ min: -1, max: 10 }),
      reordered: fc.boolean(),
    }),
    { maxLength: 5 },
  ),
})
type ImmutableKeyHistory =
  typeof immutableKeyArbitrary extends fc.Arbitrary<infer T> ? T : never
function immutableKey(
  history: ImmutableKeyHistory,
  object: number,
  array: number,
  reordered = false,
): ReadonlyArray<unknown> {
  const filter = Object.freeze({ minimum: object })
  const clauses = Object.freeze([Object.freeze({ minimum: array })])
  const values = Object.freeze([...history.values])
  return Object.freeze([
    `immutable-key`,
    Object.freeze(
      reordered
        ? { values, clauses, filter, label: history.label }
        : { label: history.label, filter, clauses, values },
    ),
  ])
}
// The two integers are model-only key equivalence classes. One names a value
// under a record, the other under an array. Equality needs no production deep
// comparator or hash. The authored minimum is separate: equal keys may propose
// different queries, so the next render distinguishes it from the candidate.
async function checkImmutableKeyHistory(
  driver: LiveQueryDriver,
  history: ImmutableKeyHistory,
  reach: {
    reach: (state: string) => void
  },
) {
  const lifetime = new ScenarioLifetime()
  let mounted:
    | ControllableHandle<{
        key: ReadonlyArray<unknown>
        minimum: number
      }>
    | undefined
  lifetime.defer(() => mounted?.unmount())
  await lifetime.run(async () => {
    const rows = Array.from({ length: history.count }, (_, rank) => ({
      id: String(rank),
      rank,
    }))
    const source = driver.makeSource(rows)
    lifetime.defer(() => source.collection.cleanup({ dependents: true }))
    const page = {
      offset: 0,
      limit: history.count,
      minimum: -1,
      descending: false,
      nestedLimit: history.count,
    }
    const firstKey = immutableKey(history, 0, 0)
    mounted = driver.mountKeyedControllable!(
      (
        q,
        input: {
          key: ReadonlyArray<unknown>
          minimum: number
        },
      ) =>
        q
          .from({ row: source.collection })
          .where(({ row }: { row: WindowRow }) =>
            driver.ops.gt(row.rank, input.minimum),
          )
          .orderBy(({ row }: { row: WindowRow }) => row.rank)
          .limit(page.limit)
          .select(({ row }: { row: WindowRow }) => ({
            id: row.id,
            rank: row.rank,
          })),
      (input) => input.key,
      { key: firstKey, minimum: -1 },
    )
    await mounted.flush()
    let previous = { object: 0, array: 0 }
    let minimum = -1
    const compare = (
      checkpoint: string,
      previousCollection?: unknown,
      retain = true,
    ) => {
      const expected = windowRows(rows, { ...page, minimum }, false)
      oracleAssertion('checkWindowObservation', () =>
        checkWindowObservation(
          { rows: mounted!.current().data, collection: mounted!.collection() },
          {
            rows: expected,
            previousCollection,
            retain,
          },
          checkpoint,
        ),
      )
      oracleAssertion('checkWindowState', () =>
        checkWindowState(mounted!.current().state, expected, checkpoint),
      )
    }
    compare(`initial immutable key`)
    // Each history reconstructs equal reference/deep-value proposals, then
    // changes each nested path independently and restores the original key.
    // Tail actions vary repetitions, returns, predicates and property order.
    const steps = [
      {
        object: 0,
        array: 0,
        minimum: history.count,
        key: firstKey,
        cut: `same key object`,
      },
      {
        object: 0,
        array: 0,
        minimum: history.count,
        key: Object.freeze([...firstKey]),
        cut: `fresh outer array`,
      },
      {
        object: 0,
        array: 0,
        minimum: history.count,
        key: immutableKey(history, 0, 0),
        cut: `fresh equal nested values`,
      },
      {
        object: 0,
        array: 0,
        minimum: history.count,
        key: immutableKey(history, 0, 0, true),
        cut: `reordered record properties`,
      },
      {
        object: 1,
        array: 0,
        minimum: history.count,
        key: immutableKey(history, 1, 0),
        cut: `changed nested record value`,
      },
      {
        object: 1,
        array: 0,
        minimum: -1,
        key: immutableKey(history, 1, 0),
        cut: `equal key after replacement`,
      },
      {
        object: 1,
        array: 1,
        minimum: -1,
        key: immutableKey(history, 1, 1),
        cut: `changed nested array value`,
      },
      {
        object: 0,
        array: 0,
        minimum: 0,
        key: firstKey,
        cut: `return to earlier key`,
      },
      ...history.tail.map((step) => ({
        ...step,
        key: immutableKey(history, step.object, step.array, step.reordered),
        cut: `generated key proposal`,
      })),
    ]
    for (const step of steps) {
      const retain =
        previous.object === step.object && previous.array === step.array
      const collection = mounted.collection()
      const changedPlan = minimum !== step.minimum
      if (!retain) minimum = step.minimum
      await mounted.setParam({ key: step.key, minimum: step.minimum })
      // The driver's native settled cut supplies the real host witness. Check
      // data, keyed state and Collection identity without normalizing output.
      // An invalidated key with an identical plan leaves Collection reuse free.
      compare(step.cut, retain || changedPlan ? collection : undefined, retain)
      if (step.cut !== `generated key proposal`) reach.reach(step.cut)
      previous = step
    }
  })
}
function registerImmutableKeyOracle(driver: LiveQueryDriver) {
  const keyStates = [
    `same key object`,
    `fresh outer array`,
    `fresh equal nested values`,
    `reordered record properties`,
    `changed nested record value`,
    `equal key after replacement`,
    `changed nested array value`,
    `return to earlier key`,
  ] as const
  oracleProperty({
    id: windowHistoryProperty(driver, `immutable-key-history`),
    law: {
      statement: `Immutable equal key trees retain the admitted query independently of proposed predicates; changed nested values admit the changed query.`,
      authority: `conformance/contract.ts immutable explicit-key law and maintainer decision 2026-11-03.`,
      owner: `packages/db/tests/conformance/window-history-oracle.ts`,
      limits: `The unchanged native keyed drivers, plain records/arrays and JSON scalar leaves; no rich keys, mutation, disabled, pending or transport claim.`,
    },
    histories: {
      arbitrary: immutableKeyArbitrary,
      runs: 6,
      fixedSeeds: [2345],
      states: keyStates,
      constructed: [
        {
          name: `complete immutable key history`,
          enters: keyStates,
          build: (history) => ({ ...history }),
        },
      ],
    },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(
        `immutable explicit query key`,
        plan,
        observe,
        async () => {
          const observed = new Set<string>()
          await checkImmutableKeyHistory(driver, plan.history, {
            reach: (state) => {
              observed.add(state)
              observe(`reach`, state)
            },
          })
          // Every existing history contains all eight cuts. Requiring each history
          // preserves the old minimum of oracleRuns(6) at the unchanged run budget.
          oracleAssertion(
            'expect(keyStates.filter((state) => !observed.has(state))).toEqual([])',
            () =>
              expect(keyStates.filter((state) => !observed.has(state))).toEqual(
                [],
              ),
          )
        },
      ),
    check: forwardAssertionJudgment,
  })
}
declareOracle({
  grammar: [immutableKeyArbitrary],
  check: [checkImmutableKeyHistory],
})
