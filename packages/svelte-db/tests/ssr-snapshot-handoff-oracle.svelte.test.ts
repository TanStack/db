import { TextEncoder } from 'node:util'
import { fc } from '@fast-check/vitest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { flushSync, hydrate, mount, unmount } from 'svelte'
import { BTreeIndex, DbClient, collectionOptions } from '@tanstack/db'
import {
  expectedSsrReceivingViews,
  expectedSsrSnapshot,
  ssrReceivingExamples,
  ssrReceivingHistoryArbitrary,
  ssrSnapshotExamples,
  ssrSnapshotHistoryArbitrary,
} from '../../db/tests/ssr-snapshot-admission-oracle'
import {
  oraclePropertyOptions,
  oracleReplayRequested,
  oracleRuns,
} from '../../db/tests/oracle-config'
import { createOracleReach } from '../../db/tests/oracle-reach'
import { peopleQuery } from './ssr-test-utils'
import SsrDbApp from './SsrDbApp.svelte'
import type { createServer } from 'vite'
import type { renderSsrSnapshotHistory } from './ssr-snapshot-fixture'
import type {
  SsrReceivingHistory,
  SsrSnapshotHistory,
} from '../../db/tests/ssr-snapshot-admission-oracle'

/**
 * The shared snapshot judgment predicts the view at server render and the first
 * browser initialization, before browser effects subscribe. Vite supplies a real
 * server compilation for the first host and this test's Svelte plugin supplies
 * a real browser compilation for hydrate(). Only serialized transport crosses.
 * The component records its first public hook rows/status before effects, so
 * a later successful commit cannot hide an initial mismatch. Source writes may
 * occur between render/dehydrate and between hydrate(state)/browser mount.
 */
let server: Awaited<ReturnType<typeof createServer>>
let renderServer: typeof renderSsrSnapshotHistory
beforeAll(async () => {
  // jsdom's typed arrays have a different realm from Node's encoder. Vite's
  // esbuild boundary requires an encoder returning this host's Uint8Array.
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
    .renderSsrSnapshotHistory
}, 30_000)
afterAll(async () => {
  await server.close()
})

const makeReach = () =>
  createOracleReach(`svelte-actual-handoff`, [
    `cold`,
    `query`,
    `source-ready`,
    `source-loading`,
    `rejected`,
    `server-write`,
    `browser-write`,
    `same-query-preload`,
  ])
async function check(
  history: SsrSnapshotHistory,
  reach: ReturnType<typeof makeReach>,
) {
  reach.beginHistory()
  const expected = expectedSsrSnapshot(history)
  const browserWindow = globalThis.window
  let rendered: Awaited<ReturnType<typeof renderServer>>
  vi.stubGlobal(`window`, undefined)
  try {
    rendered = await renderServer(history)
  } finally {
    vi.stubGlobal(`window`, browserWindow)
  }
  if (expected.rejects) {
    expect(rendered.error, `server rejects unsupported markup`).toMatch(
      /SSR.*(?:preload|hydrat)/i,
    )
    reach.reach(`rejected`)
    return
  }
  expect(rendered.error).toBeUndefined()
  expect(typeof window, `receiving host uses the browser branch`).toBe(`object`)
  const client = new DbClient()
  let starts = 0,
    publish = () => {}
  const descriptor = collectionOptions(`svelte-ssr-people`, () => ({
    id: `svelte-ssr-people`,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    getKey: (row: { id: string; name: string; sourcePayload: string }) =>
      row.id,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        starts++
        begin()
        for (const row of history.rows)
          write({
            type: `insert`,
            value: {
              ...row,
              name: `browser ${row.id}`,
              sourcePayload: `browser`,
            },
          })
        commit()
        publish = () => {
          begin()
          write({
            type: `insert`,
            value: {
              id: `late`,
              name: `late browser`,
              sourcePayload: `browser`,
            },
          })
          commit()
        }
        markReady()
      },
    },
  }))
  const initial: Array<{
    rows: Array<{ id: string; name: string }>
    status: string
  }> = []
  const target = document.createElement(`div`)
  target.innerHTML = rendered.html!
  document.body.append(target)
  let app: ReturnType<typeof hydrate> | undefined
  try {
    client.hydrate(rendered.state)
    if (history.browserWrite) {
      if (history.browserPreload) {
        await client.preloadLiveQuery(peopleQuery(descriptor))
        reach.reach(`same-query-preload`)
      }
      await client.collection(descriptor).preload()
      publish()
      reach.reach(`browser-write`)
    }
    if (history.serverWrite && history.sourceState !== `idle`)
      reach.reach(`server-write`)
    let failure: unknown
    try {
      app = hydrate(SsrDbApp, {
        target,
        props: {
          client,
          descriptor,
          hydrating: true,
          onInitial: (
            rows: Array<{ id: string; name: string }>,
            status: string,
          ) => initial.push({ rows, status }),
        },
      })
    } catch (error) {
      failure = error
    }
    expect(failure, `real browser initialization remains legal`).toBeUndefined()
    expect(initial, `real browser hook matches the render-time model`).toEqual([
      { rows: expected.rows, status: expected.status },
    ])
    reach.reach(
      history.preparation === `query`
        ? `query`
        : history.preparation === `source` && history.sourceState !== `idle`
          ? history.sourceState === `ready`
            ? `source-ready`
            : `source-loading`
          : `cold`,
    )
    flushSync()
    expect(starts, `browser commit starts or reuses one source`).toBe(1)
  } finally {
    if (app) await unmount(app)
    target.remove()
    await client.cleanup()
  }
}

