/**
 * Real Electron checkpoint for the reload class oracle in
 * `packages/db-sqlite-persistence-core/tests/reload-class-oracle.ts`. It
 * bundles the app driver in `tests/e2e/reload-class/`, starts one real
 * Electron app, and reads the published result: every fixed history's
 * violations from the oracle's own comparison. A failure before a history's
 * checkpoint stays distinct from a law violation.
 */
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import electronPath from 'electron'
import { expect, it, onTestFinished } from 'vitest'
import { declareOracle } from '../../db/tests/oracle-declaration.js'

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  `e2e`,
  `reload-class`,
)
const packages = resolve(fixture, `../../../..`)
const RESULT_PREFIX = `__TANSTACK_DB_RELOAD_CLASS__:`
const APP_TIMEOUT_MS = 540_000

type Result = {
  expected: Array<string>
  results: Array<{
    name: string
    violations?: Array<string>
    failedBeforeCheckpoint?: string
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
    'better-sqlite3': join(fixture, `better-sqlite3-unavailable.cjs`),
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

function runApp(out: string, databases: string): Promise<Result> {
  return new Promise((resolveResult, reject) => {
    // Launch as the runtime bridge e2e does: Linux CI has no display and no
    // configured setuid sandbox.
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
          RELOAD_CLASS_PRELOAD: join(out, `preload.cjs`),
          RELOAD_CLASS_PAGE: join(out, `page.html`),
          RELOAD_CLASS_DB_DIR: databases,
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
      reject(new Error(`no result in time: ${stderr.slice(-2_000)}`))
    }, APP_TIMEOUT_MS)
    child.on(`error`, (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on(`exit`, (code) => {
      clearTimeout(timer)
      const line = stdout.split(`\n`).find((l) => l.startsWith(RESULT_PREFIX))
      if (!line) {
        reject(new Error(`no result (exit ${code}): ${stderr.slice(-2_000)}`))
        return
      }
      resolveResult(JSON.parse(line.slice(RESULT_PREFIX.length)) as Result)
    })
  })
}

// The app's comparison of each fixed reload history with the oracle: every
// expected history reports, and none reports a violation.
function expectReloadClassLawsHold(result: Result): void {
  expect(result.expected.length).toBeGreaterThan(0)
  expect(result.results.map(({ name }) => name)).toEqual(result.expected)
  expect(
    result.results.filter(
      (entry) =>
        entry.failedBeforeCheckpoint !== undefined ||
        (entry.violations?.length ?? 0) > 0,
    ),
  ).toEqual([])
}

declareOracle({ check: [expectReloadClassLawsHold] })

it(`real Electron reload is free of avoidable work ahead of its reads`, async () => {
  const out = mkdtempSync(join(tmpdir(), `reload-class-app-`))
  const databases = mkdtempSync(join(tmpdir(), `reload-class-db-`))
  onTestFinished(() => {
    rmSync(out, { recursive: true, force: true })
    rmSync(databases, { recursive: true, force: true })
  })
  await bundle(out)
  const result = await runApp(out, databases)
  if (process.env.RELOAD_ORACLE_DEBUG) console.log(JSON.stringify(result))
  expectReloadClassLawsHold(result)
}, 600_000)
