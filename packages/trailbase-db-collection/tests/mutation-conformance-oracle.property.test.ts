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
import { trailBaseMutationDriver } from './mutation-conformance-driver'

/**
 * # TrailBase on the shared mutation oracle
 *
 * A receiving driver for `packages/db-adapter-conformance`. The shared
 * module states the laws (MUT-1, MUT-2, MUT-7, MUT-8, MUT-10, MUT-13, FID-5,
 * HEALTH-5), the model, the history grammar, and the check. This file
 * supplies only the TrailBase production driver in
 * `mutation-conformance-driver.ts` and the campaigns; it states no expected
 * results.
 *
 * The driver's RecordApi acts as a TrailBase service with SQL rows. It
 * declares every mutation capability: the service can reject or hold a
 * write, rewrite a stored row, and send a write's change event after it
 * answers; another client can write; and updates send only their changed
 * fields (the law set's `field-updates`). TrailBase confirms each write
 * through its change stream (`confirm-through-sync`, MUT-7).
 */

const property = `adapter-conformance.mutations.trailbase`
const driver = trailBaseMutationDriver()
const historyArb = mutationHistoryArb(driver)
const runs = 300
const campaignTimeoutMs = 120_000

async function campaign(options: fc.Parameters<[unknown]>) {
  const reach = createOracleReach(property, mutationReachStatesFor(driver), {
    minimum: 5,
  })
  await fc.assert(mutationProperty(driver, reach), options)
  return reach
}

describe(`mutation conformance: TrailBase`, () => {
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
