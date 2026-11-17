/**
 * An ordinary SSR hook renders runtime failures as readable error results.
 * Its first browser view owes those same rows and lifecycle flags, even if
 * browser preparation has already succeeded or failed. After React commits
 * its subscription, the browser's own runtime outcome must become visible.
 * Authority: the SSR guide's preparation/hydration promises and the maintainer
 * runtime-error decision recorded in the migration-feedback review.
 *
 * The shared admission owner's runtime extension supplies the independent
 * status judgment and grammar. This receiver contributes actual renderToString,
 * JSON transport, hydrateRoot, and a layout-commit recorder for ordinary and
 * infinite hooks separately. Empty eager sources isolate status transport from
 * error row-retention policy. No error object is expected to cross JSON.
 */
import { act } from '@testing-library/react'
import { BTreeIndex, DbClient, Query, collectionOptions } from '@tanstack/db'
import { useLayoutEffect } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { vi } from 'vitest'
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
import { DbProvider } from '../src/DbProvider'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
import { useLiveQuery } from '../src/useLiveQuery'
import type { Observation, Verdict } from '../../db/tests/oracle-config'
import type { SsrRuntimeErrorHistory } from '../../db/tests/ssr-snapshot-admission-oracle'
import type { Root } from 'react-dom/client'

type RuntimeView = {
  rows: Array<string>
  status: string
  isReady: boolean
  isLoadingError: boolean
  isCrashed: boolean
  isLoading: boolean
  isIdle: boolean
}
type Hook = `ordinary` | `infinite`

const runtimeProperties = {
  ordinary: `react.ssr-runtime-ordinary`,
  infinite: `react.ssr-runtime-infinite`,
} as const

const runtimeStates = [
  `server-error-browser-cold`,
  `server-ready-browser-failed-before-hydration`,
  `server-error-browser-ready-before-hydration`,
  `matching-ready`,
  `matching-error`,
  `undefined-cause`,
  `defined-cause`,
  `browser-commit`,
  `explicit-preload-after-error-view`,
] as const

