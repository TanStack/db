// @vitest-environment node
import { render } from 'svelte/server'
import { BTreeIndex, DbClient, Query, collectionOptions } from '@tanstack/db'
import {
  differs,
  oracleProperty,
  pass,
  violation,
} from '../../db/tests/oracle-config'
import { declareOracle } from '../../db/tests/oracle-declaration'
import {
  expectedSsrSnapshot,
  ssrSnapshotExamples,
  ssrSnapshotHistoryArbitrary,
} from '../../db/tests/ssr-snapshot-admission-oracle'
import SsrDbApp from './SsrDbApp.svelte'
import { peopleQuery } from './ssr-test-utils'
import type { Observation, Verdict } from '../../db/tests/oracle-config'
import type { SsrSnapshotHistory } from '../../db/tests/ssr-snapshot-admission-oracle'

/**
 * Svelte supplies its own server host for the shared SSR admission judgment.
 * Source actions and legal histories are the same as React's receiving driver;
 * expected rejection, rows and status come only from the shared model. Compare
 * the two server renders to check server-side transport reconstruction only.
 * The actual browser branch is checked by ssr-snapshot-handoff-oracle.svelte.test.ts;
 * hydration.svelte.test.ts separately owns normal browser/effect handoff.
 */
const admissionStates = [
  `cold-loading`,
  `unbacked-ready-empty`,
  `unbacked-rows`,
  `query-result`,
  `normalized-ready`,
  `normalized-partial`,
  `pending-query`,
] as const
async function recordHistory(
  history: SsrSnapshotHistory,
  observe: (checkpoint: string, value: unknown) => void,
) {
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
      observe(`rejection is error`, failure instanceof Error)
      observe(`rejection message`, String(failure))
      observe(
        `reach`,
        history.rows.length ? `unbacked-rows` : `unbacked-ready-empty`,
      )
    } else {
      observe(`admitted failure`, failure)
      browser.hydrate(server.dehydrate())
      const initialBrowserHtml = render(SsrDbApp, {
        props: { client: browser, descriptor },
      }).body
      observe(`server html`, html)
      observe(`initial browser html`, initialBrowserHtml)
      if (history.preparation === `query`) observe(`reach`, `query-result`)
      else if (
        history.preparation === `source` &&
        history.sourceState !== `idle`
      )
        observe(
          `reach`,
          history.sourceState === `loading`
            ? `normalized-partial`
            : `normalized-ready`,
        )
      else observe(`reach`, `cold-loading`)
    }
    if (history.preparation === `pending-query`)
      observe(`reach`, `pending-query`)
  } finally {
    await browser.cleanup()
    await server.cleanup()
  }
}

// Both renders retain the original server-only observation boundary. Expected
// status and source rows remain owned by the shared admission model.
function checkHistory(
  history: SsrSnapshotHistory,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof expectedSsrSnapshot>,
): Verdict {
  const serverHtml = trace.find(
    ({ checkpoint }) => checkpoint === `server html`,
  )?.value
  for (const { checkpoint, value } of trace) {
    if (checkpoint === `reach`) continue
    let wrong: Verdict | undefined
    if (checkpoint === `rejection is error`)
      wrong = differs(checkpoint, `SSR admission`, value, true)
    else if (checkpoint === `rejection message`) {
      if (typeof value !== `string` || !/SSR.*(?:preload|hydrat)/i.test(value))
        wrong = violation(
          checkpoint,
          `expected SSR preload/hydration rejection`,
          `SSR admission`,
        )
    } else if (checkpoint === `admitted failure`)
      wrong = differs(checkpoint, `SSR admission`, value, undefined)
    else if (checkpoint === `initial browser html`)
      wrong = differs(checkpoint, `SSR admission`, value, serverHtml)
    else if (checkpoint === `server html`) {
      if (
        typeof value !== `string` ||
        !value.includes(`data-status="${expected.status}"`) ||
        expected.rows.some((row) => !value.includes(`<span>${row.name}</span>`))
      )
        wrong = violation(
          checkpoint,
          `server markup omits the modeled rows or status`,
          `SSR admission`,
        )
    } else
      wrong = violation(checkpoint, `unexpected observation`, `SSR admission`)
    if (wrong) return wrong
  }
  for (const checkpoint of expected.rejects
    ? [`rejection is error`, `rejection message`]
    : [`admitted failure`, `server html`, `initial browser html`])
    if (trace.filter((entry) => entry.checkpoint === checkpoint).length !== 1)
      return violation(checkpoint, `expected one observation`, `SSR admission`)
  return pass
}
const law = {
  statement: `Svelte SSR rejects untransported rows or readiness and reconstructs every admitted server view from transported state.`,
  authority: `docs/guides/ssr.md preparation/hydration contract and packages/db/tests/ssr-snapshot-admission-oracle.ts`,
  limits: `The existing eager source/preparation grammar and two real server renders; native browser initialization belongs to the handoff receiver.`,
}
oracleProperty({
  id: `svelte.ssr-snapshot.cases`,
  law,
  histories: ssrSnapshotExamples,
  model: expectedSsrSnapshot,
  driver: recordHistory,
  check: checkHistory,
})
oracleProperty({
  id: `svelte.ssr-snapshot`,
  law,
  histories: {
    arbitrary: ssrSnapshotHistoryArbitrary,
    runs: 120,
    fixedSeeds: [2229],
    states: admissionStates,
    constructed: [
      {
        name: `cold loading`,
        enters: [`cold-loading`],
        build: (): SsrSnapshotHistory => ({
          preparation: `none`,
          sourceState: `idle`,
          rows: [],
        }),
      },
      {
        name: `unbacked ready empty`,
        enters: [`unbacked-ready-empty`],
        build: (): SsrSnapshotHistory => ({
          preparation: `none`,
          sourceState: `ready`,
          rows: [],
        }),
      },
      {
        name: `unbacked rows`,
        enters: [`unbacked-rows`],
        build: (): SsrSnapshotHistory => ({
          preparation: `none`,
          sourceState: `loading`,
          rows: [{ id: `1`, name: `server 1` }],
        }),
      },
      {
        name: `query result`,
        enters: [`query-result`],
        build: (): SsrSnapshotHistory => ({
          preparation: `query`,
          sourceState: `ready`,
          rows: [],
        }),
      },
      {
        name: `normalized ready`,
        enters: [`normalized-ready`],
        build: (): SsrSnapshotHistory => ({
          preparation: `source`,
          sourceState: `ready`,
          rows: [],
        }),
      },
      {
        name: `normalized partial`,
        enters: [`normalized-partial`],
        build: (): SsrSnapshotHistory => ({
          preparation: `source`,
          sourceState: `loading`,
          rows: [],
        }),
      },
      {
        name: `pending query`,
        enters: [`pending-query`],
        build: (): SsrSnapshotHistory => ({
          preparation: `pending-query`,
          sourceState: `loading`,
          rows: [],
        }),
      },
    ],
    fixed: ssrSnapshotExamples.map((history, index) => ({
      name: `SSR admission ${index}`,
      history,
    })),
  },
  model: expectedSsrSnapshot,
  driver: recordHistory,
  check: checkHistory,
})
declareOracle({
  owns: [`src/useLiveQuery.svelte.ts#useLiveQuery`],
  model: [expectedSsrSnapshot],
  grammar: [ssrSnapshotHistoryArbitrary],
  check: [checkHistory],
})
