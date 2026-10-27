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
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { build, createServer, preview } from 'vite'
import type { AddressInfo } from 'node:net'
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
        await page.addInitScript(countCreatedWorkers)
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

type ProbeGlobal = typeof globalThis & {
  openDatabase: (
    options?: Partial<OpenBrowserWASQLiteOPFSDatabaseOptions>,
  ) => Promise<BrowserWASQLiteDatabase>
  createdWorkers: number
  workerTypes: Array<WorkerType>
}

// Runs in every frame before its scripts, so each realm counts its own workers.
function countCreatedWorkers(): void {
  const probe = globalThis as ProbeGlobal
  const NativeWorker = probe.Worker
  probe.createdWorkers = 0
  probe.workerTypes = []
  probe.Worker = class extends NativeWorker {
    constructor(...args: ConstructorParameters<typeof Worker>) {
      probe.createdWorkers++
      probe.workerTypes.push(args[1]?.type ?? `classic`)
      super(...args)
    }
  }
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
    await page.addInitScript(countCreatedWorkers)
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

type OpenOutcome =
  | { name: string; createdWorkers: number }
  | { rows: ReadonlyArray<unknown>; createdWorkers: number }

/*
 * The README surfaces OPFS capability failures as PersistenceUnavailableError.
 * The packaged assets are part of that capability. The worker loads the WASM
 * file itself, so a missing file must also report that error. When the dev
 * server cannot resolve either lookup, as for a transitive install that the Vite root cannot
 * resolve by package name, the open must report that error and create no
 * worker. An application cannot otherwise tell this failure from a bug.
 */
// The packaged lookups precede the worker; the WASM file loads inside it.
const assetFailures = [
  {
    asset: `WASM lookup`,
    fails: (url: string) =>
      url.includes(
        `/@id/@tanstack/browser-db-sqlite-persistence/wa-sqlite.wasm`,
      ),
    createdWorkers: 0,
  },
  {
    asset: `worker lookup`,
    fails: (url: string) =>
      url.includes(
        `/@id/@tanstack/browser-db-sqlite-persistence/opfs-worker.js`,
      ),
    createdWorkers: 0,
  },
  {
    asset: `WASM file`,
    fails: (url: string) =>
      !url.includes(`/@id/`) &&
      new URL(url, `http://x`).pathname.endsWith(`.wasm`),
    createdWorkers: 1,
  },
]

it.each(assetFailures)(
  `reports unavailable persistence when the packaged $asset fails to load`,
  async ({ fails, createdWorkers }) => {
    const browser = await chromium.launch({ headless: true })
    const developmentServer = await createServer({
      configFile: false,
      root: consumerDirectory,
      base: consumerBase,
      logLevel: `error`,
      server: { host: `127.0.0.1`, port: 0 },
      plugins: [
        {
          name: `fail-packaged-asset-lookup`,
          configureServer(server) {
            server.middlewares.use((request, response, next) => {
              if (request.url && fails(request.url)) {
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

    try {
      await developmentServer.listen()
      const page = await browser.newPage()
      await page.addInitScript(countCreatedWorkers)
      await page.goto(developmentServer.resolvedUrls!.local[0]!)
      const outcome = await page.evaluate(async (): Promise<OpenOutcome> => {
        const probe = globalThis as ProbeGlobal
        try {
          const database = await probe.openDatabase({ timeoutMs: 5_000 })
          await database.close?.()
          return { rows: [], createdWorkers: probe.createdWorkers }
        } catch (error) {
          return {
            name: (error as Error).name,
            createdWorkers: probe.createdWorkers,
          }
        }
      })
      expect(outcome).toEqual({
        name: `PersistenceUnavailableError`,
        createdWorkers,
      })
    } finally {
      await developmentServer.close()
      await browser.close()
    }
  },
  120_000,
)

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
    server: { host: `127.0.0.1`, port: 0 },
  })

  try {
    await developmentServer.listen()
    const page = await browser.newPage()
    await page.addInitScript(countCreatedWorkers)
    await page.goto(developmentServer.resolvedUrls!.local[0]!)
    const outcome = await page.evaluate(async (base): Promise<OpenOutcome> => {
      const frame = document.createElement(`iframe`)
      frame.srcdoc = `<script type="module" src="${base}@vite/client"></script><script type="module" src="${base}main.js"></script>`
      document.body.append(frame)
      const probe = await new Promise<ProbeGlobal>((resolve) => {
        const poll = () => {
          const frameGlobal = frame.contentWindow as ProbeGlobal | null
          if (typeof frameGlobal?.openDatabase === `function`) {
            resolve(frameGlobal)
          } else {
            setTimeout(poll, 20)
          }
        }
        poll()
      })
      try {
        const database = await probe.openDatabase({
          databaseName: `consumer-srcdoc.sqlite`,
          timeoutMs: 5_000,
        })
        try {
          return {
            rows: await database.execute(`SELECT 42 AS value`),
            createdWorkers: probe.createdWorkers,
          }
        } finally {
          await database.close?.()
        }
      } catch (error) {
        return {
          name: `${(error as Error).name}: ${(error as Error).message}`,
          createdWorkers: probe.createdWorkers,
        }
      }
    }, consumerBase)
    expect(outcome).toEqual({ rows: [{ value: 42 }], createdWorkers: 1 })
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
    server: { host: `127.0.0.1`, port: 0 },
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
    await page.addInitScript(countCreatedWorkers)
    await page.goto(`http://localhost:${port}/`)
    await page.waitForFunction(
      () => typeof (globalThis as ProbeGlobal).openDatabase === `function`,
    )
    const outcome = await page.evaluate(async (): Promise<OpenOutcome> => {
      const probe = globalThis as ProbeGlobal
      try {
        const database = await probe.openDatabase({ timeoutMs: 5_000 })
        await database.close?.()
        return { rows: [], createdWorkers: probe.createdWorkers }
      } catch (error) {
        return {
          name: (error as Error).name,
          createdWorkers: probe.createdWorkers,
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
