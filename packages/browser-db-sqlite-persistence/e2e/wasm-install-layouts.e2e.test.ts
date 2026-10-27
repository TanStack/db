// @vitest-environment node
/**
 * # Which installs open the packaged OPFS database without configuration?
 *
 * The built package finds its worker and WASM file through URLs relative to its
 * own code. A Vite production build and a Vite dev server that serves the
 * package in place both resolve those URLs. Vite's dependency optimizer moves
 * pre-bundled code into its cache and leaves the assets behind, so a moved copy
 * asks the dev server for the assets by package name, from the app root.
 *
 * The README promises this behavior:
 *
 * - Production builds open in every install layout.
 * - In development, a copy served in place opens with its own assets. A copy is
 *   served in place when `optimizeDeps.exclude` names the specifier that its
 *   importer uses, which is the alias name for an npm alias.
 * - A moved copy opens when the app root resolves the package name, and rejects
 *   with `PersistenceUnavailableError` when it does not. When the root resolves
 *   another installed copy, the moved copy loads that copy's assets.
 *
 * The model below states those rules over install layout, cache directory,
 * exclusion, and server. The driver installs the built package in each layout,
 * opens and queries it in Chromium, and records the outcome and which copy's
 * worker started. The model does not predict which copy a production build
 * emits; the copies are identical, so the driver does not observe it there.
 */
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { build, createServer, preview } from 'vite'
import type { Browser } from '@playwright/test'
import type { BrowserWASQLiteDatabase } from '../src'

const packageDirectory = fileURLToPath(new URL('../', import.meta.url))
const packageName = `@tanstack/browser-db-sqlite-persistence`
const aliasName = `sqlite-alias`

type Layout =
  `direct` | `hoisted` | `pnpm` | `transitive` | `alias` | `two copies`
type Cache = `default` | `custom` | `dist`
type Exclusion = `none` | `import name` | `package name`
type Server = `development` | `production`
type LayoutCase = {
  layout: Layout
  cache: Cache
  exclusion: Exclusion
  server: Server
}
type LayoutOutcome =
  { opens: false } | { opens: true; worker?: `imported copy` | `other copy` }

// The specifier that the opened copy's importer uses.
function importName(layout: Layout): string {
  return layout === `alias` ? aliasName : packageName
}

// Node resolution from the Vite root, which the dev server's lookup uses.
const appRootResolvesPackageName: Record<Layout, boolean> = {
  direct: true,
  hoisted: true,
  pnpm: true,
  transitive: false,
  alias: false,
  'two copies': true,
}

function expectedOutcome(layoutCase: LayoutCase): LayoutOutcome {
  if (layoutCase.server === `production`) return { opens: true }
  const servedInPlace =
    layoutCase.exclusion === `import name` ||
    (layoutCase.exclusion === `package name` &&
      importName(layoutCase.layout) === packageName)
  if (servedInPlace) return { opens: true, worker: `imported copy` }
  if (!appRootResolvesPackageName[layoutCase.layout]) return { opens: false }
  return {
    opens: true,
    worker: layoutCase.layout === `two copies` ? `other copy` : `imported copy`,
  }
}

/*
 * Histories: every layout with each cache directory while pre-bundled in
 * development, since only a moved copy depends on the cache path; every layout
 * excluded by its import name; an alias excluded by the package name, which
 * does not match its specifier; and every layout in a production build.
 */
const layouts: Array<Layout> = [
  `direct`,
  `hoisted`,
  `pnpm`,
  `transitive`,
  `alias`,
  `two copies`,
]
const layoutCases: Array<LayoutCase> = [
  ...layouts.flatMap((layout) =>
    ([`default`, `custom`, `dist`] as const).map((cache) => ({
      layout,
      cache,
      exclusion: `none` as const,
      server: `development` as const,
    })),
  ),
  ...layouts.map((layout) => ({
    layout,
    cache: `default` as const,
    exclusion: `import name` as const,
    server: `development` as const,
  })),
  {
    layout: `alias`,
    cache: `default`,
    exclusion: `package name`,
    server: `development`,
  },
  ...layouts.map((layout) => ({
    layout,
    cache: `default` as const,
    exclusion: `none` as const,
    server: `production` as const,
  })),
]

let browser: Browser
beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
})
afterAll(async () => {
  await browser.close()
})

