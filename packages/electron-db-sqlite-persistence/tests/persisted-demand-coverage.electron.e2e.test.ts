/**
 * # Receiving witness: persisted demand coverage over Electron
 *
 * Law (`docs/contributing/oracle-reviews/2026-10-20-on-demand-network-first-law.md`,
 * and the primary oracle `packages/db-sqlite-persistence-core/tests/persisted-demand-coverage-oracle.test.ts`):
 * with `initialRender: { strategy: 'network-first', networkTimeoutMs }` on a
 * persisted `syncMode: 'on-demand'` Collection, a demand that an earlier
 * online session loaded settles from SQLite in a later offline session once
 * the wait has passed. A never-loaded demand stays loading. A row deleted
 * after coverage ends coverage. An ordered window (`orderBy rank`, `limit 2`)
 * settles only while its restore holds the rows it held when it settled.
 *
 * Authority: the primary oracle owns the law across its cells. This file is a
 * receiving witness: it checks the same law through the real Electron
 * persistence path, the renderer's `createElectronSQLitePersistence` over real
 * IPC to the main process's `exposeElectronSQLitePersistence`, with the Node
 * persistence over `node:sqlite` in main (Electron's ABI cannot load
 * better-sqlite3). The node witness covers better-sqlite3 directly.
 *
 * Histories (each has two sessions over one database file, one per history):
 * - `covered`: session 1 is online and loads D (`group = 'a'`) with a1 and a2.
 * - `never`: session 1 never asks for D.
 * - `deleted`: session 1 loads D, then the source deletes a1.
 * - `window-covered`: session 1 loads `group = 'a' orderBy rank limit 2` with
 *   a1, a2, a3 in the source, so the window holds a1 and a2.
 * - `window-replaced`: as `window-covered`, then the source deletes a1 and
 *   inserts a15 at rank 1.5, below the boundary.
 * Session 2 is offline: its upstream load is recorded and never answers.
 *
 * Production path: the test launches one real Electron app for phase 1 and a
 * second, separate app launch for phase 2. Each launch runs the renderer
 * driver (`tests/e2e/persisted-demand-coverage/renderer.ts`) in a real
 * renderer. Session 2 opens the same database file through a new main-process
 * session, with a wait of `SESSION_2_WAIT_MS`, and runs the query's preload.
 *
 * Observations and checkpoints (phase 2 only):
 * - `beforeDeadline`: after the upstream load is forwarded and 100 ms have
 *   passed, while the wait has not passed. Every history must still be loading.
 * - `afterDeadline`: after polling up to `AFTER_DEADLINE_POLL_MS` for the
 *   query to leave loading. Covered histories must be ready with the restored
 *   rows. Other histories must still be loading.
 * - Positive witness: session 2's upstream load was forwarded, so the offline
 *   source was asked. Phase 1 also checks that session 1 held a1 and a2 online.
 *
 * Mutant evidence (run in a temporary copy, see the coverage map): with
 * `SESSION_2_WAIT_MS = 60_000` in the renderer driver, the covered histories
 * stay loading at `afterDeadline` and fail.
 *
 * Limits: one driver (Electron renderer over IPC to a node:sqlite main
 * process, one window, single-process coordinator). It does not cover
 * `ElectronCollectionCoordinator`, multi-window coordination, or the
 * better-sqlite3 driver (the node witness covers it).
 */
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import electronPath from 'electron'
import { expect, it, onTestFinished } from 'vitest'

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  `e2e`,
  `persisted-demand-coverage`,
)
const packages = resolve(fixture, `../../../..`)
const RESULT_PREFIX = `__TANSTACK_DB_DEMAND_COVERAGE__:`
const APP_TIMEOUT_MS = 240_000

const HISTORY_NAMES = [
  `covered`,
  `never`,
  `deleted`,
  `window-covered`,
  `window-replaced`,
] as const

// The expected session 2 settlement of each history, from the law.
const SETTLES: Record<(typeof HISTORY_NAMES)[number], boolean> = {
  covered: true,
  never: false,
  deleted: false,
  'window-covered': true,
  'window-replaced': false,
}

type Observation = {
  status: string
  rows?: Array<string>
  upstreamCalls: number
}

type PhaseResult = {
  phase: `1` | `2`
  results: Array<{
    name: string
    error?: string
    beforeDeadline?: Observation
    afterDeadline?: Observation
  }>
}

