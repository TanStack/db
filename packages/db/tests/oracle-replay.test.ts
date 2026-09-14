import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { oracleReplayManifest } from './oracle-replay-manifest.js'
import { oracleReplayReporter } from './oracle-replay-witness.js'
import {
  oracleRandomParameters,
  registeredOracleProperties,
} from './oracle-config.js'

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), `..`)
const repositoryDirectory = resolve(packageDirectory, `../..`)
const fixture = `tests/oracle-replay.fixture.test.ts`

function runReplay(
  args: Array<string> = [fixture],
  fault?: string,
  property = `oracle-replay.calibration`,
): { status: number | null; output: string } {
  const result = spawnSync(
    process.execPath,
    [
      `--import`,
      `tsx`,
      `tests/oracle-replay.ts`,
      ...args,
      `--maxWorkers=1`,
      `--coverage.enabled=false`,
    ],
    {
      cwd: packageDirectory,
      env: {
        ...process.env,
        TANSTACK_DB_ORACLE_RUNS_MULTIPLIER: `1`,
        TANSTACK_DB_ORACLE_SEED: `42`,
        TANSTACK_DB_ORACLE_PATH: `0`,
        TANSTACK_DB_ORACLE_PROPERTY: property,
        TANSTACK_DB_ORACLE_REPLAY_CALIBRATION: fault,
      },
      encoding: `utf8`,
      timeout: 30_000,
    },
  )
  if (result.error) throw result.error
  return { status: result.status, output: result.stdout + result.stderr }
}

describe(`guarded oracle replay`, () => {
  // spawnSync blocks the worker. Let progress replies arrive between complete
  // replays instead of starving Vitest's RPC channel across the whole suite.
  afterEach(() => setImmediate())

  it.each([
    [
      `sorted-map.key`,
      `tests/SortedMap.test.ts`,
      `SortedMap key history.*seed undefined`,
    ],
    [
      `sorted-map.ascending`,
      `tests/SortedMap.test.ts`,
      `SortedMap ascending history.*seed undefined`,
    ],
    [
      `sorted-map.descending`,
      `tests/SortedMap.test.ts`,
      `SortedMap descending history.*seed undefined`,
    ],
    [
      `collection-state.mixed-transaction`,
      `tests/optimistic-transaction-oracle.property.test.ts`,
      `varies full payloads, seed=undefined`,
    ],
    [
      `query-identity.compiled-output`,
      `tests/query/identity-output-shape-oracle.test.ts`,
      `varies safe aliases and payloads, seed=undefined`,
    ],
    [
      `load-subset.rejected-waiter`,
      `tests/query/load-subset-oracle.property.test.ts`,
      `retries failed exact demand histories through fresh success for a random or replayed seed`,
    ],
  ])(
    `executes the actual named owner %s and rejects a filtered target`,
    (property, file, randomName) => {
      const executed = runReplay([file, `-t`, randomName], undefined, property)
      expect(executed.status, executed.output).toBe(0)
      expect(executed.output).toContain(`"executions":1`)
      const excluded = runReplay(
        [file, `tests/utils.test.ts`, `-t`, `oracle run configuration`],
        undefined,
        property,
      )
      expect(excluded.status, excluded.output).toBe(1)
      expect(excluded.output).toContain(`oracle replay target never executed`)
      expect(excluded.output).toContain(`"executions":0`)
    },
    60_000,
  )

  it(`rejects a property failure even when the test framework expects failure`, () => {
    const result = runReplay([fixture], `expected`)
    expect(result.status, result.output).toBe(1)
    expect(result.output).toContain(`oracle replay property failed`)
    expect(result.output).toContain(`"failed":true`)
    expect(result.output).toContain(`"executions":1`)
  }, 40_000)

  it.each([[fixture], [fixture, `tests/utils.test.ts`]])(
    `accepts a completed target among selected files %j`,
    (...files) => {
      const result = runReplay(files)
      expect(result.status, result.output).toBe(0)
      expect(result.output).toContain(`"executions":1`)
      expect(result.output).toContain(`"numRuns":3`)
    },
    40_000,
  )

  it.each([
    {
      name: `wrong file`,
      args: [`tests/utils.test.ts`, `-t`, `oracle run configuration`],
    },
    {
      name: `excluded test`,
      args: [fixture, `-t`, `unrelated calibration assertion`],
    },
    { name: `skipped property`, fault: `skip` },
    { name: `zero property runs`, fault: `zero` },
    { name: `overridden seed`, fault: `seed` },
    { name: `overridden path`, fault: `path` },
  ])(
    `rejects $name even when Vitest succeeds`,
    ({ args, fault }) => {
      const result = runReplay(args, fault)
      expect(result.status, result.output).toBe(1)
      expect(result.output).toContain(`oracle replay target never executed`)
      expect(result.output).toContain(`"executions":0`)
    },
    40_000,
  )

  it.each([
    [`property`, `replay property sentinel`],
    [`setup`, `replay setup sentinel`],
    [`unrelated`, `replay unrelated sentinel`],
    [`precondition`, `too many pre-condition failures`],
  ])(
    `preserves a %s failure`,
    (fault, message) => {
      const result = runReplay([fixture], fault)
      expect(result.status, result.output).toBe(1)
      expect(result.output).toContain(message)
      if (fault === `property` || fault === `unrelated`) {
        expect(result.output).toContain(`"executions":1`)
      } else {
        expect(result.output).toContain(`"executions":0`)
      }
    },
    40_000,
  )

  it.each([
    [`coverage-registry.claim-churn`, `no-named-owner`],
    [`includes.scenario-statistics`, `statistics-only`],
    [`absent.property`, `unknown oracle property`],
  ])(
    `rejects unavailable target %s`,
    (property, message) => {
      const result = runReplay([fixture], undefined, property)
      expect(result.status, result.output).toBe(1)
      expect(result.output).toContain(message)
    },
    40_000,
  )
})

