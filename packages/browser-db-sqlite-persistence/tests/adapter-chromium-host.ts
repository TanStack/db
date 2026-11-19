/** Vitest controls a real Chromium page; no browser premise is simulated. */
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import type { PluginOption } from 'vite'

export async function startAdapterChromium({
  entry = `/packages/browser-db-sqlite-persistence/e2e/trailbase-lifecycle.html`,
  ready = `runTrailBaseHydration`,
  allow = [] as Array<string>,
  plugins = [] as Array<PluginOption>,
} = {}) {
  const root = resolve(import.meta.dirname, `../../..`)
  const server = await createServer({
    configFile: resolve(
      root,
      `packages/browser-db-sqlite-persistence/vite.opfs.config.ts`,
    ),
    root,
    plugins: [
      ...plugins,
      {
        name: `receiving-module-isolation`,
        configResolved(config) {
          // Vite's file-config merge drops inline nulls. Set this after that
          // merge so worktree edits cannot reload an active receiving page.
          config.server.watch = null
        },
      },
    ],
    // Discover only this receiving page's dependencies, not unrelated HTML
    // projects elsewhere in the repository.
    optimizeDeps: {
      entries: [
        entry.startsWith(`/@fs/`) ? entry.slice(4) : resolve(root, `.${entry}`),
      ],
    },
    resolve: {
      alias: {
        '@tanstack/query-core': resolve(
          root,
          `packages/query-db-collection/node_modules/@tanstack/query-core`,
        ),
      },
    },
    server: {
      host: `127.0.0.1`,
      port: 0,
      hmr: false,
      fs: { allow: [root, ...allow] },
      headers: {
        'Cross-Origin-Opener-Policy': `same-origin`,
        'Cross-Origin-Embedder-Policy': `require-corp`,
      },
    },
  })
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    await server.listen()
    const channel =
      process.env.PLAYWRIGHT_CHANNEL ?? (process.env.CI ? undefined : `chrome`)
    browser = await chromium.launch({
      ...(channel ? { channel } : {}),
      headless: true,
    })
    const context = await browser.newContext()
    const page = await context.newPage()
    const errors: Array<string> = []
    page.on(`pageerror`, (error) => errors.push(error.message))
    const address = server.httpServer!.address()
    if (!address || typeof address === `string`) throw new Error(`No Vite port`)
    await page.goto(`http://127.0.0.1:${address.port}${entry}`)
    await page.waitForFunction((name) => name in window, ready)
    if (errors.length) {
      const failures = errors.map((message) => new Error(message))
      throw new AggregateError(
        failures,
        `Browser startup failed: ${errors.join(`; `)}`,
        {
          cause: failures[0],
        },
      )
    }
    return {
      page,
      errors,
      watchedPaths: () => server.watcher.getWatched(),
      async close() {
        await withOracleCleanup(() => browser!.close(), [() => server.close()])
      },
    }
  } catch (error) {
    return withOracleCleanup(() => {
      throw error
    }, [() => browser?.close(), () => server.close()])
  }
}

// Errors are append-only. A cursor consumes them once; diagnostics that arrive
// between histories are checked by the next one, with arrival-only attribution.
const consumedBrowserErrors = new WeakMap<object, number>()

/**
 * Record one history's browser diagnostics without replacing its product
 * result. The shared comparison judges that result first. An exception before
 * a result remains primary and carries browser diagnostics as secondary.
 */
export async function captureBrowserHistory<T>(
  host: { errors: ReadonlyArray<string> },
  run: () => Promise<T>,
): Promise<T & { browserErrors: ReadonlyArray<string> }> {
  const offset = consumedBrowserErrors.get(host) ?? 0
  const takeErrors = () => {
    const errors = host.errors.slice(offset)
    consumedBrowserErrors.set(host, host.errors.length)
    return errors
  }
  try {
    const result = await run()
    return { ...result, browserErrors: takeErrors() }
  } catch (error) {
    const browserErrors = takeErrors()
    if (!browserErrors.length) throw error
    throw new AggregateError(
      [error, ...browserErrors.map((message) => new Error(message))],
      `History failed; secondary browser errors: ${browserErrors.join(`; `)}`,
      { cause: error },
    )
  }
}
