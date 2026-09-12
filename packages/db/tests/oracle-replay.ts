import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { readOracleRunConfig } from './oracle-config.js'
import { oracleReplayManifest } from './oracle-replay-manifest.js'
import type { OracleReplayWitness } from './oracle-replay-witness.js'

// Run from the target package, with ordinary Vitest file/name filters:
// TANSTACK_DB_ORACLE_SEED=42 TANSTACK_DB_ORACLE_PATH=0 \
// TANSTACK_DB_ORACLE_PROPERTY=... node --import tsx tests/oracle-replay.ts tests/...
// Legacy direct Vitest commands are unchanged and do not provide this guard.
const config = readOracleRunConfig()
const property = config.replayProperty
if (property === undefined) {
  throw new Error(`oracle-replay requires seed, path, and property`)
}
const entry = oracleReplayManifest.find(
  (candidate) => candidate.property === property,
)
if (entry?.status !== `assertion`) {
  throw new Error(
    `oracle replay target ${property}: ${entry?.status ?? `missing manifest entry`}`,
  )
}

const directory = mkdtempSync(join(tmpdir(), `tanstack-oracle-replay-`))
const channel = join(directory, `witness.jsonl`)
try {
  const require = createRequire(import.meta.url)
  const vitest = join(
    dirname(require.resolve(`vitest/package.json`)),
    `vitest.mjs`,
  )
  const args = process.argv.slice(2)
  const result = spawnSync(process.execPath, [vitest, `run`, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, TANSTACK_DB_ORACLE_REPLAY_WITNESS: channel },
    stdio: `inherit`,
  })
  if (result.error) throw result.error
  const records = existsSync(channel)
    ? readFileSync(channel, `utf8`).trim()
    : ``
  const witnesses: Array<OracleReplayWitness> =
    records === ``
      ? []
      : records
          .split(`\n`)
          .map((line: string) => JSON.parse(line) as OracleReplayWitness)
  const reached = witnesses.filter(
    (witness) =>
      witness.property === property &&
      witness.seed === config.replaySeed &&
      witness.path === config.replayPath &&
      witness.numRuns > 0,
  )
  console.log(
    `Oracle replay: ${JSON.stringify({
      property,
      seed: config.replaySeed,
      path: config.replayPath,
      owner: entry.file,
      command: [process.execPath, vitest, `run`, ...args],
      witnesses,
      executions: reached.length,
    })}`,
  )
  if (reached.length === 0) {
    console.error(`oracle replay target never executed: ${property}`)
  }
  const failed = reached.some((witness) => witness.failed)
  if (failed) console.error(`oracle replay property failed: ${property}`)
  // A reached property never turns a failed test, hook, or worker into success.
  process.exitCode =
    result.status === 0 && reached.length > 0 && !failed
      ? 0
      : result.status || 1
} finally {
  rmSync(directory, { recursive: true, force: true })
}
