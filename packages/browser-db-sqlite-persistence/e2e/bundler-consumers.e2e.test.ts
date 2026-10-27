// @vitest-environment node
/**
 * Receiving witnesses for bundlers other than Vite. The README promises that
 * an app loads the OPFS worker and the separate `wa-sqlite.wasm` file without
 * asset configuration. Each case installs the built package in a consumer app,
 * bundles it, opens and queries SQLite in Chromium, and checks four facts:
 *
 * - the query returns its row;
 * - one worker starts, as a classic script;
 * - the browser loads one `200 application/wasm` response;
 * - the Vite dev-server lookup never runs, because no Vite client is present;
 * - a production build ships none of that lookup's code, because the bundler
 *   removes it with `process.env.NODE_ENV`.
 *
 * Cases: webpack 5 production and development builds served as static files,
 * and Next.js with Turbopack and with webpack, each under `next build` plus
 * `next start` and under `next dev`. The apps live in the package's ignored
 * `.cache` directory, inside the workspace, because Next.js infers its project
 * root from the workspace lockfile. Each app installs the built workspace
 * packages as published packages and has its own empty TypeScript or
 * JavaScript config, as a real app does. Otherwise webpack and Turbopack apply
 * the workspace tsconfig paths, which point at sources.
 */
import { spawn } from 'node:child_process'
import {
  copyFileSync,
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
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
import { dirname, extname, join } from 'node:path'
import { chromium } from '@playwright/test'
import webpack from 'webpack'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { packageDirectory, probeWorkers } from './packaged-consumer'
import type { ChildProcess } from 'node:child_process'
import type { AddressInfo } from 'node:net'
import type { Browser } from '@playwright/test'
import type { ProbeGlobal } from './packaged-consumer'

const appsDirectory = join(packageDirectory, `.cache/bundler-consumers`)
const require = createRequire(import.meta.url)
const nextBin = require.resolve(`next/dist/bin/next`)

type StartedApp = {
  url: string
  close: () => void
  // The emitted client code, for a production build.
  productionOutput?: string
}

// Whether any emitted script contains the Vite dev-server lookup.
function shipsViteLookup(directory: string): boolean {
  return (readdirSync(directory, { recursive: true }) as Array<string>).some(
    (file) =>
      /\.(c?js)$/.test(file) &&
      readFileSync(join(directory, file), `utf8`).includes(`/@vite/client`),
  )
}

type BundlerCase =
  | { bundler: `webpack`; mode: `production` | `development` }
  | {
      bundler: `next`
      compiler: `turbopack` | `webpack`
      server: `build and start` | `dev`
    }

const cases: Array<BundlerCase> = [
  { bundler: `webpack`, mode: `production` },
  { bundler: `webpack`, mode: `development` },
  ...([`turbopack`, `webpack`] as const).flatMap((compiler) =>
    ([`build and start`, `dev`] as const).map((server) => ({
      bundler: `next` as const,
      compiler,
      server,
    })),
  ),
]

let browser: Browser
beforeAll(async () => {
  rmSync(appsDirectory, { recursive: true, force: true })
  browser = await chromium.launch({ headless: true })
})
afterAll(async () => {
  await browser.close()
  rmSync(appsDirectory, { recursive: true, force: true })
})

// The workspace packages that the app installs, by name.
const workspacePackages: Record<string, string> = {
  '@tanstack/browser-db-sqlite-persistence': packageDirectory,
  '@tanstack/db-sqlite-persistence-core': join(
    packageDirectory,
    `../db-sqlite-persistence-core`,
  ),
  '@tanstack/db': join(packageDirectory, `../db`),
  '@tanstack/db-ivm': join(packageDirectory, `../db-ivm`),
}

/**
 * Installs the built workspace packages as published packages: their `dist`
 * and `package.json`, without the workspace's tsconfig files, whose paths
 * point at sources. Third-party dependencies link to their installed copies.
 */
function installAsPublished(appDirectory: string): void {
  const modules = join(appDirectory, `node_modules`)
  for (const [name, directory] of Object.entries(workspacePackages)) {
    const installed = join(modules, name)
    mkdirSync(installed, { recursive: true })
    cpSync(join(directory, `dist`), join(installed, `dist`), {
      recursive: true,
    })
    copyFileSync(
      join(directory, `package.json`),
      join(installed, `package.json`),
    )
    const { dependencies = {} } = JSON.parse(
      readFileSync(join(directory, `package.json`), `utf8`),
    ) as { dependencies?: Record<string, string> }
    for (const dependency of Object.keys(dependencies)) {
      const link = join(modules, dependency)
      if (dependency in workspacePackages || existsSync(link)) continue
      mkdirSync(dirname(link), { recursive: true })
      symlinkSync(
        realpathSync(join(directory, `node_modules`, dependency)),
        link,
        `dir`,
      )
    }
  }
}

const openDatabaseModule = `import { openBrowserWASQLiteOPFSDatabase } from '@tanstack/browser-db-sqlite-persistence'
globalThis.openDatabase = (options) =>
  openBrowserWASQLiteOPFSDatabase({ databaseName: 'bundler.sqlite', ...options })
`

const contentTypes: Record<string, string> = {
  '.html': `text/html`,
  '.js': `text/javascript`,
  '.wasm': `application/wasm`,
  '.map': `application/json`,
}

async function serveStatic(directory: string): Promise<{
  url: string
  close: () => void
}> {
  const server = createHttpServer((request, response) => {
    const pathname = new URL(request.url ?? `/`, `http://x`).pathname
    const file = join(directory, pathname === `/` ? `index.html` : pathname)
    if (!existsSync(file) || !statSync(file).isFile()) {
      response.statusCode = 404
      response.end()
      return
    }
    response.setHeader(
      `content-type`,
      contentTypes[extname(file)] ?? `application/octet-stream`,
    )
    createReadStream(file).pipe(response)
  })
  await new Promise<void>((resolve) => server.listen(0, `127.0.0.1`, resolve))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}/`, close: () => server.close() }
}

async function startWebpackApp(
  appDirectory: string,
  mode: `production` | `development`,
): Promise<StartedApp> {
  writeFileSync(join(appDirectory, `tsconfig.json`), `{}`)
  writeFileSync(join(appDirectory, `main.js`), openDatabaseModule)
  const outputDirectory = join(appDirectory, `dist`)
  await new Promise<void>((resolve, reject) => {
    webpack(
      {
        mode,
        context: appDirectory,
        entry: `./main.js`,
        devtool: false,
        output: { path: outputDirectory, filename: `main.js` },
      },
      (error, stats) => {
        if (error || stats?.hasErrors()) {
          reject(error ?? new Error(stats!.toString(`errors-only`)))
        } else {
          resolve()
        }
      },
    )
  })
  writeFileSync(
    join(outputDirectory, `index.html`),
    `<script src="/main.js"></script>`,
  )
  const app = await serveStatic(outputDirectory)
  return mode === `production`
    ? { ...app, productionOutput: outputDirectory }
    : app
}

function runNext(
  appDirectory: string,
  args: Array<string>,
): { child: ChildProcess; output: Array<string>; exited: Promise<number> } {
  const output: Array<string> = []
  const child = spawn(process.execPath, [nextBin, ...args], {
    cwd: appDirectory,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: `1`, NODE_ENV: undefined },
  })
  child.stdout.on(`data`, (chunk: Buffer) => output.push(String(chunk)))
  child.stderr.on(`data`, (chunk: Buffer) => output.push(String(chunk)))
  const exited = new Promise<number>((resolve) =>
    child.on(`exit`, (code) => resolve(code ?? 1)),
  )
  return { child, output, exited }
}

async function freePort(): Promise<number> {
  const server = createHttpServer()
  await new Promise<void>((resolve) => server.listen(0, `127.0.0.1`, resolve))
  const { port } = server.address() as AddressInfo
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

// Readiness, not timing: the server is ready when its page answers. A server
// error is final, and the bound only stops a server that never listens.
async function waitForPage(url: string, server: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 480; attempt++) {
    if (server.exitCode !== null) throw new Error(`Next.js exited`)
    try {
      const response = await fetch(url)
      if (response.ok) return
      throw new Error(`${response.status} ${await response.text()}`)
    } catch (error) {
      if (!(error instanceof TypeError)) throw error
      // fetch rejects with a TypeError until the server listens.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Next.js did not listen`)
}

