import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { expect, test } from '@playwright/test'
import { ssrStreamHydrationMismatches } from '../../../../packages/db/tests/ssr-stream-view-oracle'
import type { TestInfo } from '@playwright/test'
import type {
  HostHistory,
  HostObservation,
} from './router-stream-driver/fixture'
import type { SsrStreamReaderComparison } from '../../../../packages/db/tests/ssr-stream-view-oracle'

/**
 * Receiving driver for the primary stream-view law, using the real Router
 * serializer, HTML transform, manifest-driven Scripts, RouterClient and Chromium.
 * A query discovered ready during the initial render can appear in shell HTML
 * before its record is inserted after the async client entry. Holding the HTTP
 * sink at that record preserves byte order and exposes that legal network cut.
 *
 * The release gate waits for a browser hook attempt, including a suspended one;
 * equality compares its first successful view after delivery with that reader's
 * recorded server view. Ready-empty, differing browser rows, reader order and a
 * later Suspense reveal distinguish absence from a known pending result. Public
 * close/error controls intentionally omit a required record: they demand failure
 * without false success or a hang. A known pending record's own promise remains
 * valid after the DB stream closes. These controls do not redefine error data.
 */
const packageRoot = fileURLToPath(new URL(`..`, import.meta.url))
const repositoryRoot = path.resolve(packageRoot, `../../..`)
const fixtures = path.join(packageRoot, `e2e/router-stream-driver`)
// Hostile calibration supplies a separate source copy; the checkout is never swapped.
const dbSourceRoot = process.env.ROUTER_STREAM_DB_SOURCE_ROOT ?? repositoryRoot
let output: string
let origin: string
let host: ReturnType<typeof spawn> | undefined
let sequence = 0
const baseHistory: HostHistory = {
  count: 1,
  writes: 0,
  browserWrite: true,
  discovery: `shell`,
  delivery: `normal`,
  transport: `owned`,
}

test.beforeAll(async () => {
  output = await mkdtemp(path.join(tmpdir(), `db-router-stream-`))
  const shared = {
    bundle: true,
    jsx: `automatic` as const,
    alias: {
      '@tanstack/db': path.join(dbSourceRoot, `packages/db/src/index.ts`),
      '@tanstack/react-db': path.join(
        repositoryRoot,
        `packages/react-db/src/index.ts`,
      ),
      '@tanstack/react-router-with-db': path.join(
        repositoryRoot,
        `packages/react-router-with-db/src/index.tsx`,
      ),
      '@tanstack/db-ivm': path.join(
        repositoryRoot,
        `packages/db-ivm/src/index.ts`,
      ),
    },
    // Resolve Router and React from the workspace packages as a normal pnpm
    // install does; DB aliases deliberately exercise fresh production source.
    nodePaths: [
      path.join(repositoryRoot, `node_modules`),
      path.join(repositoryRoot, `packages/react-router-with-db/node_modules`),
      path.join(repositoryRoot, `packages/db/node_modules`),
    ],
    define: { 'process.env.NODE_ENV': `"development"` },
    logLevel: `silent` as const,
  }
  await build({
    ...shared,
    entryPoints: [path.join(fixtures, `client.tsx`)],
    outfile: path.join(output, `client.js`),
    platform: `browser`,
    format: `esm`,
  })
  await build({
    ...shared,
    entryPoints: [path.join(fixtures, `server.tsx`)],
    outfile: path.join(output, `server.cjs`),
    platform: `node`,
    format: `cjs`,
  })
  host = spawn(process.execPath, [path.join(output, `server.cjs`)], {
    env: { ...process.env, ROUTER_STREAM_OUTPUT: output },
    stdio: [`ignore`, `pipe`, `pipe`],
  })
  origin = await new Promise<string>((resolve, reject) => {
    let text = ``
    host!.stdout!.on(`data`, (chunk) => {
      text += String(chunk)
      const ready = text.match(/\{"port":(\d+)\}/)
      if (ready) resolve(`http://127.0.0.1:${ready[1]}`)
    })
    host!.once(`error`, reject)
    host!.once(`exit`, (code) =>
      reject(new Error(`Router stream host exited ${code}`)),
    )
    host!.stderr!.on(`data`, (chunk) => process.stderr.write(chunk))
  })
})
test.afterAll(async () => {
  host?.kill()
  if (output) await rm(output, { recursive: true, force: true })
})

async function attachJson(
  testInfo: TestInfo,
  name: string,
  observations: unknown,
) {
  const target = testInfo.outputPath(`${name}.json`)
  await writeFile(target, JSON.stringify(observations, null, 2))
  await testInfo.attach(name, { path: target, contentType: `application/json` })
}

