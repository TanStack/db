import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { oracleReplayManifest } from './oracle-replay-manifest.js'
import { oracleReplayReporter } from './oracle-replay-witness.js'
import {
  oracleRandomParameters,
  registeredOracleProperties,
} from './oracle-config.js'

/**
 * Guarded replay is the evidence boundary for a named property run.
 *
 * A green child Vitest process is not enough. A filter can select the wrong
 * test, a property can be skipped, or a caller can override the requested
 * seed/path. The replay wrapper therefore treats a run as a small protocol:
 * the requested property must be known and available, its exact owner must
 * execute, fast-check must receive the requested replay coordinates, and the
 * witness must report a completed property with nonzero runs.
 *
 * These tests drive real child processes because process arguments, filtering,
 * environment variables, reporter failures, and exit status are the behavior
 * under test. The model is the manifest plus one expected witness record. The
 * negative cases remove or corrupt one protocol fact at a time and require a
 * nonzero exit even when Vitest itself would otherwise report success.
 */

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), `..`)
const repositoryDirectory = resolve(packageDirectory, `../..`)
const fixture = `tests/replay-guard-calibration.fixture.test.ts`

function runReplay(
  args: Array<string> = [fixture],
  fault?: string,
  property = `oracle-replay.calibration`,
  cleanupFailure = false,
  workingDirectory = packageDirectory,
): { status: number | null; output: string } {
  const result = spawnSync(
    process.execPath,
    [
      `--import`,
      `tsx`,
      join(packageDirectory, `tests/oracle-replay.ts`),
      ...args,
      `--maxWorkers=1`,
      `--coverage.enabled=false`,
    ],
    {
      cwd: workingDirectory,
      env: {
        ...process.env,
        TANSTACK_DB_ORACLE_RUNS_MULTIPLIER: `1`,
        TANSTACK_DB_ORACLE_SEED: `42`,
        TANSTACK_DB_ORACLE_PATH: `0`,
        TANSTACK_DB_ORACLE_PROPERTY: property,
        TANSTACK_DB_ORACLE_REPLAY_CALIBRATION: fault,
        TANSTACK_DB_ORACLE_REPLAY_TEST_CLEANUP_FAILURE: cleanupFailure
          ? `1`
          : undefined,
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

  it(`rejects a window replay through a different framework driver`, () => {
    const result = runReplay(
      [`tests/conformance.test.tsx`],
      undefined,
      `framework.solid.window-history`,
      false,
      join(repositoryDirectory, `packages/react-db`),
    )
    expect(result.status, result.output).toBe(1)
    expect(result.output).toContain(`oracle replay target never executed`)
    expect(result.output).toContain(`"executions":0`)
  }, 40_000)

  it(`runs a named replay directly without the owner's fixed campaign`, () => {
    const result = runReplay([fixture])
    expect(result.status, result.output).toBe(0)
    expect(result.output).toContain(`"executions":1`)
    expect(result.output).not.toContain(`unrelated fixed campaign ran`)
  }, 40_000)

  it(`rejects seed/path replay for enumerated cases and names their direct command`, () => {
    const result = runReplay(
      [`tests/replay-enumerated-oracle.fixture.test.ts`],
      undefined,
      `oracle-replay.enumerated-calibration`,
    )
    expect(result.status, result.output).toBe(1)
    expect(result.output).toContain(`enumerated-campaign`)
    expect(result.output).toContain(`Run its enumerated cases with:`)
    expect(result.output).not.toContain(`oracle replay target never executed`)
  }, 40_000)

  it(`intersects a caller alternation with the named replay campaign`, () => {
    const result = runReplay([
      fixture,
      `-t`,
      `does-not-exist|replay calibration property`,
    ])
    expect(result.status, result.output).toBe(0)
    expect(result.output).toContain(`"executions":1`)
  }, 40_000)

  it.each([
    [
      `index-update.reference-model`,
      `tests/index-update-oracle.property.test.ts`,
      2,
    ],
    [
      `index-update.nullish-membership`,
      `tests/index-update-oracle.property.test.ts`,
      2,
    ],
    [
      `index-update.exact-identity`,
      `tests/index-update-oracle.property.test.ts`,
      2,
    ],
    [
      `index-update.custom-comparator`,
      `tests/index-update-oracle.property.test.ts`,
      2,
    ],
    [
      `pagination.matrix.window-0`,
      `tests/query/pagination-oracle.property.test.ts`,
      1,
    ],
    [
      `pagination.matrix.state-7`,
      `tests/query/pagination-oracle.property.test.ts`,
      1,
    ],
    ...[
      `builder`,
      `unstarted`,
      `ready`,
      `initial-pending`,
      `move-pending`,
      `replay-pending`,
    ].flatMap((path) =>
      [`negative`, `valid`].map(
        (admission) =>
          [
            `pagination.limit-admission-${path}-${admission}`,
            `tests/query/pagination-oracle.property.test.ts`,
            1,
          ] as const,
      ),
    ),
  ] as const)(
    `selects only the requested %s replay campaign`,
    (property, file, expectedTests) => {
      const result = runReplay([file], undefined, property)
      expect(result.status, result.output).toBe(0)
      expect(result.output).toContain(`"executions":${expectedTests}`)
      expect(stripVTControlCharacters(result.output)).toMatch(
        new RegExp(`Tests\\s+${expectedTests} passed \\| \\d+ skipped`),
      )
    },
    40_000,
  )

  it.each([
    [
      `sorted-map.key`,
      `tests/SortedMap-oracle.test.ts`,
      `SortedMap key history.*seed undefined`,
    ],
    [
      `sorted-map.ascending`,
      `tests/SortedMap-oracle.test.ts`,
      `SortedMap ascending history.*seed undefined`,
    ],
    [
      `sorted-map.descending`,
      `tests/SortedMap-oracle.test.ts`,
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
      `query-identity\\.compiled-output > random seed`,
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
      // A path replay runs its recorded counterexample once.
      expect(result.output).toContain(`"numRuns":1`)
    },
    40_000,
  )

  it(`witnesses a synchronous target through the synchronous witness`, () => {
    const result = runReplay([fixture], `sync`)
    expect(result.status, result.output).toBe(0)
    expect(result.output).toContain(`"witnessMode":"sync"`)
    expect(result.output).toContain(`"executions":1`)
  }, 60_000)

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
    [`precondition`, `too many pre-condition failures`],
  ])(
    `preserves a %s failure`,
    (fault, message) => {
      const result = runReplay([fixture], fault)
      expect(result.status, result.output).toBe(1)
      expect(result.output).toContain(message)
      if (fault === `property`) {
        expect(result.output).toContain(`"executions":1`)
      } else {
        expect(result.output).toContain(`"executions":0`)
      }
    },
    40_000,
  )

  it(`does not run an unrelated failing assertion during direct replay`, () => {
    const result = runReplay([fixture], `unrelated`)
    expect(result.status, result.output).toBe(0)
    expect(result.output).not.toContain(`replay unrelated sentinel`)
    expect(result.output).toContain(`"executions":1`)
  }, 40_000)

  it(`reports the original failed replay and a later cleanup failure separately`, () => {
    const result = runReplay([fixture], `property`, undefined, true)
    expect(result.status, result.output).toBe(1)
    expect(result.output).toContain(`replay property sentinel`)
    expect(result.output).toContain(`oracle replay property failed`)
    expect(result.output).toContain(
      `oracle replay failed and cleanup also failed`,
    )
    expect(result.output).toContain(`replay cleanup sentinel`)
  }, 40_000)

  it.each([
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

  it(`preserves explicit seeds and supplies a fresh seed for ordinary runs`, () => {
    vi.stubEnv(`TANSTACK_DB_ORACLE_REPLAY_WITNESS`, undefined)
    expect(oracleRandomParameters(5, undefined)).toEqual({
      numRuns: 5,
      seed: expect.any(Number),
    })
    expect(oracleRandomParameters(5, 42)).toEqual({ numRuns: 5, seed: 42 })
    expect(oracleReplayReporter(`oracle-replay.calibration`, 42, `0`)).toEqual(
      {},
    )
  })

  it(`runs a path replay once, and only for its selected property`, () => {
    vi.stubEnv(`TANSTACK_DB_ORACLE_REPLAY_WITNESS`, undefined)
    const replay = {
      campaignSeed: 42,
      replayPath: `3`,
      replayProperty: `oracle-replay.calibration`,
    }
    expect(
      oracleRandomParameters(5, replay, `oracle-replay.calibration`),
    ).toEqual({ numRuns: 1, seed: 42, path: `3` })
    expect(oracleRandomParameters(5, replay, `cursor.exact-width`)).toEqual({
      numRuns: 5,
      seed: 42,
    })
  })

  // fast-check 4 always attaches the property's error as the cause. The
  // framework reads the replay environment once, at configuration, so the
  // comparison runs in a child process that starts with that environment.
  it(`preserves native async failure formatting and cause`, () => {
    directory = mkdtempSync(join(tmpdir(), `oracle-reporter-test-`))
    const channel = join(directory, `witness.jsonl`)
    const result = spawnSync(
      process.execPath,
      [
        `--import`,
        `tsx`,
        join(packageDirectory, `tests/replay-reporter-format.fixture.ts`),
      ],
      {
        cwd: packageDirectory,
        env: {
          ...process.env,
          TANSTACK_DB_ORACLE_REPLAY_WITNESS: channel,
          TANSTACK_DB_ORACLE_PROPERTY: `oracle-replay.calibration`,
          TANSTACK_DB_ORACLE_SEED: `42`,
          TANSTACK_DB_ORACLE_PATH: `0`,
        },
        encoding: `utf8`,
        timeout: 30_000,
      },
    )
    if (result.error) throw result.error
    expect(result.status, result.stderr).toBe(0)
    const { native, instrumented, witness } = JSON.parse(
      result.stdout.trim().split(`\n`).at(-1)!,
    )
    expect(instrumented.message).toBe(native.message)
    expect(instrumented.message).toContain(`async replay value`)
    expect(native.cause).toMatchObject({ sentinel: true })
    expect(instrumented.cause).toEqual(native.cause)
    expect(witness).toMatchObject({ numRuns: 1, failed: true })
  }, 40_000)
})

describe(`named oracle replay manifest`, () => {
  it(`runs finite cases directly without seed/path replay coordinates`, () => {
    const entry = oracleReplayManifest.find(
      ({ property }) => property === `oracle-replay.enumerated-calibration`,
    )!
    expect(entry).toMatchObject({
      status: `enumerated-campaign`,
      file: `packages/db/tests/replay-enumerated-oracle.fixture.test.ts`,
      cwd: `packages/db`,
      environment: [],
      testNamePattern: `oracle-replay\\.enumerated-calibration > `,
      command: `env -u TANSTACK_DB_ORACLE_SEED -u TANSTACK_DB_ORACLE_PATH -u TANSTACK_DB_ORACLE_PROPERTY pnpm exec vitest run -t 'oracle-replay\\.enumerated-calibration > ' tests/replay-enumerated-oracle.fixture.test.ts`,
    })
    // Execute the advertised command itself. The neighbor fault proves that
    // selecting this property's cases does not run a similarly named property.
    const run = (fault: string) => {
      const result = spawnSync(
        `${entry.command!} --maxWorkers=1 --coverage.enabled=false`,
        {
          cwd: resolve(repositoryDirectory, entry.cwd!),
          shell: true,
          env: {
            ...process.env,
            // The advertised command must also work from the shell that
            // exported these coordinates for the rejected guarded replay.
            TANSTACK_DB_ORACLE_SEED: `42`,
            TANSTACK_DB_ORACLE_PATH: `0`,
            TANSTACK_DB_ORACLE_PROPERTY: entry.property,
            TANSTACK_DB_ORACLE_ENUMERATED_CALIBRATION: fault,
          },
          encoding: `utf8`,
          timeout: 30_000,
        },
      )
      if (result.error) throw result.error
      return {
        status: result.status,
        output: stripVTControlCharacters(result.stdout + result.stderr),
      }
    }
    const clean = run(`neighbor`)
    expect(clean.status, clean.output).toBe(0)
    expect(clean.output).toMatch(/Tests\s+3 passed \| 2 skipped/)
    const wrong = run(`value`)
    expect(wrong.status, wrong.output).toBe(1)
    expect(wrong.output).toContain(`finite value`)
    expect(wrong.output).not.toContain(`unrelated finite property ran`)
  }, 70_000)
  // ORC-007 requires the same production path during replay. A shared model
  // does not make different framework schedulers interchangeable. Enumerate
  // the finite driver × history grammar, including React's dependency-list
  // path, and compare its independently named owner with the manifest.
  it.each(
    [
      [`react`, `react-db/tests/conformance.test.tsx`],
      [`react-dependency-list`, `react-db/tests/conformance.test.tsx`],
      [`react-DbClient`, `react-db/tests/conformance.test.tsx`],
      [`react-Suspense`, `react-db/tests/conformance.test.tsx`],
      [`react-Suspense-DbClient`, `react-db/tests/conformance.test.tsx`],
      [`preact`, `preact-db/tests/conformance.test.ts`],
      [`vue`, `vue-db/tests/conformance.test.ts`],
      [`solid`, `solid-db/tests/conformance.test.tsx`],
      [`angular`, `angular-db/tests/conformance.test.ts`],
      [`svelte`, `svelte-db/tests/conformance.svelte.test.ts`],
      [`svelte-DbClient`, `svelte-db/tests/conformance.svelte.test.ts`],
    ].flatMap(([driver, owner]) =>
      [
        `window-history`,
        `pending-window-history`,
        `publication-window-history`,
        `peer-window-history`,
        ...([
          `react`,
          `react-dependency-list`,
          `react-DbClient`,
          `react-Suspense`,
          `react-Suspense-DbClient`,
          `preact`,
          `svelte-DbClient`,
        ].includes(driver!)
          ? [`immutable-key-history`]
          : []),
        ...([
          `react`,
          `react-dependency-list`,
          `preact`,
          `vue`,
          `solid`,
          `angular`,
          `svelte`,
        ].includes(driver!)
          ? [`result-shape`]
          : []),
        ...([
          `react`,
          `react-dependency-list`,
          `react-DbClient`,
          `preact`,
          `svelte-DbClient`,
        ].includes(driver!)
          ? [`keyed-admission`]
          : []),
      ].map((family) => [`framework.${driver}.${family}`, owner] as const),
    ),
  )(`keeps the originating driver for %s`, (property, owner) => {
    const entry = oracleReplayManifest.find(
      (candidate) => candidate.property === property,
    )
    expect(entry, property).toMatchObject({
      file: `packages/${owner}`,
      status: `assertion`,
      source: `packages/db/tests/conformance/${property.endsWith(`.result-shape`) ? `result-shape-oracle` : `window-history-oracle`}.ts`,
      testNamePattern: expect.any(String),
    })
  })

  it(`accounts for every registry name`, () => {
    expect(
      new Set(oracleReplayManifest.map(({ property }) => property)),
    ).toEqual(registeredOracleProperties)
  })

  it(`maps literal owners and all computed publication cells to source files`, () => {
    for (const entry of oracleReplayManifest) {
      if (entry.file === undefined) continue
      const source = readFileSync(
        join(repositoryDirectory, entry.source ?? entry.file),
        `utf8`,
      )
      if (
        entry.property.startsWith(`includes-publication.`) &&
        entry.property.split(`.`).length === 4
      ) {
        const [prefix, law, q1, q2] = entry.property.split(`.`)
        expect(source).toContain(`${prefix}.${law}.\${q1Shape}.\${q2Shape}`)
        expect(source).toContain(`\`${q1}\``)
        expect(source).toContain(`\`${q2}\``)
      } else if (entry.property.startsWith(`includes.matrix.`)) {
        const computedFamilies = [
          [`independent-`, `includes.matrix.independent-\${shape}`],
          [`destination-`, `includes.matrix.destination-\${history}`],
          [
            `retired-route-`,
            `includes.matrix.retired-route-\${depth}-\${sourceBranch}`,
          ],
          [
            `intra-batch-route-`,
            `includes.matrix.intra-batch-route-\${depth}-\${sourceBranch}`,
          ],
          [
            `moved-child-`,
            `includes.matrix.moved-child-\${depth}-\${targetLevel}-\${sourceBranch}`,
          ],
          [
            `batch-`,
            `includes.matrix.batch-\${publicId}-\${route}-\${ancestorUpdate}`,
          ],
          [`full-row-`, `includes.matrix.full-row-\${depth}`],
          [
            `visible-`,
            `includes.matrix.visible-\${depth}-\${transition}-\${targetLevel}`,
          ],
          [
            `transition-`,
            `includes.matrix.transition-\${depth}-\${firstTransition}-\${secondTransition}-\${sourceBranch}`,
          ],
        ] as const
        const family = computedFamilies.find(([prefix]) =>
          entry.property.startsWith(`includes.matrix.${prefix}`),
        )
        if (family === undefined) {
          expect(entry.property).toBe(`includes.matrix.flat-materialization`)
        }
        expect(source).toContain(
          family?.[1] ?? `includes.matrix.flat-materialization`,
        )
      } else if (entry.property.startsWith(`framework.`)) {
        const [, driver, family] = entry.property.split(`.`)
        const driverSource = readFileSync(
          join(repositoryDirectory, entry.file),
          `utf8`,
        )
        const driverName =
          driver === `react-dependency-list`
            ? `react (dependency list)`
            : driver
        if (
          [
            `react-DbClient`,
            `react-Suspense`,
            `react-Suspense-DbClient`,
          ].includes(driver!)
        ) {
          // These three names come from one finite runtime product. Require
          // both generating axes and the exact naming expression; guarded
          // receiving replays verify the resulting names actually execute.
          expect(driverSource).toContain(
            `for (const suspense of [false, true])`,
          )
          expect(driverSource).toContain(`for (const client of [false, true])`)
          expect(driverSource).toContain(
            'name: `react${suspense ? ` Suspense` : ``}${client ? ` (DbClient)` : ``}`',
          )
        } else {
          expect(driverSource).toContain(
            `name: \`${driverName === `svelte-DbClient` ? `svelte (DbClient)` : driverName}\``,
          )
        }
        if (family === `result-shape`)
          expect(source).toContain(`framework.\${id}.result-shape`)
        else
          expect(source).toContain(
            `windowHistoryProperty(driver, \`${family}\`)`,
          )
      } else if (
        entry.property ===
        `adapter-conformance.eager-live-source.trailbase.chromium`
      ) {
        // This receiving owner declares its complete property ID and passes it
        // to the shared registration, rather than deriving a variant suffix.
        expect(entry.file).toBe(
          `packages/browser-db-sqlite-persistence/tests/trailbase-eager-live-source-oracle.test.ts`,
        )
        expect(source).toContain(`const property = \`${entry.property}\``)
        expect(source).toMatch(/registerTrailBaseEager\(\s*\{\s*property,/u)
      } else if (
        entry.property.startsWith(`adapter-conformance.eager-live-source.`)
      ) {
        const prefix = `adapter-conformance.eager-live-source.`
        const [driver, ...variant] = entry.property
          .slice(prefix.length)
          .split(`.`)
        expect(source).toContain(`\`${prefix}${driver}\``)
        if (variant[0] === `ablation`) {
          expect(driver).toBe(`reference`)
          expect(source).toContain('id: `${property}.ablation.${name}`')
          const [name, state] = variant.slice(1)
          expect(source).toContain(`\`${name}\``)
          if (state !== undefined) {
            expect(source).toContain(`\`${state}\``)
            expect(source).toContain(
              'registerAblation(`${kind}.${lost}`, lost,',
            )
          }
        } else if (variant.length > 0) {
          expect(variant).toHaveLength(1)
          expect(
            source.includes(`id: \`\${property}.${variant[0]}\``) ||
              (driver === `convex` &&
                source.includes('id: `${property}.${client}`') &&
                source.includes(`\`${variant[0]}\``)),
          ).toBe(true)
        }
      } else if (entry.property.startsWith(`electric.sdk-resume-checkpoint.`)) {
        const [, , tagged, consumer, emptySecond, delivery] =
          entry.property.split(`.`)
        expect(entry.property.split(`.`)).toHaveLength(6)
        expect([`false`, `true`]).toContain(tagged)
        expect([`direct`, `live-query`, `cursor`]).toContain(consumer)
        expect([`false`, `true`]).toContain(emptySecond)
        expect([`apply`, `hold`, `reject`]).toContain(delivery)
        if (consumer === `cursor`) expect(delivery).toBe(`hold`)
        expect(source).toContain(`for (const tagged of [false, true])`)
        expect(source).toContain(`for (const emptySecond of [false, true])`)
        expect(source).toContain('[`direct`, `live-query`, `cursor`] as const')
        expect(source).toContain('[`apply`, `hold`, `reject`] as const')
        expect(source).toContain(
          'if (consumer === `cursor` && delivery !== `hold`) continue',
        )
        expect(source).toContain(
          'electric.sdk-resume-checkpoint.${tagged}.${consumer}.${emptySecond}.${delivery}',
        )
      } else if (
        /^adapter\.(rxdb|powersync)\.capability\.(controlled|node-sqlite)$/.test(
          entry.property,
        )
      ) {
        const [, adapter, , host] = entry.property.split(`.`)
        expect([`rxdb`, `powersync`]).toContain(adapter)
        expect([`controlled`, `node-sqlite`]).toContain(host)
        expect(source).toContain('id: `adapter.${name}.capability.${host}`')
        expect(source).toContain(
          'for (const host of [`controlled`, `node-sqlite`] as const)',
        )
        const receivingSource = readFileSync(
          resolve(repositoryDirectory, entry.file),
          `utf8`,
        )
        expect(receivingSource).toContain(
          `registerCapabilityConformance(\`${adapter}\`,`,
        )
      } else if (
        /^trailbase\.lifecycle\.persisted-hydration\.(controlled|node-sqlite)$/.test(
          entry.property,
        )
      ) {
        expect(source).toContain(
          '`trailbase.lifecycle.persisted-hydration.${host}`',
        )
        expect(source).toContain(
          'for (const host of [`controlled`, `node-sqlite`] as const)',
        )
      } else if (entry.property.startsWith(`react.ssr-effects-`)) {
        const [runtime, ...parts] = entry.property
          .slice(`react.ssr-effects-`.length)
          .split(`-`)
        expect([`react18`, `current`]).toContain(runtime)
        expect(source).toContain(`react.ssr-effects-\${runtime.name}-\${path}`)
        expect(source).toContain(`\`${runtime}\``)
        expect(source).toContain(`\`${parts.join(`-`)}\``)
      } else if (/^(utils|comparison)\.\d+$/.test(entry.property)) {
        // These oracles number their properties in file order.
        const [family] = entry.property.split(`.`)
        expect(source).toContain(`\`${family}.\${id}\``)
      } else if (entry.property.startsWith(`pagination.limit-admission-`)) {
        const suffix = entry.property.slice(
          `pagination.limit-admission-`.length,
        )
        const separator = suffix.lastIndexOf(`-`)
        const path = suffix.slice(0, separator)
        const admission = suffix.slice(separator + 1)
        expect([
          `builder`,
          `unstarted`,
          `ready`,
          `initial-pending`,
          `move-pending`,
          `replay-pending`,
        ]).toContain(path)
        expect([`negative`, `valid`]).toContain(admission)
        expect(source).toContain(`\`${path}\``)
        expect(source).toContain(`for (const negative of [false, true])`)
        expect(source).toContain(
          'pagination.limit-admission-${path}-${negative ? `negative` : `valid`}',
        )
      } else if (entry.property.startsWith(`pagination.matrix.`)) {
        const [, , familyCell] = entry.property.split(`.`)
        const [family, cell] = familyCell!.split(`-`)
        expect([`window`, `state`]).toContain(family)
        expect(Number(cell)).toBeGreaterThanOrEqual(0)
        expect(Number(cell)).toBeLessThan(8)
        expect(source).toContain(`\`pagination.matrix.${family}-\${index}\``)
      } else {
        // A module may spell the name in any string quotes.
        expect(
          [`\``, `'`, `"`].some((quote) =>
            source.includes(`${quote}${entry.property}${quote}`),
          ),
          `${entry.source ?? entry.file} names ${entry.property}`,
        ).toBe(true)
      }
    }
  })

  it(`replays every owner from a directory where its command finds the owner`, () => {
    // A replay command runs from its entry's cwd. From the wrong directory,
    // the runner's file filter matches no test file, and the replay reports
    // only that its target never executed. So, for every owner, each file
    // that the command names must exist from that directory, its last file
    // must be the owner itself, and a test-runner config must apply there:
    // the one that `--config` names, or a default config in the directory.
    const defaultConfigs = [`vitest`, `vite`].flatMap((name) =>
      [`ts`, `mts`, `js`, `mjs`].map(
        (extension) => `${name}.config.${extension}`,
      ),
    )
    const failures: Array<string> = []
    for (const entry of oracleReplayManifest) {
      if (entry.command === undefined || entry.file === undefined) continue
      const cwd = resolve(repositoryDirectory, entry.cwd ?? `.`)
      const owner = resolve(repositoryDirectory, entry.file)
      const words = entry.command.split(` `)
      const configAt = words.indexOf(`--config`)
      const config = configAt === -1 ? undefined : words[configAt + 1]
      const files = words.filter(
        (word, index) =>
          index !== configAt + 1 &&
          /\.(m?[jt]sx?)$/.test(word) &&
          !word.startsWith(`-`),
      )
      const problems = [
        ...files
          .filter((file) => !existsSync(resolve(cwd, file)))
          .map((file) => `${file} is missing`),
        ...(resolve(cwd, files.at(-1) ?? ``) === owner
          ? []
          : [`the target ${files.at(-1)} is not the owner`]),
        ...((
          config === undefined
            ? defaultConfigs.some((name) => existsSync(join(cwd, name)))
            : existsSync(resolve(cwd, config))
        )
          ? []
          : [`no test-runner config applies`]),
      ]
      if (problems.length > 0) {
        failures.push(
          `${entry.property} (cwd ${entry.cwd}): ${problems.join(`, `)}`,
        )
      }
    }
    expect(failures).toEqual([])
  })

  it(`names an owner for every registered property`, () => {
    // A registered name that no file owns would pass replay validation and
    // run nothing. Every new registered property must name its owner.
    expect(
      oracleReplayManifest
        .filter(({ status }) => status === `no-named-owner`)
        .map(({ property }) => property),
    ).toEqual([])
  })

  it(`gives LIKE a direct seed-and-path assertion replay`, () => {
    expect(
      oracleReplayManifest.filter(
        ({ status }) => status === `reseeded-campaign`,
      ),
    ).toEqual([])
    expect(
      oracleReplayManifest.find(
        ({ property }) => property === `evaluators.like`,
      ),
    ).toMatchObject({
      status: `assertion`,
      testNamePattern: `evaluators\\.like > random seed`,
      environment: [
        `TANSTACK_DB_ORACLE_SEED`,
        `TANSTACK_DB_ORACLE_PATH`,
        `TANSTACK_DB_ORACLE_PROPERTY`,
      ],
    })
  })

  it(`gives every index and pagination matrix property a direct test selector`, () => {
    const direct = oracleReplayManifest.filter(({ property }) =>
      /^(index-update|pagination\.matrix)\./.test(property),
    )
    expect(direct).toHaveLength(20)
    for (const entry of direct) {
      expect(entry.status).toBe(`assertion`)
      expect(entry.testNamePattern).toBeDefined()
    }
  })
})