async function startNextApp(
  appDirectory: string,
  compiler: `turbopack` | `webpack`,
  server: `build and start` | `dev`,
): Promise<StartedApp> {
  writeFileSync(join(appDirectory, `jsconfig.json`), `{}`)
  mkdirSync(join(appDirectory, `app`))
  writeFileSync(
    join(appDirectory, `app/layout.jsx`),
    `export default function Layout({ children }) {
  return <html><body>{children}</body></html>
}
`,
  )
  writeFileSync(
    join(appDirectory, `app/page.jsx`),
    `'use client'
import { useEffect } from 'react'

export default function Page() {
  useEffect(() => {
    import('../open-database.js')
  }, [])
  return <p>bundler consumer</p>
}
`,
  )
  writeFileSync(join(appDirectory, `open-database.js`), openDatabaseModule)
  const compilerFlag = compiler === `webpack` ? [`--webpack`] : []
  if (server === `build and start`) {
    const build = runNext(appDirectory, [`build`, ...compilerFlag])
    if ((await build.exited) !== 0) {
      throw new Error(`next build failed\n${build.output.join(``)}`)
    }
  }
  const port = await freePort()
  const started = runNext(appDirectory, [
    server === `dev` ? `dev` : `start`,
    ...(server === `dev` ? compilerFlag : []),
    `--port`,
    String(port),
    `--hostname`,
    `127.0.0.1`,
  ])
  const url = `http://127.0.0.1:${port}/`
  try {
    await waitForPage(url, started.child)
  } catch (error) {
    started.child.kill()
    throw new Error(`${String(error)}\n${started.output.join(``)}`)
  }
  return {
    url,
    close: () => started.child.kill(),
    ...(server === `build and start`
      ? { productionOutput: join(appDirectory, `.next/static`) }
      : {}),
  }
}