describe(`oracle replay reporting`, () => {
  let directory: string | undefined
  afterEach(() => {
    vi.unstubAllEnvs()
    if (directory !== undefined)
      rmSync(directory, { recursive: true, force: true })
    directory = undefined
  })

  it(`leaves ordinary seeded and random options unchanged`, () => {
    vi.stubEnv(`TANSTACK_DB_ORACLE_REPLAY_WITNESS`, undefined)
    expect(oracleRandomParameters(5, undefined)).toEqual({ numRuns: 5 })
    expect(oracleRandomParameters(5, 42)).toEqual({ numRuns: 5, seed: 42 })
    expect(oracleReplayReporter(`oracle-replay.calibration`, 42, `0`)).toEqual(
      {},
    )
  })

  it.each([false, true])(
    `preserves native async failure formatting and cause=%s`,
    async (errorWithCause) => {
      directory = mkdtempSync(join(tmpdir(), `oracle-reporter-test-`))
      const channel = join(directory, `witness.jsonl`)
      vi.stubEnv(`TANSTACK_DB_ORACLE_REPLAY_WITNESS`, channel)
      vi.stubEnv(`TANSTACK_DB_ORACLE_PROPERTY`, `oracle-replay.calibration`)
      vi.stubEnv(`TANSTACK_DB_ORACLE_SEED`, `42`)
      vi.stubEnv(`TANSTACK_DB_ORACLE_PATH`, `0`)
      const sentinel = new Error(`native cause sentinel`)
      const value = {
        [fc.asyncToStringMethod]: () => Promise.resolve(`async replay value`),
      }
      const property = fc.asyncProperty(fc.constant(value), () =>
        Promise.reject(sentinel),
      )
      const options = { seed: 42, path: `0`, numRuns: 1, errorWithCause }
      async function failure(instrumented: boolean): Promise<Error> {
        try {
          await fc.assert(property, {
            ...options,
            ...(instrumented
              ? oracleReplayReporter(`oracle-replay.calibration`, 42, `0`)
              : {}),
          })
        } catch (error) {
          if (error instanceof Error) return error
          throw error
        }
        throw new Error(`expected property failure`)
      }
      const native = await failure(false)
      const instrumented = await failure(true)
      expect(instrumented.message).toBe(native.message)
      expect(instrumented.message).toContain(`async replay value`)
      expect(Object.getOwnPropertyDescriptor(instrumented, `cause`)).toEqual(
        Object.getOwnPropertyDescriptor(native, `cause`),
      )
      expect(JSON.parse(readFileSync(channel, `utf8`))).toMatchObject({
        numRuns: 1,
        failed: true,
      })
    },
  )
})

describe(`named oracle replay manifest`, () => {
  it(`accounts for every registry name without deleting unavailable names`, () => {
    expect(
      new Set(oracleReplayManifest.map(({ property }) => property)),
    ).toEqual(registeredOracleProperties)
    expect(
      oracleReplayManifest.filter(({ property }) =>
        /^(coverage-registry|predicate-subtraction|load-subset-full-flow)\./.test(
          property,
        ),
      ),
    ).toHaveLength(14)
    expect(
      oracleReplayManifest.filter(({ property }) =>
        property.startsWith(`load-subset-refinement.`),
      ),
    ).toHaveLength(11)
  })

  it(`maps literal owners and all computed publication cells to source files`, () => {
    for (const entry of oracleReplayManifest) {
      if (entry.file === undefined) continue
      const source = readFileSync(join(repositoryDirectory, entry.file), `utf8`)
      if (
        entry.property.startsWith(`includes-publication.`) &&
        entry.property.split(`.`).length === 4
      ) {
        const [prefix, law, q1, q2] = entry.property.split(`.`)
        expect(source).toContain(`${prefix}.${law}.\${q1Shape}.\${q2Shape}`)
        expect(source).toContain(`\`${q1}\``)
        expect(source).toContain(`\`${q2}\``)
      } else {
        expect(source).toContain(`\`${entry.property}\``)
      }
    }
  })
})