describe(`Svelte real SSR handoff`, () => {
  for (const history of ssrSnapshotExamples)
    it(`replays ${history.preparation}/${history.sourceState}/${history.rows.length} server-write=${!!history.serverWrite} browser-write=${!!history.browserWrite}`, () =>
      check(history, makeReach()))
  for (const campaign of [`fixed`, `random`] as const)
    it(`matches the actual browser initialization (${campaign})`, async () => {
      const reach = makeReach()
      await fc.assert(
        fc.asyncProperty(ssrSnapshotHistoryArbitrary, (history) =>
          check(history, reach),
        ),
        {
          ...(campaign === `fixed`
            ? { numRuns: oracleRuns(120), seed: 2229 }
            : oraclePropertyOptions(120, `svelte.ssr-handoff`)),
          examples: ssrSnapshotExamples.map((history) => [history]),
        },
      )
      reach.assertReached()
      console.info(
        `svelte-actual-handoff ${campaign}`,
        Object.fromEntries(reach.counts()),
      )
    }, 30_000)
})

/**
 * This receiving lane keeps one client's transport while native Svelte roots
 * initialize at different times. It reuses the shared preparation judgment and
 * receiving-history grammar. Only initialization kind changes the initial-view
 * obligation: hydrate() must reproduce its server markup; mount() must read
 * current browser rows after an earlier root's authoritative publication.
 *
 * Earlier roots stay mounted. Their pre-effect observations prove the handoff
 * finished before the next root initializes. onInitial runs in construction,
 * before subscribing effects, and onSnapshot records later public rows/status.
 * Every root also reaches the authoritative observation, so preserving a seed
 * forever cannot satisfy the comparison. No private hydration flag or query
 * record supplies the expected answer or controls the tested host path.
 */
const makeReceivingReach = () =>
  createOracleReach(`svelte-receiving-reader`, [
    `first-hydrate`,
    `late-hydrate`,
    `fresh-mount`,
    `fresh-child`,
    `inherited-provider-hydration`,
    `explicit-provider-hydration`,
    `fresh-nested-mount`,
    `earlier-authoritative`,
    `multiple-earlier-readers`,
    `same-rows`,
    `different-rows`,
    `loading-server-view`,
    `ready-server-view`,
    `authoritative-view`,
  ])

