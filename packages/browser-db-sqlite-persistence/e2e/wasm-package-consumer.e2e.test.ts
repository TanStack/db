// @vitest-environment node
/**
 * Packaged-consumer checks for the separate WASM asset. A consumer app installs
 * the built package and runs under a Vite dev server, a dev server with a
 * custom cache directory, and a production preview. The open outcome oracle in
 * `opfs-open-outcome-oracle.e2e.test.ts` owns how an open settles when its
 * steps fail or are interrupted; these tests own the build output, the export
 * map, and opening from page shapes that the oracle's driver does not create.
 */
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { build, createServer, preview } from 'vite'
import {
  createPackagedConsumer,
  packageDirectory,
  probeWorkers,
} from './packaged-consumer'
import type { AddressInfo } from 'node:net'
import type { Response } from '@playwright/test'
import type { ProbeGlobal } from './packaged-consumer'

const temporaryDirectory = realpathSync(
  mkdtempSync(join(realpathSync(tmpdir()), `db-wasm-consumer-`)),
)
const consumerDirectory = join(temporaryDirectory, `consumer`)
const consumerBase = `/nested/`
// Files are written just before each server starts; a late watcher event
// would reload a page during its open.
const developmentServerOptions = {
  host: `127.0.0.1`,
  port: 0,
  watch: null,
} as const

beforeAll(async () => {
  createPackagedConsumer(consumerDirectory)
  await build({
    configFile: false,
    root: consumerDirectory,
    base: consumerBase,
    logLevel: `error`,
    build: { outDir: join(consumerDirectory, `dist`) },
  })
})

afterAll(() => rmSync(temporaryDirectory, { recursive: true, force: true }))

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

// The package exports its two runtime assets under fixed names, so a release
// does not change their public paths or expose other build files.
it(`exports only the worker and WASM files as package assets`, () => {
  const { exports } = JSON.parse(
    readFileSync(join(packageDirectory, `package.json`), `utf8`),
  ) as { exports: Record<string, unknown> }
  const assetExports = Object.entries(exports).filter(
    ([subpath, target]) =>
      typeof target === `string` && subpath !== `./package.json`,
  )
  expect(assetExports).toEqual([
    [`./wa-sqlite.wasm`, `./dist/wa-sqlite.wasm`],
    [`./opfs-worker.js`, `./dist/assets/opfs-worker.js`],
  ])
  for (const [, target] of assetExports) {
    expect(statSync(join(packageDirectory, target as string)).isFile()).toBe(
      true,
    )
  }
})

