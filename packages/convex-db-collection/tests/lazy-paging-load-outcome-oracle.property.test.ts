/**
 * A throw and a rejected promise are equivalent failed-load observations.
 * Authority: #2269 comment 6448490334, LoadSubsetFn, and publication laws 7/9
 * in live/ARCHITECTURE.md. This metamorphic judgment compares the same authored
 * history through both outcomes, independently checking exact public values,
 * error identity and recovery. A failed replacement never gains publication
 * authority from ordinary later writes. LazyVersionModel judges every callback.
 *
 * Acquisition lifetimes differ legitimately: a throw creates no lease; an
 * accepted promise does. The adapter releases partial resources before a
 * throw, and releases accepted resources on unload/cleanup. We compare drained
 * public cuts and final resource release, not raw scheduling or unload counts.
 *
 * Grammar: 1–4 rows, short text, optional partial writes before failure,
 * 1–4 rejection turns, direct and live-query receivers in every history.
 * The constructive initial/failure/ordinary-write/retry sequence reconstructs
 * replay-failure-boundary.test.ts without its includes/peer profile. Partial
 * writes distinguish failed publication from empty-source handling; later
 * writes distinguish failed authority from a temporary delay. Limits: one
 * source/consumer, no initial-load equivalence, reentry or real backend claim.
 */
import { IR, createCollection, createLiveQueryCollection } from '@tanstack/db'
import fc from 'fast-check'
import { expect } from 'vitest'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import { oracleProperty } from '../../db/tests/oracle-property'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { withTestCleanup } from './helpers'
import { lazyOracleBaseRuns } from './lazy-paging-campaign'
import { expectedLazyRows } from './lazy-paging-model-oracle'
import { LazyVersionModel } from './lazy-paging-version-model-oracle'
import type { LazyRow } from './lazy-paging-model-oracle'
import type { LoadSubsetOptions, SyncConfig } from '@tanstack/db'

type AssertionHistory<T> = T extends fc.Arbitrary<infer H> ? H : never
type AssertionReach = {
  beginHistory: () => void
  reach: (state: string) => void
}

// Owns no convex source: this grammar drives @tanstack/db Collection and live queries with its own SyncConfig, not the convex pager.
declareOracle({})

const grammar = fc.record({
  count: fc.integer({ min: 1, max: 4 }),
  text: fc.string({ maxLength: 10 }),
  partial: fc.boolean(),
  turns: fc.integer({ min: 1, max: 4 }),
})
type History = typeof grammar extends fc.Arbitrary<infer T> ? T : never
const drain = async () => {
  for (let turn = 0; turn < 60; turn++) await Promise.resolve()
}