const firstViews = (observations: ReadonlyArray<HostObservation>) => {
  const views = new Map<string, NonNullable<HostObservation[`view`]>>()
  for (const observation of observations) {
    if (
      observation.type === `view` &&
      observation.reader &&
      observation.view &&
      !views.has(observation.reader)
    ) {
      views.set(observation.reader, observation.view)
    }
  }
  return views
}

for (const history of [
  baseHistory,
  { ...baseHistory, delivery: `held` as const },
  { ...baseHistory, delivery: `held` as const, browserPreload: true },
  { ...baseHistory, count: 0, delivery: `held` as const },
  { ...baseHistory, browserWrite: false, delivery: `held` as const },
  { ...baseHistory, ordinaryFirst: true, delivery: `held` as const },
  { ...baseHistory, ordinaryLast: true, delivery: `held` as const },
  { ...baseHistory, count: 0, ordinaryFirst: true, delivery: `held` as const },
  { ...baseHistory, discovery: `boundary` as const },
  { ...baseHistory, discovery: `boundary` as const, ordinaryLast: true },
]) {
  test(`reproduces each server view ${JSON.stringify(history)}`, async ({
    page,
    request,
  }, testInfo) => {
    const id = String(++sequence)
    const url = `${origin}/?id=${id}&history=${encodeURIComponent(JSON.stringify(history))}`
    await page.goto(url, { waitUntil: `commit` })
    let beforeRelease: Array<HostObservation> = []
    if (history.delivery === `held`) {
      await page.waitForFunction(() =>
        window.streamViews?.some(
          (observation) => observation.type === `attempt`,
        ),
      )
      beforeRelease = await page.evaluate(() => window.streamViews ?? [])
      const waiting = await (
        await request.get(`${origin}/observations?id=${id}`)
      ).json()
      expect(waiting.waiting, `HTTP sink reached the first query record`).toBe(
        true,
      )
      await request.post(`${origin}/release?id=${id}`)
    }
    await page.waitForFunction(() =>
      window.streamViews?.some(
        (observation) =>
          (observation.type === `view` && observation.reader === `suspense`) ||
          observation.type === `boundary-error`,
      ),
    )
    await page.waitForLoadState(`networkidle`)
    const browser = await page.evaluate(() => window.streamViews ?? [])
    const server = (await (
      await request.get(`${origin}/observations?id=${id}`)
    ).json()) as {
      observations: Array<HostObservation>
      chunks: Array<{ text: string }>
    }
    const serverViews = firstViews(server.observations)
    const browserViews = firstViews(browser)
    expect(
      serverViews.has(`suspense`),
      `server reached a successful Suspense view`,
    ).toBe(true)
    const comparisons: Array<SsrStreamReaderComparison> = [...serverViews].map(
      ([reader, view]) => ({
        reader,
        server: view,
        hydration: browserViews.get(reader),
      }),
    )
    await attachJson(testInfo, `stream-receiving-observations`, {
      history,
      beforeRelease,
      server,
      browser,
      comparisons,
    })
    if (history.delivery === `held`) {
      const starts = beforeRelease.filter(
        (observation) => observation.type === `source-start`,
      )
      if (history.browserPreload) {
        expect(
          starts.some((start) => !start.inRender),
          `the authored preload starts its source outside render`,
        ).toBe(true)
        const localVersion = beforeRelease.find(
          (observation) => observation.type === `preload-settled`,
        )?.version
        const serverVersion = browser.find(
          (observation) =>
            observation.type === `db-hydrate` &&
            observation.version !== undefined,
        )?.version
        expect(
          localVersion,
          `local preload settled with a newer version before record delivery`,
        ).toBeGreaterThan(serverVersion!)
      }
      const allBytes = server.chunks.map((chunk) => chunk.text).join(``)
      expect(allBytes.indexOf(`/client.js`)).toBeLessThan(
        allBytes.indexOf(`queryHash`),
      )
      expect(allBytes.indexOf(`data-reader`)).toBeLessThan(
        allBytes.indexOf(`queryHash`),
      )
    }
    expect(
      ssrStreamHydrationMismatches(comparisons),
      `shared per-reader stream refinement`,
    ).toEqual([])
    expect(
      browser.filter((observation) => observation.type === `recoverable-error`),
    ).toEqual([])
    if (history.delivery === `held`) {
      expect(
        beforeRelease.filter((observation) => observation.type === `view`),
        `hydration waits for its server record before returning a view`,
      ).toEqual([])
    }
  })
}