it(`reaches every promised layout outcome`, () => {
  const outcomes = new Set(
    layoutCases.map((layoutCase) =>
      JSON.stringify(expectedOutcome(layoutCase)),
    ),
  )
  expect([...outcomes].sort()).toEqual(
    [
      { opens: false },
      { opens: true },
      { opens: true, worker: `imported copy` },
      { opens: true, worker: `other copy` },
    ]
      .map((outcome) => JSON.stringify(outcome))
      .sort(),
  )
})

it.each(layoutCases)(
  `$server $layout install (cache $cache, excluded by $exclusion) matches the layout model`,
  async (layoutCase) => {
    const temporaryDirectory = realpathSync(
      mkdtempSync(join(realpathSync(tmpdir()), `db-wasm-layout-`)),
    )
    try {
      const { appDirectory, importedCopy } = installLayout(
        temporaryDirectory,
        layoutCase.layout,
      )
      const observed = await openInLayout(
        appDirectory,
        importedCopy,
        layoutCase,
      )
      expect(observed).toEqual(expectedOutcome(layoutCase))
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true })
    }
  },
  120_000,
)

// Copies the built package to a directory, as an install would.
function copyPackage(destination: string, version?: string): void {
  mkdirSync(destination, { recursive: true })
  cpSync(join(packageDirectory, `dist`), join(destination, `dist`), {
    recursive: true,
  })
  const manifest = JSON.parse(
    readFileSync(join(packageDirectory, `package.json`), `utf8`),
  ) as Record<string, unknown>
  writeFileSync(
    join(destination, `package.json`),
    JSON.stringify(version ? { ...manifest, version } : manifest),
  )
}

// Links the package's workspace dependencies into a node_modules scope.
function linkDependencies(scopeDirectory: string): void {
  mkdirSync(scopeDirectory, { recursive: true })
  for (const name of [`db`, `db-sqlite-persistence-core`]) {
    symlinkSync(
      join(packageDirectory, `../${name}`),
      join(scopeDirectory, name),
      `dir`,
    )
  }
}

// A library that re-exports the package; only it depends on the package.
function writeWrapper(appModules: string): string {
  const wrapper = join(appModules, `wrapper`)
  mkdirSync(wrapper, { recursive: true })
  writeFileSync(
    join(wrapper, `package.json`),
    JSON.stringify({ name: `wrapper`, type: `module`, main: `index.js` }),
  )
  writeFileSync(
    join(wrapper, `index.js`),
    `export { openBrowserWASQLiteOPFSDatabase } from '${packageName}'\n`,
  )
  return wrapper
}

/**
 * Installs the built package in one layout. Returns the app directory and the
 * real directory of the copy that the app opens.
 */
function installLayout(
  root: string,
  layout: Layout,
): { appDirectory: string; importedCopy: string } {
  const appDirectory =
    layout === `hoisted` ? join(root, `apps/web`) : join(root, `app`)
  const appModules = join(appDirectory, `node_modules`)
  mkdirSync(appModules, { recursive: true })
  writeFileSync(
    join(appDirectory, `package.json`),
    JSON.stringify({ name: `web`, type: `module` }),
  )
  let importedCopy: string
  let entry = packageName
  switch (layout) {
    case `direct`:
      importedCopy = join(appModules, packageName)
      copyPackage(importedCopy)
      linkDependencies(join(appModules, `@tanstack`))
      break
    case `hoisted`:
      writeFileSync(
        join(root, `package.json`),
        JSON.stringify({ private: true, workspaces: [`apps/*`] }),
      )
      importedCopy = join(root, `node_modules`, packageName)
      copyPackage(importedCopy)
      linkDependencies(join(root, `node_modules/@tanstack`))
      break
    case `pnpm`: {
      // pnpm keeps real directories in .pnpm and links the direct dependency.
      const storeModules = join(
        appModules,
        `.pnpm/@tanstack+browser-db-sqlite-persistence@1.0.0/node_modules`,
      )
      importedCopy = join(storeModules, packageName)
      copyPackage(importedCopy)
      linkDependencies(join(storeModules, `@tanstack`))
      mkdirSync(join(appModules, `@tanstack`), { recursive: true })
      symlinkSync(importedCopy, join(appModules, packageName), `dir`)
      break
    }
    case `transitive`:
    case `two copies`: {
      const wrapper = writeWrapper(appModules)
      importedCopy = join(wrapper, `node_modules`, packageName)
      copyPackage(importedCopy, `0.0.0-nested`)
      linkDependencies(join(appModules, `@tanstack`))
      if (layout === `two copies`) copyPackage(join(appModules, packageName))
      entry = `wrapper`
      break
    }
    case `alias`:
      importedCopy = join(appModules, aliasName)
      copyPackage(importedCopy)
      linkDependencies(join(appModules, `@tanstack`))
      entry = aliasName
      break
  }
  writeFileSync(
    join(appDirectory, `index.html`),
    `<script type="module" src="./main.js"></script>`,
  )
  writeFileSync(
    join(appDirectory, `main.js`),
    `import { openBrowserWASQLiteOPFSDatabase } from '${entry}';
globalThis.openDatabase = () => openBrowserWASQLiteOPFSDatabase({ databaseName: 'layout.sqlite', timeoutMs: 0 });`,
  )
  return { appDirectory, importedCopy: realpathSync(importedCopy) }
}

