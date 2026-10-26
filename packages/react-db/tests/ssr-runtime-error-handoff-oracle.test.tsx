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
import { fc } from '@fast-check/vitest'
import { useLayoutEffect } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
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
import { DbProvider } from '../src/DbProvider'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
import { useLiveQuery } from '../src/useLiveQuery'
import type { SsrRuntimeErrorHistory } from '../../db/tests/ssr-snapshot-admission-oracle'
import type { Root } from 'react-dom/client'

type RuntimeView = {
  rows: Array<string>
  status: string
  isReady: boolean
  isError: boolean
  isLoading: boolean
  isIdle: boolean
}
type Hook = `ordinary` | `infinite`

const runtimeProperties = {
  ordinary: `react.ssr-runtime-ordinary`,
  infinite: `react.ssr-runtime-infinite`,
} as const

function runtimeReach(hook: Hook) {
  return createOracleReach(`react-ssr-runtime-${hook}`, [
    `server-error-browser-cold`,
    `server-ready-browser-failed-before-hydration`,
    `server-error-browser-ready-before-hydration`,
    `matching-ready`,
    `matching-error`,
    `undefined-cause`,
    `defined-cause`,
    `browser-commit`,
    `explicit-preload-after-error-view`,
  ])
}

async function checkRuntimeHistory(
  hook: Hook,
  history: SsrRuntimeErrorHistory,
  reach: ReturnType<typeof runtimeReach>,
) {
  reach.beginHistory()
  const expected = expectedSsrRuntimeErrorViews(history)
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
      sync: ({ markReady, markError }) => {
        const runtime = owner === server ? `server` : `browser`
        starts[runtime]++
        const outcome =
          runtime === `server` ? history.serverOutcome : history.browserOutcome
        if (outcome === `error`) markError(sourceError)
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
      isError: result.isError,
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
    expect(serverView, `authored server outcome remains readable`).toEqual(
      expected.initial,
    )
    expect(
      starts.server,
      `server preparation starts exactly one sync run`,
    ).toBe(1)
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
      expect(
        preloadRejected,
        `an error view cannot fulfill a data preload`,
      ).toBe(true)
      reach.reach(`explicit-preload-after-error-view`)
    }
    browser.hydrate(transported)
    if (history.browserPreload) {
      const localSource = browser.collection(descriptor)
      if (hook === `infinite`) localSource.createIndex((row) => row.id)
      await localSource.preload().catch(() => {})
    }
    expect(starts.browser, `pre-hydration startup is controlled`).toBe(
      Number(history.browserPreload),
    )
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
    expect(reads.length, `hydrateRoot reached the public hook`).toBeGreaterThan(
      0,
    )
    expect(
      commits.length,
      `React committed the browser subscription`,
    ).toBeGreaterThan(0)
    expect(starts.browser, `committed demand starts browser sync`).toBe(1)
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

    // Inspect the browser's own settled result before the initial comparison,
    // so RED still establishes the neighboring runtime-error surface reached.
    expect(
      commits.at(-1),
      `committed browser outcome is not the server seed`,
    ).toEqual(expected.committed)
    expect(
      reads[0],
      `first hydration view reproduces actual server output`,
    ).toEqual(serverView)
    expect(
      recoverableErrors,
      `React did not recover mismatched markup`,
    ).toEqual([])
    // React reports attribute-only hydration mismatches through console.error,
    // without invoking onRecoverableError. Preserve that independent signal.
    const hydrationDiagnostics = diagnostics.filter((args) =>
      args.some(
        (value) =>
          typeof value === `string` &&
          /hydrated but|hydration mismatch|server rendered HTML/i.test(value),
      ),
    )
    expect(
      hydrationDiagnostics,
      `React received equal status attributes`,
    ).toEqual([])
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

describe(`runtime errors across SSR hydration`, () => {
  for (const hook of [`ordinary`, `infinite`] as const) {
    for (const history of ssrRuntimeErrorExamples)
      it.skipIf(oracleReplayRequested())(
        `${hook} runtime ${history.serverOutcome}/${history.browserOutcome} preload=${history.browserPreload} cause=${history.definedError}`,
        () => checkRuntimeHistory(hook, history, runtimeReach(hook)),
      )
    for (const campaign of [`fixed`, `random`] as const) {
      const run = campaign === `fixed` ? it.skipIf(oracleReplayRequested()) : it
      run(
        `${hook} preserves runtime error hydration views (${campaign})`,
        async () => {
          const reach = runtimeReach(hook)
          try {
            await fc.assert(
              fc.asyncProperty(ssrRuntimeErrorHistoryArbitrary, (history) =>
                checkRuntimeHistory(hook, history, reach),
              ),
              {
                ...(campaign === `fixed`
                  ? { numRuns: oracleRuns(64), seed: 2229 }
                  : oraclePropertyOptions(64, runtimeProperties[hook])),
                examples: ssrRuntimeErrorExamples.map((history) => [history]),
              },
            )
            reach.assertReached()
          } finally {
            console.info(
              `react-ssr-runtime ${hook} ${campaign}`,
              Object.fromEntries(reach.counts()),
            )
          }
        },
      )
    }
  }
})
