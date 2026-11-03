/**
 * Svelte receiving driver for the shared transported-page/window laws.
 * It supplies real runes and flushSync, JSON server preloads, held browser
 * readiness and fresh old-page readers. The independent sort/slice judgment
 * and history grammar are shared with React; this does not claim hydrate().
 */
import { BTreeIndex, DbClient, collectionOptions } from '@tanstack/db'
import { flushSync } from 'svelte'
import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import { useLiveQuery } from '../src/useLiveQuery.svelte'
import {
  checkWindowObservation,
  checkWindowState,
  windowRows,
} from '../../db/tests/conformance/window-history-oracle'
import {
  clientWindowArbitrary,
  clientWindowStates,
  clientWindowExamples as examples,
} from '../../db/tests/conformance/client-window-history-oracle'
import { ScenarioLifetime } from '../../db/tests/conformance/scenario-lifetime'
import { createOracleReach } from '../../db/tests/oracle-reach'
import { createOracleFailureFidelity } from '../../db/tests/oracle-failure-fidelity'
import {
  declareOracle,
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from '../../db/tests/oracle-config'
import type { InitialQueryBuilder } from '@tanstack/db'
import type { WindowRow } from '../../db/tests/conformance/window-history-oracle'
import type { ClientWindowHistory as History } from '../../db/tests/conformance/client-window-history-oracle'
// Client switching has its own React scope driver; this receiver measures only
// the states it actually supplies. Every keyed/derived campaign has its own reach.
const states = clientWindowStates.filter(
  (state) => state !== `client scope switch`,
)
async function checkClientWindowHistory(
  history: History,
  keyed: boolean,
  reach: ReturnType<typeof createOracleReach<(typeof states)[number]>>,
) {
  const lifetime = new ScenarioLifetime()
  const unmounts: Array<() => void> = []
  lifetime.defer(() => unmounts.forEach((unmount) => unmount()))
  const server = new DbClient()
  const browser = new DbClient()
  lifetime.defer(() => server.cleanup())
  lifetime.defer(() => browser.cleanup())
  await lifetime.run(async () => {
    const serverRows: Array<WindowRow> = Array.from(
      { length: history.count },
      (_, id) => ({ id: `s${id}`, rank: id }),
    )
    const browserRows = serverRows.map((row) => ({
      ...row,
      id: `b${row.rank}`,
    }))
    let ready: (() => void) | undefined
    const descriptor = collectionOptions(`client-window-source`, (owner) => ({
      getKey: (row: WindowRow) => row.id,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const value of owner === server ? serverRows : browserRows)
            write({ type: `insert`, value: { ...value } })
          commit()
          if (owner === server) markReady()
          else ready = markReady
        },
      },
    }))
    const first = { offset: history.offset, limit: history.width }
    const next = { offset: first.offset + history.jump, limit: first.limit + 1 }
    const build = (q: InitialQueryBuilder, page: typeof first) =>
      q
        .from({ row: descriptor })
        .orderBy(({ row }) => row.rank)
        .limit(page.limit)
        .offset(page.offset)
        .select(({ row }) => ({ id: row.id, rank: row.rank }))
    const config = (page: typeof first) => ({
      query: (q: InitialQueryBuilder) => build(q, page),
      ...(keyed
        ? { queryKey: [`client-window`, page.offset, page.limit] }
        : {}),
    })
    for (const page of [first, next])
      await server.preloadLiveQuery(config(page))
    const transport = JSON.parse(JSON.stringify(server.dehydrate()))
    browser.hydrate(transport)
    const expected = (rows: Array<WindowRow>, page: typeof first) =>
      windowRows(
        rows,
        { ...page, minimum: -1, descending: false, nestedLimit: rows.length },
        false,
      )
    // The first view is captured during rune construction, before effects.
    // Page updates are observed at Svelte's native flushSync cut.
    const mountPage = (initial: typeof first) => {
      let page = $state(initial)
      let current!: () => {
        data: unknown
        collection: unknown
        state: ReadonlyMap<unknown, unknown>
      }
      let initialView!: { data: unknown; collection: unknown }
      const dispose = $effect.root(() => {
        const result = useLiveQuery({
          query: (q) => build(q, page),
          queryKey: () =>
            keyed ? [`client-window`, page.offset, page.limit] : [],
          client: browser,
        })
        current = () => result
        initialView = { data: [...result.data], collection: result.collection }
      })
      unmounts.push(dispose)
      return {
        current,
        initialView,
        move(requested: typeof first) {
          page = requested
          flushSync()
        },
      }
    }
    const hook = mountPage(first)
    const firstRender = hook.initialView
    flushSync()
    checkWindowObservation(
      { rows: firstRender.data, collection: firstRender.collection },
      { rows: expected(serverRows, first), retain: true },
      `first preloaded page render`,
    )
    reach.reach(`first seed`)
    const collection = hook.current().collection
    const compare = (
      rows: Array<WindowRow>,
      page: typeof first,
      checkpoint: string,
      retain = true,
    ) => {
      checkWindowObservation(
        {
          rows: hook.current().data,
          collection: hook.current().collection,
        },
        { rows: expected(rows, page), previousCollection: collection, retain },
        checkpoint,
      )
      checkWindowState(hook.current().state, expected(rows, page), checkpoint)
    }
    const peer = mountPage(first)
    flushSync()
    const comparePeer = (rows: Array<WindowRow>, cut: string) =>
      checkWindowObservation(
        {
          rows: peer.current().data,
          collection: peer.current().collection,
        },
        {
          rows: expected(rows, first),
          previousCollection: collection,
          retain: false,
        },
        cut,
      )
    comparePeer(serverRows, `peer before move`)
    // Independent query inputs own distinct Collections. Moving one hook leaves
    // the other hook on its original page.
    hook.move(next)
    compare(
      serverRows,
      next,
      `moved preloaded page before local readiness`,
      true,
    )
    reach.reach(`moved seed`)
    comparePeer(serverRows, `peer while local readiness is held`)
    for (let index = 0; index < history.latePeers; index++) {
      const late = mountPage(first)
      flushSync()
      checkWindowObservation(
        { rows: late.current().data, collection: late.current().collection },
        {
          rows: expected(serverRows, first),
          previousCollection: collection,
          retain: false,
        },
        `fresh old-page lookup after move before local readiness`,
      )
      checkWindowState(
        late.current().state,
        expected(serverRows, first),
        `fresh old-page keyed view`,
      )
      expect(late.current().collection).not.toBe(peer.current().collection)
    }
    reach.reach(`fresh old-page lookup`)
    expect(ready, `browser sync started at commit`).toBeDefined()
    ready!()
    flushSync()
    // Native flush does not settle the observer's queued readiness handoff.
    // Require the public local result within the bounded receiving cut.
    await vi.waitFor(() => {
      flushSync()
      compare(browserRows, next, `local handoff`)
      comparePeer(browserRows, `peer after handoff`)
    })
    reach.reach(`local handoff`)
    comparePeer(browserRows, `peer after handoff`)
    reach.reach(`peer isolation`)
    hook.move(first)
    await vi.waitFor(() => {
      flushSync()
      compare(browserRows, first, `return to first page`)
    })
    reach.reach(`returned page`)
    // Ordinary moves do not rewrite the server's immutable page records.
    expect(JSON.parse(JSON.stringify(server.dehydrate()))).toEqual(transport)
  })
}

