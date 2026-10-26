import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { readOracleRunConfig } from './oracle-config.js'
import { oracleReplayManifest } from './oracle-replay-manifest.js'
import type { OracleReplayWitness } from './oracle-replay-witness.js'

/**
 * Guard one named replay in a real Vitest child process.
 *
 * The child inherits ordinary file/name filters but receives a private witness
 * channel. Success requires both a zero Vitest exit and at least one completed,
 * nonzero run for the exact manifest property, seed, and path. A skipped or
 * filtered property therefore cannot look green. Direct Vitest commands remain
 * valid discovery runs, but they do not make this replay-evidence claim.
 */
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
    `oracle replay target ${property}: ${entry?.status ?? `missing manifest entry`}` +
      (entry?.command === undefined
        ? ``
        : `. Replay it with: ${entry.environment.join(` `)} ${entry.command}`),
  )
}

function selectReplayTest(args: Array<string>, pattern: string): Array<string> {
  const filters: Array<string> = [pattern]
  const forwarded: Array<string> = []
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!
    if (argument === `-t` || argument === `--testNamePattern`) {
      const filter = args[++index]
      if (filter === undefined)
        throw new Error(`${argument} requires a test name pattern`)
      filters.push(filter)
    } else if (argument.startsWith(`--testNamePattern=`)) {
      filters.push(argument.slice(`--testNamePattern=`.length))
    } else {
      forwarded.push(argument)
    }
  }
  // The manifest selects the named random/replay lane. Caller filters can
  // narrow that lane, but cannot replace it with a fixed or unrelated test.
  const intersection = `^${filters
    .map((filter) => `(?=[\\s\\S]*(?:${filter}))`)
    .join(``)}`
  return [...forwarded, `-t`, intersection]
}

const directory = mkdtempSync(join(tmpdir(), `tanstack-oracle-replay-`))
const channel = join(directory, `witness.jsonl`)
let primaryFailure: unknown
let hasPrimaryFailure = false
let caughtError: unknown
let caught = false
let cleanupFailure: unknown
let cleanupFailed = false
try {
  const require = createRequire(import.meta.url)
  const vitest = join(
    dirname(require.resolve(`vitest/package.json`)),
    `vitest.mjs`,
  )
  const requestedArgs = process.argv.slice(2)
  const args =
    entry.testNamePattern === undefined
      ? requestedArgs
      : selectReplayTest(requestedArgs, entry.testNamePattern)
  // A synchronous property rejects the async witness before it runs, so the
  // first attempt records nothing and fails. Retry once with the synchronous
  // witness. An async property records its witness on the first attempt.
  const attempt = (mode: `async` | `sync`) => {
    rmSync(channel, { force: true })
    const run = spawnSync(process.execPath, [vitest, `run`, ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TANSTACK_DB_ORACLE_REPLAY_WITNESS: channel,
        TANSTACK_DB_ORACLE_REPLAY_WITNESS_MODE: mode,
      },
      stdio: `inherit`,
    })
    if (run.error) throw run.error
    const lines = existsSync(channel)
      ? readFileSync(channel, `utf8`).trim()
      : ``
    const recorded: Array<OracleReplayWitness> =
      lines === ``
        ? []
        : lines
            .split(`\n`)
            .map((line: string) => JSON.parse(line) as OracleReplayWitness)
    return { run, recorded }
  }
  let { run: result, recorded: witnesses } = attempt(`async`)
  let witnessMode: `async` | `sync` = `async`
  if (witnesses.length === 0 && result.status !== 0) {
    ;({ run: result, recorded: witnesses } = attempt(`sync`))
    witnessMode = `sync`
  }
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
      witnessMode,
      witnesses,
      executions: reached.length,
    })}`,
  )
  if (reached.length === 0) {
    console.error(`oracle replay target never executed: ${property}`)
    primaryFailure = new Error(
      `oracle replay target never executed: ${property}`,
    )
    hasPrimaryFailure = true
  }
  const failed = reached.some((witness) => witness.failed)
  if (failed) {
    console.error(`oracle replay property failed: ${property}`)
    primaryFailure = new Error(`oracle replay property failed: ${property}`)
    hasPrimaryFailure = true
  }
  if (result.status !== 0 && primaryFailure === undefined) {
    primaryFailure = new Error(`oracle replay child exited: ${result.status}`)
    hasPrimaryFailure = true
  }
  // A reached property never turns a failed test, hook, or worker into success.
  process.exitCode =
    result.status === 0 && reached.length > 0 && !failed
      ? 0
      : result.status || 1
} catch (error) {
  primaryFailure = error
  hasPrimaryFailure = true
  caughtError = error
  caught = true
} finally {
  try {
    rmSync(directory, { recursive: true, force: true })
  } catch (error) {
    cleanupFailure = error
    cleanupFailed = true
  }
  if (
    !cleanupFailed &&
    process.env.TANSTACK_DB_ORACLE_REPLAY_TEST_CLEANUP_FAILURE === `1`
  ) {
    cleanupFailure = new Error(`replay cleanup sentinel`)
    cleanupFailed = true
  }
}
if (cleanupFailed) {
  if (hasPrimaryFailure) {
    throw new AggregateError(
      [cleanupFailure],
      `oracle replay failed and cleanup also failed`,
      { cause: primaryFailure },
    )
  }
  throw cleanupFailure
}
if (caught) throw caughtError