async function openInLayout(
  appDirectory: string,
  importedCopy: string,
  layoutCase: LayoutCase,
): Promise<LayoutOutcome> {
  const config = {
    configFile: false as const,
    root: appDirectory,
    base: `/nested/`,
    logLevel: `error` as const,
    cacheDir:
      layoutCase.cache === `custom`
        ? join(appDirectory, `node_modules/.cache/vite`)
        : layoutCase.cache === `dist`
          ? join(appDirectory, `node_modules/.cache/dist`)
          : undefined,
    optimizeDeps:
      layoutCase.exclusion === `none`
        ? undefined
        : {
            exclude: [
              layoutCase.exclusion === `import name`
                ? importName(layoutCase.layout)
                : packageName,
            ],
          },
  }
  let developmentServer: Awaited<ReturnType<typeof createServer>> | undefined
  let productionServer: Awaited<ReturnType<typeof preview>> | undefined
  if (layoutCase.server === `production`) {
    await build({ ...config, build: { outDir: join(appDirectory, `dist`) } })
    productionServer = await preview({
      ...config,
      preview: { host: `127.0.0.1`, port: 0 },
    })
  } else {
    developmentServer = await createServer({
      ...config,
      // Files are written just before the server starts. A late watcher event
      // would reload the page during the open, so these servers do not watch.
      server: { host: `127.0.0.1`, port: 0, watch: null },
    })
    await developmentServer.listen()
  }
  const page = await browser.newPage()
  const workerUrls: Array<string> = []
  const diagnostics: Array<string> = []
  page.on(`worker`, (worker) => workerUrls.push(worker.url()))
  page.on(`pageerror`, (error) => diagnostics.push(error.message))
  page.on(`response`, (response) => {
    if (response.status() >= 400) {
      diagnostics.push(`${response.status()} ${response.url()}`)
    }
  })
  try {
    const server = developmentServer ?? productionServer
    await page.goto(server!.resolvedUrls!.local[0]!)
    const opened = await page.evaluate(async () => {
      const { openDatabase } = globalThis as typeof globalThis & {
        openDatabase: () => Promise<BrowserWASQLiteDatabase>
      }
      try {
        const database = await openDatabase()
        try {
          await database.execute(`SELECT 42 AS value`)
          return { opens: true as const }
        } finally {
          await database.close?.()
        }
      } catch (error) {
        return { opens: false as const, name: (error as Error).name }
      }
    })
    if (!opened.opens) {
      // Any rejection other than the promised one is reported in full.
      if (opened.name !== `PersistenceUnavailableError`) {
        throw new Error(`${opened.name}\n${diagnostics.join(`\n`)}`)
      }
      return { opens: false }
    }
    if (layoutCase.server === `production`) return { opens: true }
    expect(workerUrls).toHaveLength(1)
    // Vite serves a file under the root by its root path and one outside the
    // root under /@fs/ with its absolute path.
    const workerPath = decodeURIComponent(new URL(workerUrls[0]!).pathname)
    const importedPath = importedCopy.startsWith(`${appDirectory}/`)
      ? importedCopy.slice(appDirectory.length)
      : importedCopy
    return {
      opens: true,
      worker: workerPath.includes(`${importedPath}/`)
        ? `imported copy`
        : `other copy`,
    }
  } finally {
    await page.close()
    await developmentServer?.close()
    await productionServer?.close()
  }
}
