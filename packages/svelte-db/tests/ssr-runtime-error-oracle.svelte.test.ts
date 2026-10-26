/**
 * Svelte receives the shared SSR runtime-error law through real server and
 * browser compilations. A handled provider failure remains a readable hook
 * result. Its first browser rows and flags reproduce the server view even if
 * browser preload has already produced a different outcome. After effects
 * subscribe, the browser's own outcome becomes observable.
 *
 * The shared admission owner's runtime grammar and judgment supply every
 * expected view. Empty eager sources avoid inventing error row retention or
 * portable error-object identity. The fixture supplies native SSR, JSON
 * transport and hydrate(); construction and pre-effects record the two public
 * cuts. This lane does not model throwing provider callbacks or Suspense.
 */
import { TextEncoder } from 'node:util'
import { fc } from '@fast-check/vitest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { flushSync, hydrate, unmount } from 'svelte'
import { DbClient, collectionOptions } from '@tanstack/db'
import {
  expectedSsrRuntimeErrorViews,
  ssrRuntimeErrorExamples,
  ssrRuntimeErrorHistoryArbitrary,
} from '../../db/tests/ssr-snapshot-admission-oracle'
import {
  oraclePropertyOptions,
  oracleReplayRequested,
  oracleRuns,
} from '../../db/tests/oracle-config'
import { createOracleReach } from '../../db/tests/oracle-reach'
import SsrDbApp from './SsrDbApp.svelte'
import type { createServer } from 'vite'
import type { SsrRuntimeErrorHistory } from '../../db/tests/ssr-snapshot-admission-oracle'
import type { renderSsrRuntimeErrorHistory } from './ssr-snapshot-fixture'
import type { SsrHookFlags } from './ssr-test-utils'

let server: Awaited<ReturnType<typeof createServer>>
let renderServer: typeof renderSsrRuntimeErrorHistory
beforeAll(async () => {
  const encoder = globalThis.TextEncoder
  vi.stubGlobal(
    `TextEncoder`,
    class extends TextEncoder {
      override encode(input?: string) {
        return new Uint8Array(super.encode(input))
      }
    },
  )
  const { createServer } = await import('vite')
  vi.stubGlobal(`TextEncoder`, encoder)
  server = await createServer({
    root: import.meta.dirname.replace(/\/tests$/, ``),
    configFile: `${import.meta.dirname}/../vite.config.ts`,
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true },
  })
  renderServer = (await server.ssrLoadModule(`/tests/ssr-snapshot-fixture.ts`))
    .renderSsrRuntimeErrorHistory
}, 30_000)
afterAll(async () => {
  await server.close()
})

const makeRuntimeReach = () =>
  createOracleReach(`svelte-ssr-runtime`, [
    `server-error-browser-cold`,
    `server-ready-browser-failed-before-hydration`,
    `server-error-browser-ready-before-hydration`,
    `matching-ready`,
    `matching-error`,
    `undefined-cause`,
    `defined-cause`,
    `browser-commit`,
  ])