async function receive(
  h: History,
  failureMode: `throw` | `reject`,
  consumer: `direct` | `query`,
) {
  const rows = (version: number): Array<LazyRow> =>
    Array.from({ length: h.count }, (_, rank) => ({
      id: `r${rank}`,
      rank,
      text: `${h.text}:${version}`,
    }))
  const versions = new LazyVersionModel(`sequence`)
  versions.offer(rows(1))
  const failure = new Error(`authored failed load: ${h.text}`)
  let phase: `initial` | `failed` | `recovered` = `initial`
  let operations!: Parameters<SyncConfig<LazyRow>[`sync`]>[0]
  const resources = new Set<LoadSubsetOptions>()
  let failedCalls = 0
  const source = createCollection<LazyRow>({
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: (controls) => {
        operations = controls
        controls.begin()
        for (const row of rows(1))
          controls.write({ type: `insert`, value: row })
        controls.commit()
        controls.markReady()
        return {
          loadSubset: (request) => {
            resources.add(request)
            if (phase === `initial`) return true
            if (phase === `recovered` || h.partial) {
              controls.begin()
              for (const row of rows(phase === `recovered` ? 4 : 2))
                controls.write({
                  type: source.base.has(row.id) ? `update` : `insert`,
                  value: row,
                })
              controls.commit()
            }
            if (phase === `recovered`) return true
            failedCalls++
            if (failureMode === `throw`) {
              resources.delete(request)
              throw failure
            }
            return (async () => {
              for (let turn = 0; turn < h.turns; turn++) await Promise.resolve()
              throw failure
            })()
          },
          unloadSubset: (request) => {
            resources.delete(request)
          },
          cleanup: () => {
            resources.clear()
          },
        }
      },
    },
  })
  const failures: Array<unknown> = []
  const retained = new Map<string, LazyRow>()
  const graph =
    consumer === `query`
      ? createLiveQueryCollection((q) =>
          q
            .from({ row: source })
            .orderBy(({ row }) => row.rank, `asc`)
            .select(({ row }) => ({
              id: row.id,
              rank: row.rank,
              text: row.text,
            })),
        )
      : undefined
  const read = () =>
    graph
      ? graph.toArray.map(({ id, rank, text }) => ({ id, rank, text }))
      : expectedLazyRows([...retained.values()], {})
  const observe = () => {
    try {
      versions.observe(read())
    } catch (error) {
      failures.push(error)
    }
  }
  const direct = source.subscribeChanges(
    (changes) => {
      if (consumer !== `direct`) return
      for (const change of changes) {
        if (change.type === `delete`) retained.delete(String(change.key))
        else retained.set(String(change.key), { ...change.value })
      }
      observe()
    },
    { includeInitialState: false },
  )
  const graphObserver = graph?.subscribeChanges(observe, {
    includeInitialState: false,
  })
  const errors: Array<unknown> = []
  direct.on(`loadSubset:error`, ({ error }) => errors.push(error))
  const trace: Array<{
    checkpoint: string
    rows: Array<LazyRow>
    status: string
    failed: boolean
  }> = []
  const checkpoint = async (
    name: string,
    expected: Array<LazyRow>,
    failed: boolean,
  ) => {
    await drain()
    if (failures.length) throw failures[0]
    oracleAssertion(
      `lazy-paging-load-outcome-oracle.property.test.ts:168:toEqual`,
      () => expect(read(), `load outcome law at ${name}`).toEqual(expected),
    )
    trace.push({
      checkpoint: name,
      rows: read().map((row) => ({ ...row })),
      status: source.status,
      failed,
    })
  }
  const truncate = () => {
    operations.begin()
    operations.truncate()
    operations.commit()
  }
  await withTestCleanup(
    async () => {
      if (graph) await graph.preload()
      else
        direct.requestSnapshot({
          where: new IR.Func(`gte`, [
            new IR.PropRef([`rank`]),
            new IR.Value(0),
          ]),
        })
      await checkpoint(`initial`, rows(1), false)
      phase = `failed`
      truncate()
      const waiter = graph
        ? graph.utils.setWindow({ limit: h.count + 1 })
        : direct.pendingTruncateReplacement
      oracleAssertion(
        `lazy-paging-load-outcome-oracle.property.test.ts:197:toBeInstanceOf`,
        () => expect(waiter).toBeInstanceOf(Promise),
      )
      const result = Promise.allSettled([waiter])
      const observedResult = await result
      oracleAssertion(
        `lazy-paging-load-outcome-oracle.property.test.ts:199:toEqual`,
        () =>
          expect(
            observedResult,
            `load outcome law: failed replay must reject with original error`,
          ).toEqual([{ status: `rejected`, reason: failure }]),
      )
      oracleAssertion(
        `lazy-paging-load-outcome-oracle.property.test.ts:203:toBeGreaterThan`,
        () => expect(failedCalls).toBeGreaterThan(0),
      )
      if (!graph) {
        oracleAssertion(
          `lazy-paging-load-outcome-oracle.property.test.ts:205:toEqual`,
          () => expect(errors).toEqual([failure]),
        )
        oracleAssertion(
          `lazy-paging-load-outcome-oracle.property.test.ts:206:toBe`,
          () => expect(direct.lastError).toBe(failure),
        )
      }
      await checkpoint(`failed`, rows(1), true)
      operations.begin()
      for (const row of rows(3))
        operations.write({
          type: source.base.has(row.id) ? `update` : `insert`,
          value: row,
        })
      operations.commit()
      await checkpoint(`ordinary write cannot repair`, rows(1), true)
      phase = `recovered`
      versions.offer(rows(4))
      truncate()
      await drain()
      if (graph) await graph.utils.setWindow({ limit: h.count + 1 })
      await checkpoint(`recovered`, rows(4), false)
    },
    () => graphObserver?.unsubscribe(),
    () => direct.unsubscribe(),
    () => graph?.cleanup(),
    () => source.cleanup(),
  )
  oracleAssertion(
    `lazy-paging-load-outcome-oracle.property.test.ts:229:toBe`,
    () =>
      expect(resources.size, `load outcome law: leaked adapter resources`).toBe(
        0,
      ),
  )
  return trace
}

const convex_load_outcomeHistory = grammar
// This existing helper retains the independent reference, production lifecycle,
// comparison cuts and assertions. The native adapter only transports its judgment.
async function convex_load_outcomeJudgment(
  h: AssertionHistory<typeof convex_load_outcomeHistory>,
  reach: AssertionReach,
) {
  reach.beginHistory()
  for (const consumer of [`direct`, `query`] as const) {
    const thrown = await receive(h, `throw`, consumer)
    const rejected = await receive(h, `reject`, consumer)
    oracleAssertion(
      `lazy-paging-load-outcome-oracle.property.test.ts:242:toEqual`,
      () => expect(rejected, `throw/rejection metamorphic law`).toEqual(thrown),
    )
    reach.reach(`${consumer}-equivalence`)
  }
  reach.reach(`failed-publication-held`)
  reach.reach(`retry-recovers`)
}

oracleProperty({
  id: `convex.load-outcome`,
  law: {
    statement: `gives throw and rejection the same public replay failure and recovery`,
    authority: `docs/collections/convex-collection.md; the existing model and contract stated above and named in docs/contributing/oracle-coverage.md.`,
    limits: `The unchanged bounded grammar, receiving paths and observation cuts described above; registration migration adds no product coverage.`,
  },
  histories: {
    arbitrary: convex_load_outcomeHistory,
    runs: lazyOracleBaseRuns(30),
    fixedSeeds: [20261030],
    states: [
      `direct-equivalence`,
      `query-equivalence`,
      `failed-publication-held`,
      `retry-recovers`,
    ] as const,
    constructed: [
      {
        name: `existing constructive history`,
        enters: [
          `direct-equivalence`,
          `query-equivalence`,
          `failed-publication-held`,
          `retry-recovers`,
        ] as const,
        build: (generated) => generated,
      },
    ],
  },
  resolve: (generated) => ({ history: generated }),
  model: recordedAssertionJudgment,
  check: forwardAssertionJudgment,
  driver: async (plan, observe) =>
    recordAssertionJudgment(`convex.load-outcome`, plan, observe, () =>
      convex_load_outcomeJudgment(plan.history, {
        beginHistory: () => {},
        reach: (state) => observe(`reach`, state),
      }),
    ),
  timeout: 120000,
})
