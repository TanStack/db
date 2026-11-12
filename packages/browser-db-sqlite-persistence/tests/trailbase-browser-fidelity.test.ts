// @vitest-environment node
/** Supplemental recorder calibration; all product answers use shared checks. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { hydrationLifecycleVerdict } from '../../trailbase-db-collection/tests/lifecycle-hydration-oracle-suite'
import {
  constructTrailBaseEagerHistory,
  trailBaseEagerVerdict,
} from '../../trailbase-db-collection/tests/eager-live-source-framework-oracle'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from './adapter-chromium-host'
import type { HydrationLifecycleObservation } from '../../trailbase-db-collection/tests/lifecycle-hydration-oracle'
import type { EagerHistoryResult } from '../../trailbase-db-collection/tests/eager-live-source-framework-oracle'
import type { EagerLiveSourceHistory } from '../../db-adapter-conformance/src'

let host: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  host = await startAdapterChromium()
}, 120000)
afterAll(async () => {
  await host?.close()
})
let sequence = 0
async function emitBrowserError() {
  const received = host!.page.waitForEvent(`pageerror`)
  await host!.page.evaluate(() => {
    setTimeout(() => {
      throw new Error(`calibrated detached browser error`)
    }, 0)
  })
  await received
}

it(`preserves hydration failure and limits browser errors to their history`, async () => {
  const history = {
    previous: 3,
    old: 1,
    replacement: 6,
    oldList: `complete` as const,
    resumeAt: `replacement-ready` as const,
    initialRender: `default` as const,
  }
  const receive = (corruptRows: boolean, pageError: boolean) =>
    captureBrowserHistory(host!, async () => {
      const raw = await host!.page.evaluate(
        async ({ history: h, id }) => {
          return (
            window as unknown as {
              runTrailBaseHydration: (
                history: typeof h,
                id: string,
              ) => Promise<HydrationLifecycleObservation>
            }
          ).runTrailBaseHydration(h, id)
        },
        { history, id: `fidelity-${sequence++}` },
      )
      if (pageError) await emitBrowserError()
      return corruptRows
        ? {
            ...raw,
            retiredResume: { ...raw.retiredResume, rows: [] },
          }
        : raw
    })
  const judge = (value: Awaited<ReturnType<typeof receive>>) =>
    hydrationLifecycleVerdict(history, [{ checkpoint: `completed`, value }], [])
  const primary = judge(await receive(true, false))
  const simultaneous = judge(await receive(true, true))
  expect(primary.kind).toBe(`violation`)
  expect(simultaneous).toMatchObject({
    kind: primary.kind,
    ...(primary.kind === `violation`
      ? { law: primary.law, checkpoint: primary.checkpoint }
      : {}),
  })
  if (simultaneous.kind === `violation`)
    expect(simultaneous.difference).toContain(
      `secondary browser errors: calibrated detached browser error`,
    )
  expect(judge(await receive(false, true))).toMatchObject({
    kind: `violation`,
    law: `detached-browser-error`,
    checkpoint: `browser`,
  })
  await emitBrowserError()
  expect(judge(await receive(false, false))).toMatchObject({
    kind: `violation`,
    law: `detached-browser-error`,
    checkpoint: `browser`,
  })
  expect(judge(await receive(false, false))).toEqual({ kind: `pass` })
}, 120000)

it(`preserves eager failure and limits browser errors to their history`, async () => {
  const history = constructTrailBaseEagerHistory([], 0)
  const receive = (corruptValues: boolean, pageError: boolean) =>
    captureBrowserHistory(host!, async () => {
      const raw = await host!.page.evaluate(
        async ({ history: h, corruptValues: corrupt }) => {
          return (
            window as unknown as {
              runTrailBaseEager: (
                history: EagerLiveSourceHistory,
                corrupt: boolean,
              ) => Promise<EagerHistoryResult>
            }
          ).runTrailBaseEager(h, corrupt)
        },
        { history, corruptValues },
      )
      if (pageError) await emitBrowserError()
      return raw
    })
  const judge = (value: Awaited<ReturnType<typeof receive>>) =>
    trailBaseEagerVerdict([{ checkpoint: `completed`, value }], [])
  const primary = judge(await receive(true, false))
  const simultaneous = judge(await receive(true, true))
  expect(primary.kind).toBe(`violation`)
  expect(simultaneous).toMatchObject({
    kind: primary.kind,
    ...(primary.kind === `violation`
      ? { law: primary.law, checkpoint: primary.checkpoint }
      : {}),
  })
  if (simultaneous.kind === `violation`)
    expect(simultaneous.difference).toContain(
      `secondary browser errors: calibrated detached browser error`,
    )
  expect(judge(await receive(false, true))).toMatchObject({
    kind: `violation`,
    law: `detached-browser-error`,
    checkpoint: `browser`,
  })
  await emitBrowserError()
  expect(judge(await receive(false, false))).toMatchObject({
    kind: `violation`,
    law: `detached-browser-error`,
    checkpoint: `browser`,
  })
  expect(judge(await receive(false, false))).toEqual({ kind: `pass` })
}, 120000)

it(`rejects a browser error during receiver startup`, async () => {
  await expect(
    startAdapterChromium({
      entry: `/packages/browser-db-sqlite-persistence/e2e/trailbase-bootstrap-error.html`,
    }),
  ).rejects.toThrow(`Browser startup failed: calibrated bootstrap error`)
}, 120000)

it(`keeps loaded receiving modules stable when an imported file changes`, async () => {
  const directory = await mkdtemp(join(tmpdir(), `db-receiving-isolation-`))
  let isolated: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
  await withOracleCleanup(async () => {
    const imported = join(directory, `value.js`)
    await Promise.all([
      writeFile(
        join(directory, `index.html`),
        `<script type="module" src="./entry.js"></script>`,
      ),
      writeFile(
        join(directory, `entry.js`),
        `import { value } from './value.js'; window.receivingFixtureValue = value`,
      ),
      writeFile(imported, `export const value = 1`),
    ])
    isolated = await startAdapterChromium({
      entry: `/@fs${directory}/index.html`,
      ready: `receivingFixtureValue`,
      allow: [directory],
    })
    // This positive watcher observation prevents a delayed reload from making
    // a short negative browser check pass when watching is still enabled.
    expect(isolated.watchedPaths()).toEqual({})
    await isolated.page.evaluate(() => {
      Object.assign(window, { receivingFixtureIdentity: `original-page` })
    })
    await writeFile(imported, `export const value = 2`)
    expect(await readFile(imported, `utf8`)).toContain(`value = 2`)
    await isolated.page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        }),
    )
    expect(
      await isolated.page.evaluate(() => {
        const fixture = window as unknown as {
          receivingFixtureValue: number
          receivingFixtureIdentity: string
        }
        return [fixture.receivingFixtureValue, fixture.receivingFixtureIdentity]
      }),
    ).toEqual([1, `original-page`])
  }, [
    () => isolated?.close(),
    () => rm(directory, { recursive: true, force: true }),
  ])
}, 120000)
