import { TextEncoder } from 'node:util'
import { afterAll, beforeAll, expect, vi } from 'vitest'
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
  differs,
  oracleProperty,
  pass,
  violation,
} from '../../db/tests/oracle-config'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { peopleQuery } from './ssr-test-utils'
import SsrDbApp from './SsrDbApp.svelte'
import type { Observation, Verdict } from '../../db/tests/oracle-config'
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

const handoffStates = [
  `cold`,
  `query`,
  `source-ready`,
  `source-loading`,
  `rejected`,
  `server-write`,
  `browser-write`,
  `same-query-preload`,
] as const
async function recordHandoff(
  history: SsrSnapshotHistory,
  observe: (checkpoint: string, value: unknown) => void,
) {
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
    observe(`server rejection`, rendered.error)
    observe(`reach`, `rejected`)
    return
  }
  observe(`server error`, rendered.error)
  observe(`browser branch`, typeof window)
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
        observe(`reach`, `same-query-preload`)
      }
      await client.collection(descriptor).preload()
      publish()
      observe(`reach`, `browser-write`)
    }
    if (history.serverWrite && history.sourceState !== `idle`)
      observe(`reach`, `server-write`)
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
    observe(`browser initialization error`, failure)
    observe(
      `first browser view`,
      initial.map((view) => ({
        ...view,
        rows: view.rows.map((row) => ({ ...row })),
      })),
    )
    observe(
      `reach`,
      history.preparation === `query`
        ? `query`
        : history.preparation === `source` && history.sourceState !== `idle`
          ? history.sourceState === `ready`
            ? `source-ready`
            : `source-loading`
          : `cold`,
    )
    flushSync()
    observe(`browser starts`, starts)
  } finally {
    if (app) await unmount(app)
    target.remove()
    await client.cleanup()
  }
}