async function checkReceivingHistory(
  history: SsrReceivingHistory,
  reach: ReturnType<typeof makeReceivingReach>,
) {
  reach.beginHistory()
  const views = expectedSsrReceivingViews(history)
  const serverView = expectedSsrSnapshot(history.snapshot)
  const browserWindow = globalThis.window
  let rendered: Awaited<ReturnType<typeof renderServer>>
  vi.stubGlobal(`window`, undefined)
  try {
    rendered = await renderServer(history.snapshot, history.providerNesting)
  } finally {
    vi.stubGlobal(`window`, browserWindow)
  }
  expect(
    rendered.error,
    `every receiving history prepares legal markup`,
  ).toBeUndefined()

  const client = new DbClient()
  let starts = 0
  const descriptor = collectionOptions(`svelte-ssr-people`, () => ({
    id: `svelte-ssr-people`,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    getKey: (row: { id: string; name: string; sourcePayload: string }) =>
      row.id,
    sync: {
      sync: ({ begin, truncate, write, commit, markReady }) => {
        starts++
        // This source supplies a complete authoritative browser snapshot,
        // including removals from normalized server rows.
        begin()
        truncate()
        for (const row of history.browserRows)
          write({ type: `insert`, value: { ...row, sourcePayload: `browser` } })
        commit()
        markReady()
      },
    },
  }))
  const roots: Array<{
    app: ReturnType<typeof hydrate>
    target: HTMLDivElement
  }> = []
  const laterInitial: Array<{
    rows: SsrSnapshotHistory[`rows`]
    status: string
  }> = []
  let laterCurrent: (typeof laterInitial)[number] | undefined
  let revealLater: (() => void) | undefined
  let failure: { error: unknown } | undefined
  const cleanupErrors: Array<unknown> = []
  type View = { rows: SsrSnapshotHistory[`rows`]; status: string }
  const initialize = async (
    kind: SsrReceivingHistory[`initializationKind`],
    expectedInitial: View,
  ) => {
    const target = document.createElement(`div`)
    if (kind === `hydrate`) target.innerHTML = rendered.html!
    document.body.append(target)
    const initial: Array<View> = []
    let current: View | undefined
    try {
      const app = (kind === `hydrate` ? hydrate : mount)(SsrDbApp, {
        target,
        props: {
          client,
          descriptor,
          hydrating: kind === `hydrate`,
          providerNesting: history.providerNesting,
          onInitial: (rows: View[`rows`], status: string) =>
            initial.push({ rows, status }),
          onSnapshot: (rows: View[`rows`], status: string) => {
            current = { rows, status }
          },
          registerLaterMount: (mountLater: () => void) => {
            revealLater = mountLater
          },
          onLaterInitial: (rows: View[`rows`], status: string) =>
            laterInitial.push({ rows, status }),
          onLaterSnapshot: (rows: View[`rows`], status: string) => {
            laterCurrent = { rows, status }
          },
        },
      })
      roots.push({ app, target })
    } catch (error) {
      target.remove()
      throw error
    }
    expect(initial, `${kind} first hook view before effects`).toEqual([
      expectedInitial,
    ])
    // Bounded to the test's one-second wait: the assertion supplies the
    // authoritative premise, rather than a fixed sleep or a consumed record.
    await vi.waitFor(() => {
      flushSync()
      expect(current, `${kind} reaches the authoritative browser view`).toEqual(
        views.authoritative,
      )
    })
    expect(starts, `all roots reuse the same browser source`).toBe(1)
    reach.reach(`authoritative-view`)
  }

  try {
    // The real server fixture returns a JSON copy. A second copy here makes
    // the transport boundary explicit for this receiving lane too.
    client.hydrate(JSON.parse(JSON.stringify(rendered.state)))
    for (let index = 0; index < history.previousReaders; index++) {
      await initialize(`hydrate`, {
        rows: serverView.rows,
        status: serverView.status,
      })
      reach.reach(`earlier-authoritative`)
      if (index > 0) reach.reach(`multiple-earlier-readers`)
    }
    reach.reach(
      history.initializationKind === `mount`
        ? `fresh-mount`
        : history.previousReaders > 0
          ? `late-hydrate`
          : `first-hydrate`,
    )
    reach.reach(
      JSON.stringify(history.snapshot.rows) ===
        JSON.stringify(history.browserRows)
        ? `same-rows`
        : `different-rows`,
    )
    reach.reach(
      serverView.status === `loading`
        ? `loading-server-view`
        : `ready-server-view`,
    )
    if (history.providerNesting === `inherit`)
      reach.reach(
        history.initializationKind === `hydrate`
          ? `inherited-provider-hydration`
          : `fresh-nested-mount`,
      )
    if (
      history.providerNesting === `marked` &&
      history.initializationKind === `hydrate`
    )
      reach.reach(`explicit-provider-hydration`)
    if (
      history.initializationKind === `mount` &&
      history.mountLocation === `child`
    ) {
      expect(
        revealLater,
        `the earlier root exposes its child mount`,
      ).toBeTypeOf(`function`)
      reach.reach(`fresh-child`)
      revealLater!()
      flushSync()
      expect(
        laterInitial,
        `a child added after hydration reads live rows`,
      ).toEqual([views.initial])
      await vi.waitFor(() => {
        flushSync()
        expect(
          laterCurrent,
          `the new child follows the live browser view`,
        ).toEqual(views.authoritative)
      })
    } else {
      await initialize(history.initializationKind, views.initial)
    }
  } catch (error) {
    failure = { error }
  } finally {
    for (const { app, target } of roots.reverse()) {
      try {
        await unmount(app)
      } catch (error) {
        cleanupErrors.push(error)
      } finally {
        target.remove()
      }
    }
    try {
      await client.cleanup()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (failure) {
    if (cleanupErrors.length)
      throw new AggregateError(
        [failure.error, ...cleanupErrors],
        `SSR receiving view mismatch with secondary cleanup failures`,
        { cause: failure.error },
      )
    throw failure.error
  }
  if (cleanupErrors.length)
    throw new AggregateError(cleanupErrors, `SSR receiving root cleanup failed`)
}

describe(`Svelte SSR receiving readers`, () => {
  for (const history of ssrReceivingExamples)
    it.skipIf(oracleReplayRequested())(
      `replays ${history.initializationKind} ${history.mountLocation ?? `root`} after ${history.previousReaders} readers with ${history.snapshot.sourceState}/${history.snapshot.rows.length} server rows nesting=${history.providerNesting ?? `none`}`,
      () => checkReceivingHistory(history, makeReceivingReach()),
    )

  const campaign = async (fixed: boolean) => {
    const reach = makeReceivingReach()
    try {
      await fc.assert(
        fc.asyncProperty(ssrReceivingHistoryArbitrary, (history) =>
          checkReceivingHistory(history, reach),
        ),
        fixed
          ? { numRuns: oracleRuns(120), seed: 2229 }
          : oraclePropertyOptions(120, `svelte.ssr-receiving-reader`),
      )
      reach.assertReached()
    } finally {
      console.info(
        `svelte-receiving-reader ${fixed ? `fixed` : `random`}`,
        Object.fromEntries(reach.counts()),
      )
    }
  }
  it.skipIf(oracleReplayRequested())(
    `preserves each receiving reader view (fixed)`,
    () => campaign(true),
    30_000,
  )
  it(
    `preserves each receiving reader view (random)`,
    () => campaign(false),
    30_000,
  )
})
