import { fc } from '@fast-check/vitest'
import { describe, it } from 'vitest'
import {
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from '../../db/tests/oracle-config'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { createOracleReach } from '../../db/tests/oracle-reach'
import {
  checkMutationHistory,
  mutationHistoryArb,
  mutationModel,
  mutationProperty,
  mutationReachStatesFor,
} from '../../db-adapter-conformance/src'
import { powerSyncMutationDriver } from './mutation-conformance-driver'

/**
 * # PowerSync on the shared mutation oracle
 *
 * A receiving driver for `packages/db-adapter-conformance`. The shared
 * module states the laws (MUT-1, MUT-2, MUT-7, MUT-8, MUT-10, MUT-13, FID-5,
 * HEALTH-5), the model, the history grammar, and the check. This file
 * supplies only the PowerSync production driver in
 * `mutation-conformance-driver.ts` and the campaigns; it states no expected
 * results.
 *
 * The driver runs a real local PowerSync database, the adapter's provider:
 * the adapter persists each write to it and settles once its diff trigger
 * has observed the write (`confirm-through-sync`, MUT-7). The database can
 * reject or hold a write, another client can write, and updates set only
 * their changed columns (the law set's `field-updates`).
 */

const property = `adapter-conformance.mutations.powersync`
const driver = powerSyncMutationDriver()
const historyArb = mutationHistoryArb(driver)
const runs = 300
// Each history opens, clears, and closes its own SQLite database, so a
// campaign takes about 47 s locally; the budget leaves room for CI.
const campaignTimeoutMs = 240_000

async function campaign(options: fc.Parameters<[unknown]>) {
  const reach = createOracleReach(property, mutationReachStatesFor(driver), {
    minimum: 5,
  })
  await fc.assert(mutationProperty(driver, reach), options)
  return reach
}

describe(`mutation conformance: PowerSync`, () => {
  oracleReplayTest(it)(
    `conforms on a fixed-seed campaign`,
    async () => {
      const reach = await campaign({ seed: 2118, numRuns: oracleRuns(runs) })
      reach.assertReached()
    },
    campaignTimeoutMs,
  )

  oracleReplayTest(it, property)(
    `conforms on a random campaign or a replayed seed`,
    async () => {
      const reach = await campaign(oraclePropertyOptions(runs, property))
      reach.assertReached()
    },
    campaignTimeoutMs,
  )
})

declareOracle({
  check: [checkMutationHistory, mutationProperty],
  model: [mutationModel.step, mutationModel.visible],
  grammar: [historyArb],
})