/**
 * This receiving path keeps one client's transport while native Svelte roots
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
const receivingStates = [
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
] as const

async function recordReceivingHistory(
  history: SsrReceivingHistory,
  observe: (checkpoint: string, value: unknown) => void,
) {
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
  observe(`server error`, rendered.error)

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
  let reader = 0
  const recordView = (view: View | undefined) =>
    view && { ...view, rows: view.rows.map((row) => ({ ...row })) }
  const initialize = async (
    kind: SsrReceivingHistory[`initializationKind`],
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
    observe(`reader initial`, {
      reader,
      initialSnapshots: initial.map(recordView),
    })
    // Bounded to the test's one-second wait: the assertion supplies the
    // authoritative premise, rather than a fixed sleep or a consumed record.
    try {
      await vi.waitFor(() => {
        flushSync()
        expect(
          current,
          `${kind} reaches the authoritative browser view`,
        ).toEqual(views.authoritative)
      })
    } finally {
      observe(`reader authoritative`, { reader, view: recordView(current) })
    }
    observe(`browser starts`, starts)
    reader++
    observe(`reach`, `authoritative-view`)
  }

  try {
    // The real server fixture returns a JSON copy. A second copy here makes
    // the transport boundary explicit for this receiving path too.
    client.hydrate(JSON.parse(JSON.stringify(rendered.state)))
    for (let index = 0; index < history.previousReaders; index++) {
      await initialize(`hydrate`)
      observe(`reach`, `earlier-authoritative`)
      if (index > 0) observe(`reach`, `multiple-earlier-readers`)
    }
    observe(
      `reach`,
      history.initializationKind === `mount`
        ? `fresh-mount`
        : history.previousReaders > 0
          ? `late-hydrate`
          : `first-hydrate`,
    )
    observe(
      `reach`,
      JSON.stringify(history.snapshot.rows) ===
        JSON.stringify(history.browserRows)
        ? `same-rows`
        : `different-rows`,
    )
    observe(
      `reach`,
      serverView.status === `loading`
        ? `loading-server-view`
        : `ready-server-view`,
    )
    if (history.providerNesting === `inherit`)
      observe(
        `reach`,
        history.initializationKind === `hydrate`
          ? `inherited-provider-hydration`
          : `fresh-nested-mount`,
      )
    if (
      history.providerNesting === `marked` &&
      history.initializationKind === `hydrate`
    )
      observe(`reach`, `explicit-provider-hydration`)
    if (
      history.initializationKind === `mount` &&
      history.mountLocation === `child`
    ) {
      observe(`child mount available`, typeof revealLater)
      observe(`reach`, `fresh-child`)
      revealLater!()
      flushSync()
      observe(`reader initial`, {
        reader,
        initialSnapshots: laterInitial.map(recordView),
      })
      try {
        await vi.waitFor(() => {
          flushSync()
          expect(
            laterCurrent,
            `the new child follows the live browser view`,
          ).toEqual(views.authoritative)
        })
      } finally {
        observe(`reader authoritative`, {
          reader,
          view: recordView(laterCurrent),
        })
      }
    } else {
      await initialize(history.initializationKind)
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

function checkHandoff(
  history: SsrSnapshotHistory,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof expectedSsrSnapshot>,
): Verdict {
  const targets: Record<string, unknown> = {
    [`server error`]: undefined,
    [`browser branch`]: `object`,
    [`browser initialization error`]: undefined,
    [`first browser view`]: [{ rows: expected.rows, status: expected.status }],
    [`browser starts`]: 1,
  }
  for (const { checkpoint, value } of trace) {
    if (checkpoint === `reach`) continue
    if (checkpoint === `server rejection`) {
      if (typeof value !== `string` || !/SSR.*(?:preload|hydrat)/i.test(value))
        return violation(
          checkpoint,
          `expected SSR preparation rejection`,
          `SSR browser handoff`,
        )
    } else {
      const wrong = differs(
        checkpoint,
        `SSR browser handoff`,
        value,
        targets[checkpoint],
      )
      if (wrong) return wrong
    }
  }
  for (const checkpoint of expected.rejects
    ? [`server rejection`]
    : Object.keys(targets))
    if (trace.filter((entry) => entry.checkpoint === checkpoint).length !== 1)
      return violation(
        checkpoint,
        `expected one observation`,
        `SSR browser handoff`,
      )
  return pass
}
function checkReceivingHistory(
  history: SsrReceivingHistory,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof expectedSsrReceivingViews>,
): Verdict {
  const serverView = expectedSsrSnapshot(history.snapshot)
  const child =
    history.initializationKind === `mount` && history.mountLocation === `child`
  for (const { checkpoint, value } of trace) {
    if (checkpoint === `reach`) continue
    let actual: unknown = value
    let target: unknown
    if (checkpoint === `server error`) target = undefined
    else if (checkpoint === `child mount available`) target = `function`
    else if (checkpoint === `browser starts`) target = 1
    else if (checkpoint === `reader initial`) {
      const entry = value as {
        reader: number
        initialSnapshots: Array<unknown>
      }
      actual = entry.initialSnapshots
      target = [
        entry.reader < history.previousReaders
          ? { rows: serverView.rows, status: serverView.status }
          : expected.initial,
      ]
    } else if (checkpoint === `reader authoritative`) {
      actual = (value as { view: unknown }).view
      target = expected.authoritative
    } else
      return violation(
        checkpoint,
        `unexpected observation`,
        `SSR receiving readers`,
      )
    const wrong = differs(checkpoint, `SSR receiving readers`, actual, target)
    if (wrong) return wrong
  }
  if (
    trace.filter(({ checkpoint }) => checkpoint === `server error`).length !== 1
  )
    return violation(
      `server error`,
      `expected one observation`,
      `SSR receiving readers`,
    )
  for (let reader = 0; reader <= history.previousReaders; reader++)
    for (const checkpoint of [`reader initial`, `reader authoritative`])
      if (
        trace.filter(
          (entry) =>
            entry.checkpoint === checkpoint &&
            (entry.value as { reader: number }).reader === reader,
        ).length !== 1
      )
        return violation(
          checkpoint,
          `expected every receiving reader`,
          `SSR receiving readers`,
        )
  if (
    trace.filter(({ checkpoint }) => checkpoint === `browser starts`).length !==
    history.previousReaders + Number(!child)
  )
    return violation(
      `browser starts`,
      `expected each initialized root`,
      `SSR receiving readers`,
    )
  if (
    child &&
    !trace.some(({ checkpoint }) => checkpoint === `child mount available`)
  )
    return violation(
      `child mount available`,
      `expected the child receiving cut`,
      `SSR receiving readers`,
    )
  return pass
}
const handoffLaw = {
  statement: `Every admitted Svelte browser initialization reproduces its render-time server rows and status before effects subscribe.`,
  authority: `docs/guides/ssr.md preparation/hydration contract and packages/db/tests/ssr-snapshot-admission-oracle.ts`,
  owner: `packages/db/tests/ssr-snapshot-admission-oracle.ts`,
  limits: `Existing eager source/preparation and write timing grammar at real server compilation and browser hydrate; no asynchronous provider claim.`,
}
oracleProperty({
  id: `svelte.ssr-handoff.cases`,
  law: handoffLaw,
  histories: ssrSnapshotExamples,
  model: expectedSsrSnapshot,
  driver: recordHandoff,
  check: checkHandoff,
})
const handoffConstructions = [
  {
    name: `cold`,
    enters: [`cold`],
    history: { preparation: `none`, sourceState: `idle`, rows: [] },
  },
  {
    name: `query`,
    enters: [`query`],
    history: { preparation: `query`, sourceState: `ready`, rows: [] },
  },
  {
    name: `source ready`,
    enters: [`source-ready`],
    history: { preparation: `source`, sourceState: `ready`, rows: [] },
  },
  {
    name: `source loading`,
    enters: [`source-loading`],
    history: { preparation: `source`, sourceState: `loading`, rows: [] },
  },
  {
    name: `rejected`,
    enters: [`rejected`],
    history: { preparation: `none`, sourceState: `ready`, rows: [] },
  },
  {
    name: `server write`,
    enters: [`server-write`],
    history: {
      preparation: `source`,
      sourceState: `loading`,
      rows: [],
      serverWrite: true,
    },
  },
  {
    name: `browser write`,
    enters: [`browser-write`],
    history: {
      preparation: `source`,
      sourceState: `loading`,
      rows: [],
      browserWrite: true,
    },
  },
  {
    name: `same query preload`,
    enters: [`same-query-preload`],
    history: {
      preparation: `source`,
      sourceState: `loading`,
      rows: [],
      browserWrite: true,
      browserPreload: true,
    },
  },
] satisfies Array<{
  name: string
  enters: Array<string>
  history: SsrSnapshotHistory
}>
oracleProperty({
  id: `svelte.ssr-handoff`,
  law: handoffLaw,
  histories: {
    arbitrary: ssrSnapshotHistoryArbitrary,
    runs: 120,
    fixedSeeds: [2229],
    states: handoffStates,
    constructed: handoffConstructions.map(({ name, enters, history }) => ({
      name,
      enters,
      build: () => history,
    })),
    fixed: ssrSnapshotExamples.map((history, index) => ({
      name: `SSR handoff ${index}`,
      history,
    })),
  },
  model: expectedSsrSnapshot,
  driver: recordHandoff,
  check: checkHandoff,
  timeout: 30_000,
})
const receivingLaw = {
  statement: `Every hydrating reader receives its server view, while a fresh mount receives the current browser view after earlier authoritative readers; each reader then follows that browser view.`,
  authority: `docs/guides/ssr.md per-reader hydration and ordinary browser laws; maintainer decision2026-10-26`,
  owner: `packages/db/tests/ssr-snapshot-admission-oracle.ts`,
  limits: `Existing bounded reader, root/child and provider nesting grammar on native Svelte roots with one shared transported client.`,
}
const receivingConstructions: Array<{
  name: string
  enters: Array<string>
  history: SsrReceivingHistory
}> = [
  {
    name: `first hydrate`,
    enters: [
      `first-hydrate`,
      `same-rows`,
      `loading-server-view`,
      `authoritative-view`,
    ],
    history: {
      snapshot: { preparation: `none`, sourceState: `idle`, rows: [] },
      browserRows: [],
      initializationKind: `hydrate`,
      previousReaders: 0,
    },
  },
  {
    name: `late hydrate`,
    enters: [
      `late-hydrate`,
      `earlier-authoritative`,
      `multiple-earlier-readers`,
      `different-rows`,
      `ready-server-view`,
    ],
    history: { ...ssrReceivingExamples[0]!, previousReaders: 2 },
  },
  {
    name: `fresh mount`,
    enters: [`fresh-mount`],
    history: { ...ssrReceivingExamples[0]!, initializationKind: `mount` },
  },
  {
    name: `fresh child`,
    enters: [`fresh-child`],
    history: {
      ...ssrReceivingExamples[0]!,
      initializationKind: `mount`,
      mountLocation: `child`,
    },
  },
  {
    name: `inherited hydration`,
    enters: [`inherited-provider-hydration`],
    history: { ...ssrReceivingExamples[0]!, providerNesting: `inherit` },
  },
  {
    name: `explicit hydration`,
    enters: [`explicit-provider-hydration`],
    history: { ...ssrReceivingExamples[0]!, providerNesting: `marked` },
  },
  {
    name: `fresh nested mount`,
    enters: [`fresh-nested-mount`],
    history: {
      ...ssrReceivingExamples[0]!,
      initializationKind: `mount`,
      providerNesting: `inherit`,
    },
  },
]
oracleProperty({
  id: `svelte.ssr-receiving-reader.cases`,
  law: receivingLaw,
  histories: ssrReceivingExamples,
  model: expectedSsrReceivingViews,
  driver: recordReceivingHistory,
  check: checkReceivingHistory,
})
oracleProperty({
  id: `svelte.ssr-receiving-reader`,
  law: receivingLaw,
  histories: {
    arbitrary: ssrReceivingHistoryArbitrary,
    runs: 120,
    fixedSeeds: [2229],
    states: receivingStates,
    constructed: receivingConstructions.map(({ name, enters, history }) => ({
      name,
      enters,
      build: () => history,
    })),
  },
  model: expectedSsrReceivingViews,
  driver: recordReceivingHistory,
  check: checkReceivingHistory,
  timeout: 30_000,
})
declareOracle({
  owns: [`src/useLiveQuery.svelte.ts#useLiveQuery`],
  model: [expectedSsrSnapshot, expectedSsrReceivingViews],
  check: [checkHandoff, checkReceivingHistory],
  grammar: [ssrSnapshotHistoryArbitrary, ssrReceivingHistoryArbitrary],
})
