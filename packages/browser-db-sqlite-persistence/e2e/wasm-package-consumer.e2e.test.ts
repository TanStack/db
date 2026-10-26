// @vitest-environment node
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { build, createServer, preview } from 'vite'
import type { Response } from '@playwright/test'
import type {
  BrowserWASQLiteDatabase,
  OpenBrowserWASQLiteOPFSDatabaseOptions,
} from '../src'

const packageDirectory = fileURLToPath(new URL('../', import.meta.url))
const temporaryDirectory = realpathSync(
  mkdtempSync(join(realpathSync(tmpdir()), `db-wasm-consumer-`)),
)
const consumerDirectory = join(temporaryDirectory, `consumer`)
const consumerBase = `/nested/`

beforeAll(async () => {
  createConsumer()
  await build({
    configFile: false,
    root: consumerDirectory,
    base: consumerBase,
    logLevel: `error`,
    build: { outDir: join(consumerDirectory, `dist`) },
  })
})

afterAll(() => rmSync(temporaryDirectory, { recursive: true, force: true }))

function createConsumer(): void {
  mkdirSync(consumerDirectory)
  writeFileSync(
    join(consumerDirectory, `package.json`),
    JSON.stringify({ name: `sqlite-wasm-consumer`, type: `module` }),
  )
  const packageInstallDirectory = join(
    consumerDirectory,
    `node_modules/@tanstack/browser-db-sqlite-persistence`,
  )
  mkdirSync(packageInstallDirectory, { recursive: true })
  cpSync(
    join(packageDirectory, `dist`),
    join(packageInstallDirectory, `dist`),
    {
      recursive: true,
    },
  )
  copyFileSync(
    join(packageDirectory, `package.json`),
    join(packageInstallDirectory, `package.json`),
  )
  for (const packageName of [`db`, `db-sqlite-persistence-core`]) {
    symlinkSync(
      join(packageDirectory, `../${packageName}`),
      join(consumerDirectory, `node_modules/@tanstack/${packageName}`),
      `dir`,
    )
  }

  writeFileSync(
    join(consumerDirectory, `index.html`),
    `<script type="module" src="./main.js"></script>`,
  )
  writeFileSync(
    join(consumerDirectory, `main.js`),
    `import { openBrowserWASQLiteOPFSDatabase } from '@tanstack/browser-db-sqlite-persistence';
globalThis.openDatabase = (options) => openBrowserWASQLiteOPFSDatabase({ databaseName: 'consumer.sqlite', ...options });`,
  )
}

it(`includes a separately loadable WASM asset in a consumer build`, () => {
  const assetsDirectory = join(consumerDirectory, `dist/assets`)
  const assets = readdirSync(assetsDirectory)
  const wasmFile = assets.find((name) => name.endsWith(`.wasm`))
  const workerFile = assets.find((name) => name.startsWith(`opfs-worker-`))
  expect(wasmFile).toBeDefined()
  expect(workerFile).toBeDefined()
  expect(readFileSync(join(assetsDirectory, wasmFile!))).toEqual(
    readFileSync(
      createRequire(import.meta.url).resolve(
        `@journeyapps/wa-sqlite/dist/wa-sqlite.wasm`,
      ),
    ),
  )
  expect(
    readFileSync(join(assetsDirectory, workerFile!), `utf8`),
  ).not.toContain(`data:application/wasm;base64,`)
})

it(`opens and queries SQLite under a nested base without asset configuration`, async () => {
  const browser = await chromium.launch({ headless: true })
  const developmentServer = await createServer({
    configFile: false,
    root: consumerDirectory,
    base: consumerBase,
    logLevel: `error`,
    server: { host: `127.0.0.1`, port: 0 },
  })
  const rootCacheServer = await createServer({
    configFile: false,
    root: consumerDirectory,
    base: consumerBase,
    cacheDir: join(consumerDirectory, `.vite`),
    logLevel: `error`,
    server: { host: `127.0.0.1`, port: 0 },
  })
  let productionServer: Awaited<ReturnType<typeof preview>> | undefined

  try {
    await developmentServer.listen()
    await rootCacheServer.listen()
    productionServer = await preview({
      configFile: false,
      root: consumerDirectory,
      base: consumerBase,
      logLevel: `error`,
      preview: { host: `127.0.0.1`, port: 0 },
    })

    for (const baseUrl of [
      developmentServer.resolvedUrls?.local[0],
      rootCacheServer.resolvedUrls?.local[0],
      productionServer.resolvedUrls?.local[0],
    ]) {
      expect(baseUrl).toBeDefined()
      const page = await browser.newPage()
      const wasmResponses: Array<Response> = []
      const diagnostics: Array<string> = []
      page.on(`response`, (response) => {
        if (new URL(response.url()).pathname.endsWith(`.wasm`)) {
          wasmResponses.push(response)
        }
        if (response.status() >= 400) {
          diagnostics.push(`${response.status()} ${response.url()}`)
        }
      })
      page.on(`requestfailed`, (request) => {
        diagnostics.push(`${request.failure()?.errorText} ${request.url()}`)
      })
      page.on(`pageerror`, (error) => diagnostics.push(error.message))
      page.on(`console`, (message) => {
        if (message.type() === `error`) diagnostics.push(message.text())
      })
      page.on(`worker`, (worker) => diagnostics.push(`worker ${worker.url()}`))
      try {
        await page.goto(baseUrl!)
        const rows = await page.evaluate(async () => {
          const openDatabase = (
            globalThis as typeof globalThis & {
              openDatabase: () => Promise<BrowserWASQLiteDatabase>
            }
          ).openDatabase
          const database = await openDatabase()
          try {
            await database.execute(`CREATE TABLE items (value INTEGER)`)
            await database.execute(`INSERT INTO items (value) VALUES (42)`)
            return await database.execute<{ value: number }>(
              `SELECT value FROM items`,
            )
          } finally {
            await database.close?.()
          }
        })
        expect(rows).toEqual([{ value: 42 }])
        diagnostics.push(
          ...wasmResponses.map(
            (response) =>
              `wasm ${response.status()} ${response.headers()[`content-type`]} ${response.url()}`,
          ),
        )
        const binaryResponses = wasmResponses.filter((response) =>
          response.headers()[`content-type`]?.includes(`application/wasm`),
        )
        expect(binaryResponses).toHaveLength(1)
        const wasmResponse = binaryResponses[0]!
        expect(wasmResponse.status()).toBe(200)
        expect(wasmResponse.headers()[`content-type`]).toContain(
          `application/wasm`,
        )
      } catch (error) {
        throw new Error(`${String(error)}\n${diagnostics.join(`\n`)}`, {
          cause: error,
        })
      } finally {
        await page.close()
      }
    }
  } finally {
    await productionServer?.close()
    await rootCacheServer.close()
    await developmentServer.close()
    await browser.close()
  }
}, 120_000)

