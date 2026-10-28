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
    runOracleCampaign(`TEST_ORACLE`, [`required`], (reach, parameters) => {
      campaigns++
      reach.beginHistory()
      if (parameters.seed !== undefined) reach.reach(`required`)
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
  expect(parameters).toEqual([{ seed: 0, path: `2:0`, numRuns: 1 }])
})

it(`keeps package reach enforcement independent of a DB replay selector`, async () => {
  vi.stubEnv(`TANSTACK_DB_ORACLE_SEED`, `1`)
  await expect(
    runOracleCampaign(`TEST_ORACLE`, [`required`], (reach) => {
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
