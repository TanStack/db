// Compatibility self-tests from TanStack/oracles at fe532f4.
import { afterEach, expect, it, vi } from 'vitest'
import { runOracleCampaign } from './oracle-campaign'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

it(`does not let fixed campaign reach conceal an unreached random state`, async () => {
  vi.spyOn(console, `info`).mockImplementation(() => {})
  let campaigns = 0
  await expect(
    runOracleCampaign(`TEST_ORACLE`, [`required`], (reach) => {
      campaigns++
      reach.beginHistory()
      if (campaigns === 1) reach.reach(`required`)
    }),
  ).rejects.toThrow(/required \(0\)/)
  expect(campaigns).toBe(2)
})

it(`replays the requested seed and path without demanding unrelated states`, async () => {
  vi.spyOn(console, `info`).mockImplementation(() => {})
  vi.stubEnv(`TEST_ORACLE_SEED`, `0`)
  vi.stubEnv(`TEST_ORACLE_PATH`, `2:0`)
  const parameters: Array<{ seed?: number; path?: string; numRuns?: number }> =
    []
  await runOracleCampaign(`TEST_ORACLE`, [`unrelated`], (reach, value) => {
    parameters.push(value)
    reach.beginHistory()
  })
  // A replay's seed is declared fixed (oracle-route.ts).
  expect(parameters).toEqual([
    {
      seed: 0,
      path: `2:0`,
      numRuns: 1,
      [Symbol.for(`@tanstack/oracles/fixed-seed`)]: 0,
    },
  ])
})

it(`keeps reach enforcement independent of the configured replay selector`, async () => {
  // A path replay under the configured prefix turns reach checks off for the
  // configured project's own properties; a campaign under its own prefix still
  // checks reach.
  vi.resetModules()
  vi.stubEnv(`TANSTACK_DB_ORACLE_SEED`, `1`)
  vi.stubEnv(`TANSTACK_DB_ORACLE_PATH`, `0`)
  vi.stubEnv(`TANSTACK_DB_ORACLE_PROPERTY`, `query.public-container-copy`)
  const { runOracleCampaign: runWithReplay } = await import('./oracle-campaign')
  await expect(
    runWithReplay(`TEST_ORACLE`, [`required`], (reach) => {
      reach.beginHistory()
    }),
  ).rejects.toThrow(/required \(0\)/)
})

it(`rejects a shrink path without a seed before starting a campaign`, async () => {
  vi.stubEnv(`TEST_ORACLE_PATH`, `0`)
  const run = vi.fn()
  await expect(
    runOracleCampaign(`TEST_ORACLE`, [`state`], run),
  ).rejects.toThrow(/requires a seed/)
  expect(run).not.toHaveBeenCalled()
})