async function recordRuntimeHistory(
  hook: Hook,
  history: SsrRuntimeErrorHistory,
  observe: (checkpoint: string, value: unknown) => void,
) {
  const server = new DbClient()
  const browser = new DbClient()
  server._setSsrServerCleanupEnabled(true)
  browser._setSsrServerCleanupEnabled(true)
  const starts = { server: 0, browser: 0 }
  const sourceError = history.definedError
    ? new Error(`provider unavailable`)
    : undefined
  const descriptor = collectionOptions(`ssr-runtime-source`, (owner) => ({
    id: `ssr-runtime-source`,
    getKey: (row: { id: string }) => row.id,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: ({ markReady, fail }) => {
        const runtime = owner === server ? `server` : `browser`
        starts[runtime]++
        const outcome =
          runtime === `server` ? history.serverOutcome : history.browserOutcome
        if (outcome === `error`) fail(sourceError)
        else markReady()
      },
    },
  }))
  const query = new Query()
    .from({ row: descriptor })
    .orderBy(({ row }) => row.id)
  const reads: Array<RuntimeView> = []
  const commits: Array<RuntimeView> = []
  function Consumer() {
    const result =
      hook === `ordinary`
        ? useLiveQuery({ query })
        : useLiveInfiniteQuery(() => query, { pageSize: 1 })
    const view: RuntimeView = {
      rows: result.data.map((row) => row.id),
      status: result.status,
      isReady: result.isReady,
      isLoadingError: result.isLoadingError,
      isCrashed: result.isCrashed,
      isLoading: result.isLoading,
      isIdle: result.isIdle,
    }
    reads.push(view)
    useLayoutEffect(() => {
      commits.push(view)
    })
    return <output data-status={view.status}>{view.rows.join(`,`)}</output>
  }
  const app = (client: DbClient) => (
    <DbProvider client={client}>
      <Consumer />
    </DbProvider>
  )
  const originalWindow = globalThis.window
  const host = document.createElement(`div`)
  let root: Root | undefined
  const recoverableErrors: Array<unknown> = []
  const diagnostics: Array<Array<unknown>> = []
  const consoleError = vi
    .spyOn(console, `error`)
    .mockImplementation((...args: Array<unknown>) => diagnostics.push(args))
  let failure: { error: unknown } | undefined
  const cleanupErrors: Array<unknown> = []
  try {
    // A failed explicit preload is handled by its caller. The ordinary hook
    // subsequently renders status, rather than inventing a programming error.
    const source = server.collection(descriptor)
    if (hook === `infinite`) source.createIndex((row) => row.id)
    await source.preload().catch(() => {})
    vi.stubGlobal(`window`, undefined)
    const html = renderToString(app(server))
    const serverView = reads[0]
    observe(`server view`, serverView)
    observe(`server starts`, starts.server)
    vi.stubGlobal(`window`, originalWindow)
    const transported = JSON.parse(JSON.stringify(server.dehydrate()))
    if (history.serverOutcome === `error`) {
      // A captured error view is transportable markup, not successful initial
      // data. A later explicit preload must still report source failure. Keep
      // the earlier payload so this second demand cannot change the chosen cut.
      let preloadRejected = false
      try {
        await server.preloadLiveQuery({
          query: hook === `ordinary` ? query : query.limit(2).offset(0),
        })
      } catch {
        preloadRejected = true
      }
      observe(`error view preload rejected`, preloadRejected)
      observe(`reach`, `explicit-preload-after-error-view`)
    }
    browser.hydrate(transported)
    if (history.browserPreload) {
      const localSource = browser.collection(descriptor)
      if (hook === `infinite`) localSource.createIndex((row) => row.id)
      await localSource.preload().catch(() => {})
    }
    observe(`pre-hydration starts`, starts.browser)
    reads.length = 0
    commits.length = 0
    host.innerHTML = html
    await act(async () => {
      root = hydrateRoot(host, app(browser), {
        onRecoverableError: (error) => recoverableErrors.push(error),
      })
      await Promise.resolve()
    })

    // Reach records actual calls, not the chosen input alone. Both the first
    // hydration render and a later layout commit must have been observed.
    observe(`hydration rendered`, reads.length > 0)
    observe(`browser committed`, commits.length > 0)
    observe(`browser starts`, starts.browser)
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

    // Inspect the browser's own settled result before the initial comparison,
    // so RED still establishes the neighboring runtime-error surface reached.
    observe(`committed browser view`, commits.at(-1))
    observe(`first hydration view`, reads[0])
    observe(`recoverable errors`, recoverableErrors)
    // React reports attribute-only hydration mismatches through console.error,
    // without invoking onRecoverableError. Preserve that independent signal.
    const hydrationDiagnostics = diagnostics.filter((args) =>
      args.some(
        (value) =>
          typeof value === `string` &&
          /hydrated but|hydration mismatch|server rendered HTML/i.test(value),
      ),
    )
    observe(`hydration diagnostics`, hydrationDiagnostics)
  } catch (error) {
    failure = { error }
  } finally {
    vi.stubGlobal(`window`, originalWindow)
    for (const cleanup of [
      () => act(() => root?.unmount()),
      () => browser.cleanup(),
      () => server.cleanup(),
    ]) {
      try {
        await cleanup()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    host.remove()
    consoleError.mockRestore()
  }
  if (failure) {
    if (cleanupErrors.length)
      throw new AggregateError(
        [failure.error, ...cleanupErrors],
        `SSR runtime view mismatch with secondary cleanup failures`,
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

// Judge the same public facts in the original order. In particular, compare
// the committed browser outcome before the first hydration view. The latter
// must reproduce the recorded server view, whose independent judgment runs first.
function checkRuntimeTrace(
  history: SsrRuntimeErrorHistory,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof expectedSsrRuntimeErrorViews>,
): Verdict {
  const server = trace.find(({ checkpoint }) => checkpoint === `server view`)
  const targets: Record<string, unknown> = {
    [`server view`]: expected.initial,
    [`server starts`]: 1,
    [`error view preload rejected`]: true,
    [`pre-hydration starts`]: Number(history.browserPreload),
    [`hydration rendered`]: true,
    [`browser committed`]: true,
    [`browser starts`]: 1,
    [`committed browser view`]: expected.committed,
    [`first hydration view`]: server?.value,
    [`recoverable errors`]: [],
    [`hydration diagnostics`]: [],
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
  for (const checkpoint of Object.keys(targets)) {
    if (
      checkpoint === `error view preload rejected` &&
      history.serverOutcome !== `error`
    )
      continue
    if (trace.filter((entry) => entry.checkpoint === checkpoint).length !== 1)
      return violation(
        checkpoint,
        `expected one observation`,
        `SSR runtime hydration`,
      )
  }
  return pass
}

for (const hook of [`ordinary`, `infinite`] as const) {
  const law = {
    statement: `An SSR runtime-error view remains readable and survives JSON transport into the first hydration view; the committed browser view follows its own source outcome.`,
    authority: `docs/guides/ssr.md preparation/hydration promises and maintainer runtime-error decision; packages/db/tests/ssr-snapshot-admission-oracle.ts`,
    limits: `Real renderToString, JSON transport and hydrateRoot with ordinary or infinite hooks and empty eager sources; no portable error-object identity or error row-retention claim.`,
  }
  const driver = (
    history: SsrRuntimeErrorHistory,
    observe: (checkpoint: string, value: unknown) => void,
  ) => recordRuntimeHistory(hook, history, observe)
  // Keep the former direct finite replays in addition to the campaign inputs.
  oracleProperty({
    id:
      hook === `ordinary`
        ? `react.ssr-runtime-ordinary.cases`
        : `react.ssr-runtime-infinite.cases`,
    law,
    owns: [
      `src/DbProvider.tsx#DbProvider`,
      `src/useLiveInfiniteQuery.ts#useLiveInfiniteQuery`,
      `src/useLiveQuery.ts#useLiveQuery`,
    ],
    histories: ssrRuntimeErrorExamples,
    model: expectedSsrRuntimeErrorViews,
    driver,
    check: checkRuntimeTrace,
  })
  oracleProperty({
    id: runtimeProperties[hook],
    law,
    owns: [
      `src/DbProvider.tsx#DbProvider`,
      `src/useLiveInfiniteQuery.ts#useLiveInfiniteQuery`,
      `src/useLiveQuery.ts#useLiveQuery`,
    ],
    histories: {
      arbitrary: ssrRuntimeErrorHistoryArbitrary,
      runs: 64,
      fixedSeeds: [2229],
      states: runtimeStates,
      constructed: [
        {
          name: `committed browser`,
          enters: [`browser-commit`],
          build: (history): SsrRuntimeErrorHistory => ({ ...history }),
        },
        {
          name: `cold browser receives server error`,
          enters: [
            `server-error-browser-cold`,
            `explicit-preload-after-error-view`,
          ],
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
    driver,
    check: checkRuntimeTrace,
  })
}
