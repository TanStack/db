// @vitest-environment node
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { expect, it } from 'vitest'
import { createServer } from 'vite'
import type { BrowserWASQLiteDatabase } from '../src'

const packageDirectory = fileURLToPath(new URL('../', import.meta.url))

it.each([
  { layout: `direct`, cache: `custom` },
  { layout: `hoisted`, cache: `default` },
  { layout: `hoisted`, cache: `custom` },
])(
  `opens packaged SQLite in a $layout Vite install with $cache cache without asset configuration`,
  async ({ layout, cache }) => {
    const temporaryDirectory = realpathSync(
      mkdtempSync(join(realpathSync(tmpdir()), `db-wasm-layout-`)),
    )
    const appDirectory = join(temporaryDirectory, `apps/web`)
    const installDirectory = join(
      layout === `hoisted` ? temporaryDirectory : appDirectory,
      `node_modules/@tanstack`,
    )
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
    let server: Awaited<ReturnType<typeof createServer>> | undefined

    try {
      mkdirSync(appDirectory, { recursive: true })
      mkdirSync(installDirectory, { recursive: true })
      writeFileSync(
        join(temporaryDirectory, `package.json`),
        JSON.stringify({ private: true, workspaces: [`apps/*`] }),
      )
      writeFileSync(
        join(appDirectory, `package.json`),
        JSON.stringify({ name: `web`, type: `module` }),
      )
      cpSync(
        join(packageDirectory, `dist`),
        join(installDirectory, `browser-db-sqlite-persistence/dist`),
        { recursive: true },
      )
      cpSync(
        join(packageDirectory, `package.json`),
        join(installDirectory, `browser-db-sqlite-persistence/package.json`),
      )
      for (const name of [`db`, `db-sqlite-persistence-core`]) {
        symlinkSync(
          join(packageDirectory, `../${name}`),
          join(installDirectory, name),
          `dir`,
        )
      }
      writeFileSync(
        join(appDirectory, `index.html`),
        `<script type="module" src="./main.js"></script>`,
      )
      writeFileSync(
        join(appDirectory, `main.js`),
        `import { openBrowserWASQLiteOPFSDatabase } from '@tanstack/browser-db-sqlite-persistence';
globalThis.openDatabase = () => openBrowserWASQLiteOPFSDatabase({ databaseName: 'layout.sqlite' });`,
      )
      server = await createServer({
        configFile: false,
        root: appDirectory,
        base: `/nested/`,
        cacheDir:
          cache === `custom`
            ? join(appDirectory, `node_modules/.cache/vite`)
            : undefined,
        logLevel: `error`,
        server: { host: `127.0.0.1`, port: 0 },
      })
      await server.listen()
      browser = await chromium.launch({ headless: true })
      const page = await browser.newPage()
      const diagnostics: Array<string> = []
      const wasmResponses: Array<{
        status: number
        contentType: string | undefined
      }> = []
      const workerUrls: Array<string> = []
      page.on(`pageerror`, (error) => diagnostics.push(error.message))
      page.on(`response`, (response) => {
        if (response.status() >= 400) {
          diagnostics.push(`${response.status()} ${response.url()}`)
        }
        if (new URL(response.url()).pathname.endsWith(`.wasm`)) {
          wasmResponses.push({
            status: response.status(),
            contentType: response.headers()[`content-type`],
          })
        }
      })
      page.on(`requestfailed`, (request) => {
        diagnostics.push(`${request.failure()?.errorText} ${request.url()}`)
      })
      page.on(`worker`, (worker) => workerUrls.push(worker.url()))

      try {
        await page.goto(server.resolvedUrls!.local[0]!)
        const rows = await page.evaluate(async () => {
          const openDatabase = (
            globalThis as typeof globalThis & {
              openDatabase: () => Promise<BrowserWASQLiteDatabase>
            }
          ).openDatabase
          const database = await openDatabase()
          try {
            return await database.execute<{ value: number }>(
              `SELECT 42 AS value`,
            )
          } finally {
            await database.close?.()
          }
        })
        expect(rows).toEqual([{ value: 42 }])
        expect(workerUrls).toHaveLength(1)
        expect(
          wasmResponses.filter(
            (response) =>
              response.status === 200 &&
              response.contentType?.includes(`application/wasm`),
          ),
        ).toHaveLength(1)
      } catch (error) {
        throw new Error(`${String(error)}\n${diagnostics.join(`\n`)}`, {
          cause: error,
        })
      } finally {
        await page.close()
      }
    } finally {
      await browser?.close()
      await server?.close()
      rmSync(temporaryDirectory, { recursive: true, force: true })
    }
  },
  120_000,
)
