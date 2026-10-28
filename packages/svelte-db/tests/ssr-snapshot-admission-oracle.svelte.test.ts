// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import { render } from 'svelte/server'
import { BTreeIndex, DbClient, Query, collectionOptions } from '@tanstack/db'
import { oraclePropertyOptions, oracleRuns } from '../../db/tests/oracle-config'
import { createOracleReach } from '../../db/tests/oracle-reach'
import {
  expectedSsrSnapshot,
  ssrSnapshotExamples,
  ssrSnapshotHistoryArbitrary,
} from '../../db/tests/ssr-snapshot-admission-oracle'
import SsrDbApp from './SsrDbApp.svelte'
import { peopleQuery } from './ssr-test-utils'
import type { SsrSnapshotHistory } from '../../db/tests/ssr-snapshot-admission-oracle'

/**
 * Svelte supplies its own server host for the shared SSR admission judgment.
 * Source actions and legal histories are the same as React's receiving driver;
 * expected rejection, rows and status come only from the shared model. Compare
 * the two server renders to check server-side transport reconstruction only.
 * The actual browser branch is checked by ssr-snapshot-handoff-oracle.svelte.test.ts;
 * hydration.svelte.test.ts separately owns normal browser/effect handoff.
 */
describe(`Svelte SSR snapshot admission`, () => {
  const makeReach = () =>
    createOracleReach(`ssr-svelte`, [
      `cold-loading`,
      `unbacked-ready-empty`,
      `unbacked-rows`,
      `query-result`,
      `normalized-ready`,
      `normalized-partial`,
      `pending-query`,
    ])
  async function checkHistory(
    history: SsrSnapshotHistory,
    reach: ReturnType<typeof makeReach>,
  ) {
    reach.beginHistory()
    const expected = expectedSsrSnapshot(history)
    const descriptor = collectionOptions(`svelte-ssr-people`, () => ({
      id: `svelte-ssr-people`,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      getKey: (row: { id: string; name: string; sourcePayload: string }) =>
        row.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const row of history.rows)
            write({
              type: `insert`,
              value: { ...row, sourcePayload: `source-only` },
            })
          commit()
          if (history.sourceState === `ready`) markReady()
        },
      },
    }))
    const server = new DbClient(),
      browser = new DbClient()
    server._setSsrServerCleanupEnabled(true)
    browser._setSsrServerCleanupEnabled(true)
    try {
      if (history.sourceState !== `idle`) {
        const warming = server.preloadLiveQuery({
          query: new Query()
            .from({ person: descriptor })
            .select(({ person }) => ({ id: person.id })),
        })
        if (history.sourceState === `ready`) await warming
        else void warming.catch(() => {})
      }
      if (history.preparation === `source`) server.collection(descriptor)
      if (
        history.preparation === `query` ||
        history.preparation === `pending-query`
      ) {
        const preload = server.preloadLiveQuery(peopleQuery(descriptor))
        if (history.preparation === `query`) await preload
        else void preload.catch(() => {})
      }
      let html: string | undefined, failure: unknown
      try {
        html = render(SsrDbApp, {
          props: { client: server, descriptor },
        }).body
      } catch (error) {
        failure = error
      }
      if (expected.rejects) {
        expect(
          failure,
          `SSR must reject untransported rows or readiness`,
        ).toBeInstanceOf(Error)
        expect(String(failure)).toMatch(/SSR.*(?:preload|hydrat)/i)
        reach.reach(
          history.rows.length ? `unbacked-rows` : `unbacked-ready-empty`,
        )
      } else {
        expect(failure, `prepared and cold SSR remain legal`).toBeUndefined()
        browser.hydrate(server.dehydrate())
        const initialBrowserHtml = render(SsrDbApp, {
          props: { client: browser, descriptor },
        }).body
        expect(
          initialBrowserHtml,
          `initial rows and status match before commit`,
        ).toBe(html)
        expect(html).toContain(`data-status="${expected.status}"`)
        for (const row of expected.rows)
          expect(html).toContain(`<span>${row.name}</span>`)
        if (history.preparation === `query`) reach.reach(`query-result`)
        else if (
          history.preparation === `source` &&
          history.sourceState !== `idle`
        )
          reach.reach(
            history.sourceState === `loading`
              ? `normalized-partial`
              : `normalized-ready`,
          )
        else reach.reach(`cold-loading`)
      }
      if (history.preparation === `pending-query`) reach.reach(`pending-query`)
    } finally {
      await browser.cleanup()
      await server.cleanup()
    }
  }
  for (const history of ssrSnapshotExamples) {
    it(`replays SSR ${history.preparation}/${history.sourceState}/${history.rows.length}`, async () => {
      await checkHistory(history, makeReach())
    })
  }
  for (const campaign of [`fixed`, `random`] as const) {
    it(`admits reproducible SSR snapshots (${campaign})`, async () => {
      const reach = makeReach()
      await fc.assert(
        fc.asyncProperty(ssrSnapshotHistoryArbitrary, (history) =>
          checkHistory(history, reach),
        ),
        {
          ...(campaign === `fixed`
            ? { numRuns: oracleRuns(120), seed: 2229 }
            : oraclePropertyOptions(120, `svelte.ssr-snapshot`)),
          examples: ssrSnapshotExamples.map((history) => [history]),
        },
      )
      reach.assertReached()
      console.info(
        `ssr-admission svelte ${campaign}`,
        Object.fromEntries(reach.counts()),
      )
    })
  }
})