describe(`Svelte client page identity`, () => {
  for (const keyed of [false, true])
    for (const campaign of [`fixed`, `fresh`] as const) {
      const property = `svelte.client-window`
      const test =
        campaign === `fixed`
          ? oracleReplayTest(it)
          : oracleReplayTest(it, property)
      test(`${keyed ? `keyed` : `derived`}/${campaign}`, async () => {
        const reach = createOracleReach(
          `${property}/${keyed}/${campaign}`,
          states,
          { fixedHistories: examples.length },
        )
        let index = 0
        const fidelity = createOracleFailureFidelity<History>()
        try {
          await fidelity.assert(() =>
            fc.assert(
              fc.asyncProperty(clientWindowArbitrary, async (history) => {
                reach.beginHistory({ fixed: index++ < examples.length })
                await fidelity.run(history, () =>
                  checkClientWindowHistory(history, keyed, reach),
                )
              }),
              campaign === `fixed`
                ? {
                    numRuns: oracleRuns(6) + examples.length,
                    seed: 2345,
                    examples,
                  }
                : oraclePropertyOptions(6, property, { examples }),
            ),
          )
          reach.assertReached()
        } finally {
          console.info(
            `Svelte client window reach ${keyed}/${campaign}`,
            Object.fromEntries(reach.counts()),
          )
        }
      }, 30_000)
    }
})
declareOracle({ check: [checkClientWindowHistory] })