it(`opens and queries SQLite under a nested base without asset configuration`, async () => {
  const browser = await chromium.launch({ headless: true })
  const developmentServer = await createServer({
    configFile: false,
    root: consumerDirectory,
    base: consumerBase,
    logLevel: `error`,
    server: developmentServerOptions,
  })
  const rootCacheServer = await createServer({
    configFile: false,
    root: consumerDirectory,
    base: consumerBase,
    cacheDir: join(consumerDirectory, `.vite`),
    logLevel: `error`,
    server: developmentServerOptions,
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
        await page.addInitScript(probeWorkers, { refuseWorkers: false })
        await page.goto(baseUrl!)
        const opened = await page.evaluate(async () => {
          const probe = globalThis as ProbeGlobal
          const database = await probe.openDatabase()
          try {
            await database.execute(`CREATE TABLE items (value INTEGER)`)
            await database.execute(`INSERT INTO items (value) VALUES (42)`)
            return {
              rows: await database.execute<{ value: number }>(
                `SELECT value FROM items`,
              ),
              workerTypes: probe.workerTypes,
            }
          } finally {
            await database.close?.()
          }
        })
        // The package ships its worker as a classic script, so browsers
        // without module workers can still start it.
        expect(opened).toEqual({
          rows: [{ value: 42 }],
          workerTypes: [`classic`],
        })
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

type OpenOutcome =
  | { name: string; startedWorkers: number }
  | { rows: ReadonlyArray<unknown>; startedWorkers: number }

/*
 * An about:srcdoc frame shares its parent's origin and OPFS storage, but its
 * own URL cannot resolve a path. Vite returns asset paths for the dev server,
 * so the package must resolve them against that server rather than the page.
 */
it(`opens packaged SQLite from an about:srcdoc frame under Vite development`, async () => {
  const browser = await chromium.launch({ headless: true })
  const developmentServer = await createServer({
    configFile: false,
    root: consumerDirectory,
    base: consumerBase,
    logLevel: `error`,
    server: developmentServerOptions,
  })

  try {
    await developmentServer.listen()
    const page = await browser.newPage()
    await page.addInitScript(probeWorkers, { refuseWorkers: false })
    await page.goto(developmentServer.resolvedUrls!.local[0]!)
    const frameAttached = page.waitForEvent(`frameattached`)
    await page.evaluate((base) => {
      const frame = document.createElement(`iframe`)
      frame.srcdoc = `<script type="module" src="${base}@vite/client"></script><script type="module" src="${base}main.js"></script>`
      document.body.append(frame)
    }, consumerBase)
    const frame = await frameAttached
    await frame.waitForFunction(
      () => typeof (globalThis as ProbeGlobal).openDatabase === `function`,
    )
    const outcome = await frame.evaluate(async (): Promise<OpenOutcome> => {
      const probe = globalThis as ProbeGlobal
      try {
        const database = await probe.openDatabase({
          databaseName: `consumer-srcdoc.sqlite`,
          timeoutMs: 0,
        })
        try {
          return {
            rows: await database.execute(`SELECT 42 AS value`),
            startedWorkers: probe.startedWorkers,
          }
        } finally {
          await database.close?.()
        }
      } catch (error) {
        return {
          name: `${(error as Error).name}: ${(error as Error).message}`,
          startedWorkers: probe.startedWorkers,
        }
      }
    })
    expect(outcome).toEqual({ rows: [{ value: 42 }], startedWorkers: 1 })
  } finally {
    await developmentServer.close()
    await browser.close()
  }
}, 120_000)

/*
 * In a backend integration, the page comes from the application server and
 * its scripts come from the Vite server. A browser cannot start a worker from
 * another origin, so this open cannot succeed. It must still report
 * unavailable persistence rather than the Worker constructor's SecurityError.
 */
it(`reports unavailable persistence when the page and Vite server origins differ`, async () => {
  const browser = await chromium.launch({ headless: true })
  const developmentServer = await createServer({
    configFile: false,
    root: consumerDirectory,
    base: consumerBase,
    logLevel: `error`,
    server: developmentServerOptions,
  })

  const applicationServer = createHttpServer()

  try {
    await developmentServer.listen()
    const viteUrl = developmentServer.resolvedUrls!.local[0]!
    applicationServer.on(`request`, (_request, response) => {
      response.setHeader(`content-type`, `text/html`)
      response.end(
        `<script type="module" src="${viteUrl}@vite/client"></script><script type="module" src="${viteUrl}main.js"></script>`,
      )
    })
    await new Promise<void>((resolve) =>
      applicationServer.listen(0, `localhost`, resolve),
    )
    const { port } = applicationServer.address() as AddressInfo
    const page = await browser.newPage()
    await page.addInitScript(probeWorkers, { refuseWorkers: false })
    await page.goto(`http://localhost:${port}/`)
    await page.waitForFunction(
      () => typeof (globalThis as ProbeGlobal).openDatabase === `function`,
    )
    const outcome = await page.evaluate(async (): Promise<OpenOutcome> => {
      const probe = globalThis as ProbeGlobal
      try {
        const database = await probe.openDatabase({ timeoutMs: 0 })
        await database.close?.()
        return { rows: [], startedWorkers: probe.startedWorkers }
      } catch (error) {
        return {
          name: (error as Error).name,
          startedWorkers: probe.startedWorkers,
        }
      }
    })
    expect(outcome).toMatchObject({ name: `PersistenceUnavailableError` })
  } finally {
    applicationServer.close()
    await developmentServer.close()
    await browser.close()
  }
}, 120_000)
