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
import type { BrowserWASQLiteDatabase } from '../src'

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
globalThis.openDatabase = () => openBrowserWASQLiteOPFSDatabase({ databaseName: 'consumer.sqlite' });`,
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