async function bundle(out: string) {
  const alias = {
    '@tanstack/db': join(packages, `db/src`),
    '@tanstack/db-ivm': join(packages, `db-ivm/src`),
    '@tanstack/db-sqlite-persistence-core': join(
      packages,
      `db-sqlite-persistence-core/src`,
    ),
    // Electron's ABI cannot load the native module; main passes a database.
    'better-sqlite3': join(
      fixture,
      `..`,
      `reload-class`,
      `better-sqlite3-unavailable.cjs`,
    ),
  }
  await build({
    entryPoints: [join(fixture, `main.ts`)],
    outfile: join(out, `main.mjs`),
    bundle: true,
    platform: `node`,
    format: `esm`,
    external: [`electron`],
    alias,
    banner: {
      js: `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);`,
    },
  })
  await build({
    entryPoints: [join(fixture, `renderer.ts`)],
    outfile: join(out, `renderer.js`),
    bundle: true,
    platform: `browser`,
    format: `iife`,
    alias,
  })
  copyFileSync(join(fixture, `preload.cjs`), join(out, `preload.cjs`))
  copyFileSync(join(fixture, `page.html`), join(out, `page.html`))
}

// One real Electron app launch per phase. Phase 2 is a new process, so it
// shares nothing with phase 1 except the database files on disk.
function runPhase(
  out: string,
  databases: string,
  phase: `1` | `2`,
): Promise<PhaseResult> {
  return new Promise((resolveResult, reject) => {
    // Launch as the reload class and runtime bridge e2e do: Linux CI has no
    // display and no configured setuid sandbox.
    const electronArgs = [
      `--disable-gpu`,
      `--disable-dev-shm-usage`,
      `--no-sandbox`,
      join(out, `main.mjs`),
    ]
    const xvfbRun = `/usr/bin/xvfb-run`
    const useXvfb = existsSync(xvfbRun)
    const child = spawn(
      useXvfb ? xvfbRun : (electronPath as unknown as string),
      useXvfb
        ? [
            `-a`,
            `--server-args=-screen 0 1280x720x24`,
            electronPath as unknown as string,
            ...electronArgs,
          ]
        : electronArgs,
      {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: undefined,
          DEMAND_COVERAGE_PHASE: phase,
          DEMAND_COVERAGE_PRELOAD: join(out, `preload.cjs`),
          DEMAND_COVERAGE_PAGE: join(out, `page.html`),
          DEMAND_COVERAGE_DIR: databases,
        },
      },
    )
    let stdout = ``
    let stderr = ``
    child.stdout.on(`data`, (chunk) => (stdout += String(chunk)))
    child.stderr.on(`data`, (chunk) => (stderr += String(chunk)))
    // A hung app is reported with its stderr before the test times out.
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`phase ${phase} had no result: ${stderr.slice(-2_000)}`))
    }, APP_TIMEOUT_MS)
    child.on(`error`, (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on(`exit`, (code) => {
      clearTimeout(timer)
      const line = stdout.split(`\n`).find((l) => l.startsWith(RESULT_PREFIX))
      if (!line) {
        reject(
          new Error(
            `phase ${phase} had no result (exit ${code}): ${stderr.slice(-2_000)}`,
          ),
        )
        return
      }
      resolveResult(JSON.parse(line.slice(RESULT_PREFIX.length)) as PhaseResult)
    })
  })
}

it(`real Electron session 2 settles a covered demand offline and keeps the others loading`, async () => {
  const out = mkdtempSync(join(tmpdir(), `demand-coverage-app-`))
  const databases = mkdtempSync(join(tmpdir(), `demand-coverage-db-`))
  onTestFinished(() => {
    rmSync(out, { recursive: true, force: true })
    rmSync(databases, { recursive: true, force: true })
  })
  await bundle(out)

  const session1 = await runPhase(out, databases, `1`)
  expect(session1.results.map(({ name }) => name)).toEqual(HISTORY_NAMES)
  expect(session1.results.filter(({ error }) => error !== undefined)).toEqual(
    [],
  )

  const session2 = await runPhase(out, databases, `2`)
  expect(session2.results.map(({ name }) => name)).toEqual(HISTORY_NAMES)
  // One table for all histories, so a failure shows every history's outcome.
  // Each history waits for the network before it may settle (`beforeStatus`),
  // and session 2 must have asked the offline source (`forwarded`).
  const observed = session2.results.map(
    ({ name, error, beforeDeadline, afterDeadline }) => ({
      name,
      error,
      beforeStatus: beforeDeadline?.status,
      forwarded: (afterDeadline?.upstreamCalls ?? 0) > 0,
      status: afterDeadline?.status,
      rows: afterDeadline?.rows,
    }),
  )
  const expected = HISTORY_NAMES.map((name) => ({
    name,
    beforeStatus: `loading`,
    forwarded: true,
    ...(SETTLES[name]
      ? { status: `ready`, rows: [`a1`, `a2`] }
      : { status: `loading`, rows: undefined }),
  }))
  expect(observed).toEqual(expected)
}, 600_000)
