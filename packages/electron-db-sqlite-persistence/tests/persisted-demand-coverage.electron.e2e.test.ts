/**
 * # Receiving witness: persisted demand coverage over Electron
 *
 * Law and authority: the receiving contract
 * (`packages/db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-contract.ts`)
 * holds the histories and records the sessions. The law is
 * `docs/contributing/oracle-reviews/2026-10-20-on-demand-network-first-law.md`,
 * and the primary oracle `packages/db-sqlite-persistence-core/tests/persisted-demand-coverage-oracle.test.ts`
 * owns it across its cells. This file is the Electron host. It runs the
 * histories through the real Electron persistence path: the renderer's
 * `createElectronSQLitePersistence` over real IPC to the main process's
 * `exposeElectronSQLitePersistence`, with `node:sqlite` in main (Electron's
 * ABI cannot load better-sqlite3). The node witness covers better-sqlite3.
 *
 * Histories: every history of `RECEIVING_HISTORIES`, each with its own
 * database file, one per history. The test launches Electron twice. Phase 1
 * is an online app launch that records each history's session 1 log. Phase 2
 * is a later, separate app launch over the same files that records each
 * history's session 2. Session 2's upstream behavior is the history's.
 *
 * Production path: the renderer driver
 * (`tests/e2e/persisted-demand-coverage/renderer.ts`) calls the contract's
 * recorders in a real renderer, and each history opens its main-process session
 * over IPC.
 *
 * Observations: the records carry the source log, the loads the source
 * received, and two session 2 checkpoints with their elapsed time since the
 * forward. The shared judge compares them with the law.
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
import {
  RECEIVING_HISTORIES,
  coverageRecords,
} from '../../db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-contract'
import { coverageViolations } from '../../db-sqlite-persistence-core/tests/persisted-demand-coverage-model-oracle'
import type {
  Session1Record,
  Session2Record,
} from '../../db-sqlite-persistence-core/tests/contracts/persisted-demand-coverage-receiving-contract'

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  `e2e`,
  `persisted-demand-coverage`,
)
const packages = resolve(fixture, `../../../..`)
const RESULT_PREFIX = `__TANSTACK_DB_DEMAND_COVERAGE__:`
const APP_TIMEOUT_MS = 240_000

type PhaseResult = {
  phase: `1` | `2`
  results: Array<{
    name: string
    error?: string
    session1?: Session1Record
    session2?: Session2Record
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

it(`real Electron records every persisted demand coverage history across two app launches`, async () => {
  const out = mkdtempSync(join(tmpdir(), `demand-coverage-app-`))
  const databases = mkdtempSync(join(tmpdir(), `demand-coverage-db-`))
  onTestFinished(() => {
    rmSync(out, { recursive: true, force: true })
    rmSync(databases, { recursive: true, force: true })
  })
  await bundle(out)

  const session1 = await runPhase(out, databases, `1`)
  expect(session1.results.map(({ name }) => name)).toEqual(
    RECEIVING_HISTORIES.map(({ id }) => id),
  )
  expect(session1.results.filter(({ error }) => error !== undefined)).toEqual(
    [],
  )

  const session2 = await runPhase(out, databases, `2`)
  expect(session2.results.map(({ name }) => name)).toEqual(
    RECEIVING_HISTORIES.map(({ id }) => id),
  )
  expect(session2.results.filter(({ error }) => error !== undefined)).toEqual(
    [],
  )
  // Positive witness: each session 2 asked the offline source for the demand.
  for (const result of session2.results) {
    expect(result.session2?.sent.length ?? 0).toBeGreaterThan(0)
  }
  // Each history's session 1 log and session 2 record go to the shared judge,
  // one judgment per checkpoint.
  for (const history of RECEIVING_HISTORIES) {
    const session1Record = session1.results.find(
      ({ name }) => name === history.id,
    )?.session1
    const session2Record = session2.results.find(
      ({ name }) => name === history.id,
    )?.session2
    expect(session1Record).toBeDefined()
    expect(session2Record).toBeDefined()
    const records = coverageRecords(
      history,
      session1Record as Session1Record,
      session2Record as Session2Record,
    )
    expect(coverageViolations(records.beforeDeadline), history.id).toEqual([])
    expect(coverageViolations(records.afterDeadline), history.id).toEqual([])
  }
}, 600_000)
