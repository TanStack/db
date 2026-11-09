// @vitest-environment node
/**
 * Chromium production driver for the OPFS open outcome oracle in
 * `tests/opfs-open-outcome-oracle.ts`. A consumer app installs the built
 * package, and a Vite dev server pre-bundles it, so every open runs the asset
 * lookup. Dev-server middleware resolves, holds, or fails that lookup and can
 * fail the worker script or the real worker's WASM fetch. A page init script
 * can make the Worker constructor refuse to start, as a browser does for a
 * worker it will not run. Reach is recorded at the boundaries the driver
 * controls: the dev server counts lookup and WASM file requests, and the page
 * probe counts Worker constructor calls.
 *
 * Interruptions use no wall-clock timing. An init script holds back the
 * opener's deadline timer, recognized by its unique delay, and the driver fires
 * it explicitly; every other page timer runs normally. The driver
 * interrupts only after the middleware reports the lookup held, reads the
 * settlement one task after the interruption, and counts workers one task after
 * the released lookup's module loads in the page. Every history uses a new
 * browser context, because a document caches a failed module fetch and a
 * context shares its HTTP cache and OPFS storage.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as vite8 from 'vite'
import * as vite7 from 'vite-7'
import { readOracleRunConfig } from '../../db/tests/oracle-config'
import {
  describeHistory,
  expectOpenOutcome,
  openHistories,
  reachedOutcomes,
} from '../tests/opfs-open-outcome-oracle'
import { createPackagedConsumer, probeWorkers } from './packaged-consumer'
import type { Browser } from '@playwright/test'
import type { ViteDevServer } from 'vite'
import type {
  AssetLookup,
  OpenDriverReach,
  OpenHistory,
  OpenObservation,
  OpenSettlement,
  WasmLoad,
} from '../tests/opfs-open-outcome-oracle'
import type { BrowserWASQLiteDatabase } from '../src'
import type { ProbeGlobal } from './packaged-consumer'

const chromiumReach: OpenDriverReach = {
  lookup: [`resolves`, `held`, `fails`],
  workerStart: [`starts`, `throws`, `fails to load`],
  wasm: [`loads`, `fails`, `held`],
  init: [`answers`],
  interrupt: [`none`, `deadline`, `abort`],
}
// Under Vite 8 the dev server never receives the asset lookup, so the lookup
// states are declared for Vite 7 only. Authority: maintainer decision on
// TanStack/db#2371 (2026-11-08).
const vite8Reach: OpenDriverReach = {
  ...chromiumReach,
  lookup: [`not needed`],
}
const historiesByVite = {
  7: openHistories(chromiumReach),
  8: openHistories(vite8Reach),
}
// A held lookup that never reaches the dev server fails the history here, in
// seconds, rather than waiting for the test timeout.
// A liveness bound on a lookup that never comes. It is scaled by the run
// multiplier like the run counts, and it decides no observation: a lookup that
// arrives in time is recorded by the reached witness either way.
const heldLookupWaitMs = 10_000 * readOracleRunConfig().multiplier
// A delay no other page timer uses, so the init script can hold it back.
const deadlineMs = 987_654
const wasmLookup = `/@id/@tanstack/browser-db-sqlite-persistence/wa-sqlite.wasm`

type OracleProbe = ProbeGlobal & {
  elapseDeadline: () => void
  controller: AbortController
  settled: Promise<void>
  settlement?: OpenSettlement
  database?: BrowserWASQLiteDatabase
}

// Dev-server premises for the current history.
const premises: {
  lookup: AssetLookup
  workerScript: `loads` | `fails`
  wasm: WasmLoad
  lookupRequests: number
  wasmFileRequests: number
  heldLookups: Array<() => void>
  heldLookupPath?: string
  onHeld?: () => void
} = {
  lookup: `resolves`,
  workerScript: `loads`,
  wasm: `loads`,
  lookupRequests: 0,
  wasmFileRequests: 0,
  heldLookups: [],
}

const temporaryDirectory = realpathSync(
  mkdtempSync(join(realpathSync(tmpdir()), `db-open-outcome-`)),
)
let browser: Browser
// The dev server of the Vite major whose describe block is running.
let server: ViteDevServer | undefined
const consumerDirectory = join(temporaryDirectory, `consumer`)

// Starts a dev server for the consumer under one Vite major.
async function startServer(
  createDevServer: typeof vite8.createServer,
): Promise<void> {
  server = await createDevServer({
    configFile: false,
    root: consumerDirectory,
    base: `/nested/`,
    logLevel: `error`,
    server: { host: `127.0.0.1`, port: 0, watch: null },
    plugins: [
      {
        name: `control-open-premises`,
        configureServer(devServer) {
          devServer.middlewares.use((request, response, next) => {
            const url = request.url ?? ``
            const pathname = new URL(url, `http://x`).pathname
            if (url.includes(wasmLookup)) {
              premises.lookupRequests++
              if (premises.lookup === `fails`) {
                response.statusCode = 404
                response.end()
                return
              }
              if (premises.lookup === `held`) {
                premises.heldLookups.push(next)
                premises.heldLookupPath = url
                premises.onHeld?.()
                return
              }
            }
            if (
              premises.workerScript === `fails` &&
              !url.includes(`/@id/`) &&
              pathname.endsWith(`/opfs-worker.js`)
            ) {
              response.statusCode = 404
              response.end()
              return
            }
            if (!url.includes(`/@id/`) && pathname.endsWith(`.wasm`)) {
              premises.wasmFileRequests++
              // A held fetch waits until the driver interrupts the open and
              // releases it, so the worker's initialization is pending.
              if (premises.wasm === `held`) {
                premises.heldLookups.push(next)
                premises.onHeld?.()
                return
              }
            }
            if (
              premises.wasm === `fails` &&
              !url.includes(`/@id/`) &&
              pathname.endsWith(`.wasm`)
            ) {
              response.statusCode = 404
              response.end()
              return
            }
            next()
          })
        },
      },
    ],
  })
  await server.listen()
}

beforeAll(async () => {
  createPackagedConsumer(consumerDirectory)
  browser = await chromium.launch({ headless: true })
}, 120_000)

afterAll(async () => {
  await browser.close()
  rmSync(temporaryDirectory, { recursive: true, force: true })
})

/**
 * Page init script. A timer with the deadline's delay waits until the driver
 * calls `elapseDeadline`, which runs it as an elapsed deadline would.
 */
