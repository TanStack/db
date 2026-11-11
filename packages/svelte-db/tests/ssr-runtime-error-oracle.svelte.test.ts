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
 * cuts. A failure is the provider's fail() before readiness, a loading error
 * (`isLoadingError`). This grammar does not model throwing provider callbacks,
 * which crash the Collection (`isCrashed`), or Suspense.
 */
import { TextEncoder } from 'node:util'
import { afterAll, beforeAll, expect, vi } from 'vitest'
import { flushSync, hydrate, unmount } from 'svelte'
import { DbClient, collectionOptions } from '@tanstack/db'
import {
  expectedSsrRuntimeErrorViews,
  ssrRuntimeErrorExamples,
  ssrRuntimeErrorHistoryArbitrary,
} from '../../db/tests/ssr-snapshot-admission-oracle'
import {
  differs,
  oracleProperty,
  pass,
  violation,
} from '../../db/tests/oracle-config'
import { declareOracle } from '../../db/tests/oracle-declaration'
import SsrDbApp from './SsrDbApp.svelte'
import type { Observation, Verdict } from '../../db/tests/oracle-config'
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

const runtimeStates = [
  `server-error-browser-cold`,
  `server-ready-browser-failed-before-hydration`,
  `server-error-browser-ready-before-hydration`,
  `matching-ready`,
  `matching-error`,
  `undefined-cause`,
  `defined-cause`,
  `browser-commit`,
] as const