type ProbeGlobal = typeof globalThis & {
  openDatabase: (
    options?: Partial<OpenBrowserWASQLiteOPFSDatabaseOptions>,
  ) => Promise<BrowserWASQLiteDatabase>
  createdWorkers: number
}

/*
 * The OPFS page lifecycle oracle owns the open deadline and caller abort with a
 * controlled Worker in jsdom. Under a Vite dev server, the built package has an
 * earlier open step: it asks Vite for the asset URLs that the dependency
 * optimizer did not move. Only a real dev server reaches that step. This
 * receiving witness holds the WASM lookup and expects the oracle's fixed open
 * outcomes: the deadline rejects with TimeoutError, an abort rejects with its
 * reason, and neither creates a worker, even after the held lookup completes.
 * A later open in the same page still succeeds.
 */
it(`applies the open deadline and abort while Vite resolves packaged assets`, async () => {
  const heldLookups: Array<() => void> = []
  let holdLookups = true
  const browser = await chromium.launch({ headless: true })
  const developmentServer = await createServer({
    configFile: false,
    root: consumerDirectory,
    base: consumerBase,
    logLevel: `error`,
    server: { host: `127.0.0.1`, port: 0 },
    plugins: [
      {
        name: `hold-packaged-wasm-lookup`,
        configureServer(server) {
          server.middlewares.use((request, _response, next) => {
            if (
              holdLookups &&
              request.url?.includes(
                `/@id/@tanstack/browser-db-sqlite-persistence/wa-sqlite.wasm`,
              )
            ) {
              heldLookups.push(next)
              return
            }
            next()
          })
        },
      },
    ],
  })

  try {
    await developmentServer.listen()
    const page = await browser.newPage()
    await page.addInitScript(() => {
      const probe = globalThis as ProbeGlobal
      const NativeWorker = probe.Worker
      probe.createdWorkers = 0
      probe.Worker = class extends NativeWorker {
        constructor(...args: ConstructorParameters<typeof Worker>) {
          probe.createdWorkers++
          super(...args)
        }
      }
    })
    await page.goto(developmentServer.resolvedUrls!.local[0]!)

    const interrupted = await page.evaluate(async () => {
      const probe = globalThis as ProbeGlobal
      // A bounded wait reports an open that ignores its deadline or signal.
      const settle = (open: Promise<BrowserWASQLiteDatabase>) =>
        Promise.race([
          open.then(
            () => ({ name: `opened`, message: `` }),
            (error: Error) => ({ name: error.name, message: error.message }),
          ),
          new Promise<{ name: string; message: string }>((resolve) =>
            setTimeout(() => resolve({ name: `pending`, message: `` }), 2_000),
          ),
        ])
      const timedOut = await settle(probe.openDatabase({ timeoutMs: 100 }))
      const controller = new AbortController()
      const aborted = settle(
        probe.openDatabase({ timeoutMs: 0, signal: controller.signal }),
      )
      setTimeout(() => {
        controller.abort(new DOMException(`App stopped opening`, `AbortError`))
      }, 50)
      return {
        timedOut,
        aborted: await aborted,
        createdWorkers: probe.createdWorkers,
      }
    })
    expect(interrupted).toEqual({
      timedOut: {
        name: `TimeoutError`,
        message: `Opening browser OPFS database timed out after 100 ms`,
      },
      aborted: { name: `AbortError`, message: `App stopped opening` },
      createdWorkers: 0,
    })
    expect(heldLookups.length).toBeGreaterThan(0)

    holdLookups = false
    const lookupCompleted = page.waitForResponse((response) =>
      response
        .url()
        .includes(
          `/@id/@tanstack/browser-db-sqlite-persistence/wa-sqlite.wasm`,
        ),
    )
    for (const release of heldLookups.splice(0)) release()
    await lookupCompleted

    const reopened = await page.evaluate(async () => {
      const probe = globalThis as ProbeGlobal
      // Let continuations of the interrupted opens run before observing.
      await new Promise((resolve) => setTimeout(resolve, 100))
      const workersAfterLateLookup = probe.createdWorkers
      const database = await probe.openDatabase()
      try {
        return {
          workersAfterLateLookup,
          rows: await database.execute(`SELECT 42 AS value`),
          createdWorkers: probe.createdWorkers,
        }
      } finally {
        await database.close?.()
      }
    })
    expect(reopened).toEqual({
      workersAfterLateLookup: 0,
      rows: [{ value: 42 }],
      createdWorkers: 1,
    })
  } finally {
    for (const release of heldLookups.splice(0)) release()
    await developmentServer.close()
    await browser.close()
  }
}, 120_000)