function holdDeadlineTimers(heldDelay: number): void {
  const probe = globalThis as OracleProbe
  const nativeSetTimeout = globalThis.setTimeout
  const nativeClearTimeout = globalThis.clearTimeout
  const held = new Map<ReturnType<typeof setTimeout>, () => void>()
  probe.elapseDeadline = () => {
    const callbacks = [...held.values()]
    held.clear()
    for (const callback of callbacks) callback()
  }
  globalThis.setTimeout = ((
    callback: (...args: Array<unknown>) => void,
    delay?: number,
    ...args: Array<unknown>
  ) => {
    if (delay !== heldDelay) return nativeSetTimeout(callback, delay, ...args)
    // A native timer that never fires gives the held timer a real handle.
    const handle = nativeSetTimeout(() => {}, 2_147_483_647)
    held.set(handle, () => callback(...args))
    return handle
  }) as typeof setTimeout
  globalThis.clearTimeout = ((handle?: ReturnType<typeof setTimeout>) => {
    if (handle !== undefined) held.delete(handle)
    nativeClearTimeout(handle)
  }) as typeof clearTimeout
}

let historyIndex = 0

// The middleware sets this during a history, after the driver reset it.
function readHeldLookupPath(): string | undefined {
  return premises.heldLookupPath
}