function describeCase(bundlerCase: BundlerCase): string {
  return bundlerCase.bundler === `webpack`
    ? `webpack ${bundlerCase.mode} build`
    : `Next.js ${bundlerCase.compiler} ${bundlerCase.server}`
}

it.each(cases.map((bundlerCase) => [describeCase(bundlerCase), bundlerCase]))(
  `opens packaged SQLite from a %s without asset configuration`,
  async (name, bundlerCase) => {
    const appDirectory = join(appsDirectory, name.replaceAll(` `, `-`))
    mkdirSync(appDirectory, { recursive: true })
    writeFileSync(
      join(appDirectory, `package.json`),
      JSON.stringify({ name: `bundler-consumer`, private: true }),
    )
    installAsPublished(appDirectory)
    const app =
      bundlerCase.bundler === `webpack`
        ? await startWebpackApp(appDirectory, bundlerCase.mode)
        : await startNextApp(
            appDirectory,
            bundlerCase.compiler,
            bundlerCase.server,
          )
    const context = await browser.newContext()
    const page = await context.newPage()
    const wasmResponses: Array<{ status: number; contentType?: string }> = []
    const lookupRequests: Array<string> = []
    const diagnostics: Array<string> = []
    page.on(`request`, (request) => {
      if (request.url().includes(`/@id/`)) lookupRequests.push(request.url())
    })
    page.on(`response`, (response) => {
      if (new URL(response.url()).pathname.endsWith(`.wasm`)) {
        wasmResponses.push({
          status: response.status(),
          contentType: response.headers()[`content-type`],
        })
      }
      if (response.status() >= 400) {
        diagnostics.push(`${response.status()} ${response.url()}`)
      }
    })
    page.on(`pageerror`, (error) => diagnostics.push(error.message))
    try {
      await page.addInitScript(probeWorkers, { refuseWorkers: false })
      await page.goto(app.url)
      await page.waitForFunction(
        () => typeof (globalThis as ProbeGlobal).openDatabase === `function`,
      )
      const opened = await page.evaluate(async () => {
        const probe = globalThis as ProbeGlobal
        const database = await probe.openDatabase({ timeoutMs: 0 })
        try {
          return {
            rows: await database.execute(`SELECT 42 AS value`),
            workerTypes: probe.workerTypes,
          }
        } finally {
          await database.close?.()
        }
      })
      expect({
        ...opened,
        wasmResponses: wasmResponses.map(({ status, contentType }) => ({
          status,
          wasm: contentType?.includes(`application/wasm`) ?? false,
        })),
        lookupRequests,
        ...(app.productionOutput
          ? { shipsViteLookup: shipsViteLookup(app.productionOutput) }
          : {}),
      }).toEqual({
        rows: [{ value: 42 }],
        workerTypes: [`classic`],
        wasmResponses: [{ status: 200, wasm: true }],
        lookupRequests: [],
        ...(app.productionOutput ? { shipsViteLookup: false } : {}),
      })
    } catch (error) {
      throw new Error(`${String(error)}\n${diagnostics.join(`\n`)}`, {
        cause: error,
      })
    } finally {
      await context.close()
      app.close()
    }
  },
  300_000,
)