async function checkRuntimeHistory(
  history: SsrRuntimeErrorHistory,
  reach: ReturnType<typeof makeRuntimeReach>,
) {
  reach.beginHistory()
  const expected = expectedSsrRuntimeErrorViews(history)
  const browserWindow = globalThis.window
  let rendered: Awaited<ReturnType<typeof renderServer>>
  vi.stubGlobal(`window`, undefined)
  try {
    rendered = await renderServer(history)
  } finally {
    vi.stubGlobal(`window`, browserWindow)
  }
  expect(rendered.view, `server runtime outcome remains readable`).toEqual(
    expected.initial,
  )
  const client = new DbClient()
  let starts = 0
  const descriptor = collectionOptions(`svelte-ssr-people`, () => ({
    id: `svelte-ssr-people`,
    getKey: (row: { id: string; name: string; sourcePayload: string }) =>
      row.id,
    sync: {
      sync: ({ markReady, markError }) => {
        starts++
        if (history.browserOutcome === `error`)
          markError(
            history.definedError
              ? new Error(`provider unavailable`)
              : undefined,
          )
        else markReady()
      },
    },
  }))
  type View = SsrHookFlags & { rows: Array<string>; status: string }
  const initial: Array<View> = []
  let committed: View | undefined
  const target = document.createElement(`div`)
  target.innerHTML = rendered.html
  document.body.append(target)
  let app: ReturnType<typeof hydrate> | undefined
  let failure: { error: unknown } | undefined
  const cleanupErrors: Array<unknown> = []
  try {
    client.hydrate(JSON.parse(JSON.stringify(rendered.state)))
    if (history.browserPreload)
      await client
        .collection(descriptor)
        .preload()
        .catch(() => {})
    expect(starts, `pre-hydration source startup is controlled`).toBe(
      Number(history.browserPreload),
    )
    app = hydrate(SsrDbApp, {
      target,
      props: {
        client,
        descriptor,
        hydrating: true,
        onInitial: (
          rows: Array<{ id: string; name: string }>,
          status: string,
          flags: SsrHookFlags,
        ) =>
          initial.push({ rows: rows.map((row) => row.id), status, ...flags }),
        onSnapshot: (
          rows: Array<{ id: string; name: string }>,
          status: string,
          flags: SsrHookFlags,
        ) => {
          committed = { rows: rows.map((row) => row.id), status, ...flags }
        },
      },
    })
    expect(initial.length, `native hydrate reached the public hook`).toBe(1)
    // Observe the live error surface before comparing the first read. A RED
    // initial-view result therefore still establishes the neighboring cut.
    await vi.waitFor(() => {
      flushSync()
      expect(committed, `browser runtime outcome remains readable`).toEqual(
        expected.committed,
      )
    })
    expect(starts, `browser effects start or reuse one source`).toBe(1)
    reach.reach(`browser-commit`)
    reach.reach(history.definedError ? `defined-cause` : `undefined-cause`)
    if (history.serverOutcome === `error` && !history.browserPreload)
      reach.reach(`server-error-browser-cold`)
    if (
      history.serverOutcome === `ready` &&
      history.browserOutcome === `error` &&
      history.browserPreload
    )
      reach.reach(`server-ready-browser-failed-before-hydration`)
    if (
      history.serverOutcome === `error` &&
      history.browserOutcome === `ready` &&
      history.browserPreload
    )
      reach.reach(`server-error-browser-ready-before-hydration`)
    if (history.serverOutcome === history.browserOutcome)
      reach.reach(
        history.serverOutcome === `ready` ? `matching-ready` : `matching-error`,
      )
    expect(initial[0], `first browser flags reproduce server output`).toEqual(
      rendered.view,
    )
  } catch (error) {
    failure = { error }
  } finally {
    for (const cleanup of [
      () => (app ? unmount(app) : undefined),
      () => client.cleanup(),
    ]) {
      try {
        await cleanup()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    target.remove()
  }
  if (failure) {
    if (cleanupErrors.length)
      throw new AggregateError(
        [failure.error, ...cleanupErrors],
        `SSR runtime mismatch with secondary cleanup failures`,
        { cause: failure.error },
      )
    throw failure.error
  }
  if (cleanupErrors.length)
    throw new AggregateError(
      cleanupErrors,
      `SSR runtime receiver cleanup failed`,
    )
}

describe(`Svelte SSR runtime errors`, () => {
  for (const history of ssrRuntimeErrorExamples)
    it.skipIf(oracleReplayRequested())(
      `runtime ${history.serverOutcome}/${history.browserOutcome} preload=${history.browserPreload} cause=${history.definedError}`,
      () => checkRuntimeHistory(history, makeRuntimeReach()),
    )
  for (const campaign of [`fixed`, `random`] as const) {
    const run = campaign === `fixed` ? it.skipIf(oracleReplayRequested()) : it
    run(
      `keeps runtime failures on their ordinary error surface (${campaign})`,
      async () => {
        const reach = makeRuntimeReach()
        try {
          await fc.assert(
            fc.asyncProperty(ssrRuntimeErrorHistoryArbitrary, (history) =>
              checkRuntimeHistory(history, reach),
            ),
            {
              ...(campaign === `fixed`
                ? { numRuns: oracleRuns(64), seed: 2229 }
                : oraclePropertyOptions(64, `svelte.ssr-runtime-errors`)),
              examples: ssrRuntimeErrorExamples.map((history) => [history]),
            },
          )
          reach.assertReached()
        } finally {
          console.info(
            `svelte-ssr-runtime ${campaign}`,
            Object.fromEntries(reach.counts()),
          )
        }
      },
      30_000,
    )
  }
})