async function recordRuntimeHistory(
  history: SsrRuntimeErrorHistory,
  observe: (checkpoint: string, value: unknown) => void,
) {
  const expected = expectedSsrRuntimeErrorViews(history)
  const browserWindow = globalThis.window
  let rendered: Awaited<ReturnType<typeof renderServer>>
  vi.stubGlobal(`window`, undefined)
  try {
    rendered = await renderServer(history)
  } finally {
    vi.stubGlobal(`window`, browserWindow)
  }
  observe(`server view`, rendered.view)
  const client = new DbClient()
  let starts = 0
  const descriptor = collectionOptions(`svelte-ssr-people`, () => ({
    id: `svelte-ssr-people`,
    getKey: (row: { id: string; name: string; sourcePayload: string }) =>
      row.id,
    sync: {
      sync: ({ markReady, fail }) => {
        starts++
        if (history.browserOutcome === `error`)
          fail(
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
    observe(`pre-hydration starts`, starts)
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
    observe(`initial count`, initial.length)
    // Observe the live error surface before comparing the first read. A RED
    // initial-view result therefore still establishes the neighboring cut.
    // Preserve the original receiving wait. Record its final public value even
    // if the wait fails, so the native check judges the mismatch first.
    try {
      await vi.waitFor(() => {
        flushSync()
        expect(committed, `browser runtime outcome remains readable`).toEqual(
          expected.committed,
        )
      })
    } finally {
      observe(`committed browser view`, committed)
    }
    observe(`browser starts`, starts)
    observe(`reach`, `browser-commit`)
    observe(`reach`, history.definedError ? `defined-cause` : `undefined-cause`)
    if (history.serverOutcome === `error` && !history.browserPreload)
      observe(`reach`, `server-error-browser-cold`)
    if (
      history.serverOutcome === `ready` &&
      history.browserOutcome === `error` &&
      history.browserPreload
    )
      observe(`reach`, `server-ready-browser-failed-before-hydration`)
    if (
      history.serverOutcome === `error` &&
      history.browserOutcome === `ready` &&
      history.browserPreload
    )
      observe(`reach`, `server-error-browser-ready-before-hydration`)
    if (history.serverOutcome === history.browserOutcome)
      observe(
        `reach`,
        history.serverOutcome === `ready` ? `matching-ready` : `matching-error`,
      )
    observe(`first hydration view`, initial[0])
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

// The model remains shared with the core admission owner. Judge the server,
// committed browser and first hydration cuts in the same order as before.
function checkRuntimeTrace(
  history: SsrRuntimeErrorHistory,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof expectedSsrRuntimeErrorViews>,
): Verdict {
  const serverView = trace.find(
    ({ checkpoint }) => checkpoint === `server view`,
  )
  const targets: Record<string, unknown> = {
    [`server view`]: expected.initial,
    [`pre-hydration starts`]: Number(history.browserPreload),
    [`initial count`]: 1,
    [`committed browser view`]: expected.committed,
    [`browser starts`]: 1,
    [`first hydration view`]: serverView?.value,
  }
  for (const { checkpoint, value } of trace) {
    if (checkpoint === `reach`) continue
    const wrong = differs(
      checkpoint,
      `SSR runtime hydration`,
      value,
      targets[checkpoint],
    )
    if (wrong) return wrong
  }
  for (const checkpoint of Object.keys(targets))
    if (trace.filter((entry) => entry.checkpoint === checkpoint).length !== 1)
      return violation(
        checkpoint,
        `expected one observation`,
        `SSR runtime hydration`,
      )
  return pass
}
const runtimeLaw = {
  statement: `Handled provider failure stays readable; first browser rows and flags reproduce server output, then the browser's own runtime outcome becomes visible.`,
  authority: `docs/guides/ssr.md preparation/hydration promises and maintainer runtime-error decision; packages/db/tests/ssr-snapshot-admission-oracle.ts`,
  limits: `Svelte server/browser compilation, JSON transport and hydrate with empty eager sources; no throwing callbacks, portable error identity or Suspense claim.`,
}
oracleProperty({
  id: `svelte.ssr-runtime-errors.cases`,
  law: runtimeLaw,
  histories: ssrRuntimeErrorExamples,
  model: expectedSsrRuntimeErrorViews,
  driver: recordRuntimeHistory,
  check: checkRuntimeTrace,
})
oracleProperty({
  id: `svelte.ssr-runtime-errors`,
  law: runtimeLaw,
  histories: {
    arbitrary: ssrRuntimeErrorHistoryArbitrary,
    runs: 64,
    fixedSeeds: [2229],
    states: runtimeStates,
    constructed: [
      {
        name: `browser committed`,
        enters: [`browser-commit`],
        build: (history): SsrRuntimeErrorHistory => ({ ...history }),
      },
      {
        name: `cold browser receives server error`,
        enters: [`server-error-browser-cold`],
        build: (history): SsrRuntimeErrorHistory => ({
          ...history,
          serverOutcome: `error`,
          browserPreload: false,
        }),
      },
      {
        name: `failed browser receives ready server`,
        enters: [`server-ready-browser-failed-before-hydration`],
        build: (history): SsrRuntimeErrorHistory => ({
          ...history,
          serverOutcome: `ready`,
          browserOutcome: `error`,
          browserPreload: true,
        }),
      },
      {
        name: `ready browser receives server error`,
        enters: [`server-error-browser-ready-before-hydration`],
        build: (history): SsrRuntimeErrorHistory => ({
          ...history,
          serverOutcome: `error`,
          browserOutcome: `ready`,
          browserPreload: true,
        }),
      },
      {
        name: `matching ready`,
        enters: [`matching-ready`],
        build: (history): SsrRuntimeErrorHistory => ({
          ...history,
          serverOutcome: `ready`,
          browserOutcome: `ready`,
        }),
      },
      {
        name: `matching error`,
        enters: [`matching-error`],
        build: (history): SsrRuntimeErrorHistory => ({
          ...history,
          serverOutcome: `error`,
          browserOutcome: `error`,
        }),
      },
      {
        name: `undefined error cause`,
        enters: [`undefined-cause`],
        build: (history): SsrRuntimeErrorHistory => ({
          ...history,
          definedError: false,
        }),
      },
      {
        name: `defined error cause`,
        enters: [`defined-cause`],
        build: (history): SsrRuntimeErrorHistory => ({
          ...history,
          definedError: true,
        }),
      },
    ],
    fixed: ssrRuntimeErrorExamples.map((history, index) => ({
      name: `runtime outcome ${index}`,
      history,
    })),
  },
  model: expectedSsrRuntimeErrorViews,
  driver: recordRuntimeHistory,
  check: checkRuntimeTrace,
  timeout: 30_000,
})
declareOracle({
  owns: [`src/useLiveQuery.svelte.ts#useLiveQuery`],
  model: [expectedSsrRuntimeErrorViews],
  check: [checkRuntimeTrace],
  grammar: [ssrRuntimeErrorHistoryArbitrary],
})