for (const transport of [`empty-close`, `empty-error`] as const) {
  test(`settles an absent record on ${transport}`, async ({
    page,
    request,
  }, testInfo) => {
    const id = String(++sequence)
    const history: HostHistory = { ...baseHistory, transport }
    await page.goto(
      `${origin}/?id=${id}&history=${encodeURIComponent(JSON.stringify(history))}`,
      { waitUntil: `commit` },
    )
    await page.waitForFunction(() =>
      window.streamViews?.some((observation) => observation.type === `attempt`),
    )
    const beforeRelease = await page.evaluate(() => window.streamViews ?? [])
    await request.post(`${origin}/release?id=${id}`)
    try {
      await expect(page.locator(`[data-stream-error]`)).toBeVisible()
    } finally {
      await attachJson(testInfo, `stream-terminal-observations`, {
        history,
        beforeRelease,
        browser: await page.evaluate(() => window.streamViews ?? []),
      })
    }
    const expectedMessage =
      transport === `empty-close`
        ? `Error: The DB stream ended before the server-rendered query snapshot arrived.`
        : `Error: stream transport failed`
    await expect
      .poll(async () =>
        (await page.evaluate(() => window.streamViews ?? []))
          .filter((observation) => observation.type === `boundary-error`)
          .map((observation) => observation.message),
      )
      .toContain(expectedMessage)
    const browser = await page.evaluate(() => window.streamViews ?? [])
    expect(
      browser.filter((observation) => observation.type === `view`),
      `missing required server view cannot become browser success`,
    ).toEqual([])
    const terminal = browser.find(
      (observation) => observation.type === `stream-ended`,
    )
    expect(terminal, `the transport supplied its terminal signal`).toBeDefined()
    expect(
      browser.filter(
        (observation) =>
          observation.type === `source-start` && observation.at > terminal!.at,
      ),
      `terminal failure cannot start new acquisition`,
    ).toEqual([])
  })
}

test(`keeps a known pending result alive after its DB stream closes`, async ({
  page,
  request,
}, testInfo) => {
  const id = String(++sequence)
  const history: HostHistory = { ...baseHistory, transport: `pending-close` }
  await page.goto(
    `${origin}/?id=${id}&history=${encodeURIComponent(JSON.stringify(history))}`,
    { waitUntil: `commit` },
  )
  await page.waitForFunction(
    () =>
      window.streamViews?.some(
        (observation) =>
          observation.type === `db-hydrate` && observation.pending,
      ) && !window.streamFixture.client._isSsrStreamingEnabled(),
  )
  await page.evaluate(async () => {
    void window.streamFixture.prepareBrowser().catch(() => {})
    await window.streamFixture.prepareBrowserSource()
  })
  await page.waitForFunction(() =>
    window.streamViews?.some(
      (observation) => observation.type === `source-start`,
    ),
  )
  const beforeRelease = await page.evaluate(() => window.streamViews ?? [])
  await attachJson(testInfo, `pending-before-release`, {
    history,
    beforeRelease,
  })
  expect(
    beforeRelease.some((observation) => observation.type === `source-start`),
  ).toBe(true)
  expect(
    beforeRelease.some(
      (observation) =>
        observation.type === `result-settled` ||
        observation.type === `preload-settled` ||
        observation.type === `preload-rejected`,
    ),
    `the known server result remains pending during local source acquisition`,
  ).toBe(false)
  expect(
    beforeRelease.filter(
      (observation) => observation.type === `result-rejected`,
    ),
  ).toEqual([])
  await request.post(`${origin}/release?id=${id}`)
  await page.waitForFunction(() =>
    window.streamViews?.some(
      (observation) =>
        observation.type === `view` || observation.type === `boundary-error`,
    ),
  )
  const browser = await page.evaluate(() => window.streamViews ?? [])
  const server = (await (
    await request.get(`${origin}/observations?id=${id}`)
  ).json()) as { observations: Array<HostObservation> }
  const comparisons = [...firstViews(server.observations)].map(
    ([reader, view]) => ({
      reader,
      server: view,
      hydration: firstViews(browser).get(reader),
    }),
  )
  await attachJson(testInfo, `pending-result-observations`, {
    history,
    beforeRelease,
    server,
    browser,
  })
  expect(ssrStreamHydrationMismatches(comparisons)).toEqual([])
  expect(
    browser.filter(
      (observation) =>
        observation.type === `result-rejected` ||
        observation.type === `recoverable-error`,
    ),
  ).toEqual([])
})