// Waits for the held lookup to reach the dev server, or fails the history.
async function awaitHeldLookup(lookupHeld: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      lookupHeld,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`the held step never reached the dev server`)),
          heldLookupWaitMs,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function runOpenHistory(history: OpenHistory): Promise<OpenObservation> {
  premises.lookup = history.lookup
  premises.workerScript =
    history.workerStart === `fails to load` ? `fails` : `loads`
  premises.wasm = history.wasm
  premises.lookupRequests = 0
  premises.wasmFileRequests = 0
  premises.heldLookups = []
  premises.heldLookupPath = undefined
  const lookupHeld = new Promise<void>((resolve) => {
    premises.onHeld = resolve
  })
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await page.addInitScript(probeWorkers, {
      refuseWorkers: history.workerStart === `throws`,
    })
    await page.addInitScript(holdDeadlineTimers, deadlineMs)
    const baseUrl = server!.resolvedUrls!.local[0]!
    await page.goto(baseUrl)
    await page.waitForFunction(
      () => typeof (globalThis as ProbeGlobal).openDatabase === `function`,
    )

    await page.evaluate(
      ({ databaseName, timeoutMs }) => {
        const probe = globalThis as OracleProbe
        probe.controller = new AbortController()
        probe.settled = probe
          .openDatabase({
            databaseName,
            timeoutMs,
            signal: probe.controller.signal,
          })
          .then(
            (database) => {
              probe.settlement = `opened`
              probe.database = database
            },
            (error: Error) => {
              probe.settlement = error.name as OpenSettlement
            },
          )
      },
      {
        databaseName: `outcome-${historyIndex++}.sqlite`,
        timeoutMs: history.interrupt === `deadline` ? deadlineMs : 0,
      },
    )

    let settlement: OpenSettlement | `pending`
    if (history.interrupt === `none`) {
      settlement = await page.evaluate(async () => {
        const probe = globalThis as OracleProbe
        await probe.settled
        return probe.settlement!
      })
    } else {
      await awaitHeldLookup(lookupHeld)
      if (history.interrupt === `deadline`) {
        await page.evaluate(() => (globalThis as OracleProbe).elapseDeadline())
      } else {
        await page.evaluate(() => {
          ;(globalThis as OracleProbe).controller.abort(
            new DOMException(`App stopped opening`, `AbortError`),
          )
        })
      }
      // An interruption settles the open in microtasks; one task later it
      // must have settled.
      settlement = await page.evaluate(async () => {
        await new Promise<void>((resolve) => {
          const channel = new MessageChannel()
          channel.port1.onmessage = () => resolve()
          channel.port2.postMessage(null)
        })
        return (globalThis as OracleProbe).settlement ?? `pending`
      })
    }

    // Checkpoint: let a held lookup complete in the page, then wait one task
    // so every continuation of the interrupted open has run.
    for (const release of premises.heldLookups.splice(0)) release()
    const heldLookupPath = readHeldLookupPath()
    if (heldLookupPath) {
      const lookupUrl = new URL(heldLookupPath, baseUrl).href
      // A string keeps Vitest from rewriting this page-side dynamic import.
      await page.evaluate(
        `import(${JSON.stringify(lookupUrl)}).catch(() => {}).then(() => new Promise((resolve) => { const channel = new MessageChannel(); channel.port1.onmessage = () => resolve(); channel.port2.postMessage(null) }))`,
      )
    }
    const observation = (await page.evaluate(() => {
      const probe = globalThis as OracleProbe
      return {
        settlement: probe.settlement,
        startedWorkers: probe.startedWorkers,
        terminatedWorkers: probe.terminatedWorkers,
        attemptedWorkers: probe.attemptedWorkers,
      }
    })) as OpenObservation & { attemptedWorkers?: number }
    observation.reached = {
      lookup: premises.lookupRequests > 0,
      workerStart: observation.attemptedWorkers! > 0,
      // The worker requests the WASM file when it handles initialization.
      initialization: premises.wasmFileRequests > 0,
    }
    delete observation.attemptedWorkers
    observation.settlement = settlement as OpenSettlement
    await page.evaluate(async () => {
      await (globalThis as OracleProbe).database?.close?.()
    })

    if (history.interrupt !== `none`) {
      // The later open runs without the interruption's held step.
      premises.lookup = `resolves`
      premises.wasm = `loads`
      observation.laterOpen = (await page.evaluate(async (databaseName) => {
        const probe = globalThis as OracleProbe
        try {
          const database = await probe.openDatabase({
            databaseName,
            timeoutMs: 0,
          })
          await database.close?.()
          return `opened`
        } catch (error) {
          return (error as Error).name
        }
      }, `outcome-${historyIndex++}.sqlite`)) as `opened`
    }
    return observation
  } finally {
    for (const release of premises.heldLookups.splice(0)) release()
    await context.close()
  }
}

// One block per consumer Vite major. Each runs its histories against a dev
// server of that major.
function describeOpenOutcomes(
  major: 7 | 8,
  createDevServer: typeof vite8.createServer,
  reached: ReadonlyArray<string>,
): void {
  const histories = historiesByVite[major]
  describe(`vite ${major} OPFS open outcome oracle (Chromium driver)`, () => {
    beforeAll(async () => {
      await startServer(createDevServer)
    }, 120_000)
    // Closes only the server this block started; a failed start leaves none.
    afterAll(async () => {
      for (const release of premises.heldLookups.splice(0)) release()
      await server?.close()
      server = undefined
    })

    it(`reaches every outcome that this driver controls`, () => {
      expect(reachedOutcomes(histories)).toEqual([...reached])
    })

    it.each(histories.map((history) => [describeHistory(history), history]))(
      `%s`,
      async (_name, history) => {
        expectOpenOutcome(history, await runOpenHistory(history))
      },
      120_000,
    )
  })
}

describeOpenOutcomes(7, vite7.createServer as unknown as typeof vite8.createServer, [
  `lookup: AbortError`,
  `lookup: PersistenceUnavailableError`,
  `lookup: TimeoutError`,
  `none: opened`,
  `wasm: AbortError`,
  `wasm: PersistenceUnavailableError`,
  `wasm: TimeoutError`,
  `worker start: PersistenceUnavailableError`,
])
describeOpenOutcomes(8, vite8.createServer, [
  `none: opened`,
  `wasm: AbortError`,
  `wasm: PersistenceUnavailableError`,
  `wasm: TimeoutError`,
  `worker start: PersistenceUnavailableError`,
])
