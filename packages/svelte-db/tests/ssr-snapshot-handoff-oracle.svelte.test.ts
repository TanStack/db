import { TextEncoder } from 'node:util'
import { fc } from '@fast-check/vitest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { flushSync, hydrate, unmount } from 'svelte'
import { BTreeIndex, DbClient, collectionOptions } from '@tanstack/db'
import {
  expectedSsrSnapshot,
  ssrSnapshotExamples,
  ssrSnapshotHistoryArbitrary,
} from '../../db/tests/ssr-snapshot-admission-oracle'
import { oraclePropertyOptions, oracleRuns } from '../../db/tests/oracle-config'
import { createOracleReach } from '../../db/tests/oracle-reach'
import { peopleQuery } from './ssr-test-utils'
import SsrDbApp from './SsrDbApp.svelte'
import type { createServer } from 'vite'
import type { renderSsrSnapshotHistory } from './ssr-snapshot-fixture'
import type { SsrSnapshotHistory } from '../../db/tests/ssr-snapshot-admission-oracle'

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
