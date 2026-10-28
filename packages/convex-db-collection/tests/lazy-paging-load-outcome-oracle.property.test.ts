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
import { expect, it } from 'vitest'
import { runOracleCampaign } from '../../db/tests/oracle-campaign'
import { withTestCleanup } from './helpers'
import { lazyOracleRuns } from './lazy-paging-campaign'
import { expectedLazyRows } from './lazy-paging-model-oracle'
import { LazyVersionModel } from './lazy-paging-version-model-oracle'
import type { LazyRow } from './lazy-paging-model-oracle'
import type { LoadSubsetOptions, SyncConfig } from '@tanstack/db'

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
    expect(read(), `load outcome law at ${name}`).toEqual(expected)
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
      expect(waiter).toBeInstanceOf(Promise)
      const result = Promise.allSettled([waiter])
      expect(
        await result,
        `load outcome law: failed replay must reject with original error`,
      ).toEqual([{ status: `rejected`, reason: failure }])
      expect(failedCalls).toBeGreaterThan(0)
      if (!graph) {
        expect(errors).toEqual([failure])
        expect(direct.lastError).toBe(failure)
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
  expect(resources.size, `load outcome law: leaked adapter resources`).toBe(0)
  return trace
}

it(`gives throw and rejection the same public replay failure and recovery`, async () => {
  await runOracleCampaign(
    `CONVEX_LOAD_OUTCOME_ORACLE`,
    [
      `direct-equivalence`,
      `query-equivalence`,
      `failed-publication-held`,
      `retry-recovers`,
    ] as const,
    (reach, parameters) =>
      fc.assert(
        fc.asyncProperty(grammar, async (h) => {
          reach.beginHistory()
          for (const consumer of [`direct`, `query`] as const) {
            const thrown = await receive(h, `throw`, consumer)
            const rejected = await receive(h, `reject`, consumer)
            expect(rejected, `throw/rejection metamorphic law`).toEqual(thrown)
            reach.reach(`${consumer}-equivalence`)
          }
          reach.reach(`failed-publication-held`)
          reach.reach(`retry-recovers`)
        }),
        { numRuns: lazyOracleRuns(30), ...parameters },
      ),
    { fixedSeed: 20261030 },
  )
})
