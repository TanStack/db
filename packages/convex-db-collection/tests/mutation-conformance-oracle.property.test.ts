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
import { convexMutationDriver } from './mutation-conformance-driver'

/**
 * # Convex on the shared mutation oracle
 *
 * A receiving driver for `packages/db-adapter-conformance`. The shared
 * module states the laws (MUT-1, MUT-2, MUT-7, MUT-8, MUT-10, MUT-13, FID-5,
 * HEALTH-5), the model, the history grammar, and the check. This file
 * supplies only the Convex production driver in
 * `mutation-conformance-driver.ts` and the campaigns; it states no expected
 * results.
 *
 * Convex does not persist writes: the driver's application handlers call a
 * Convex mutation, and the adapter's wrapped handler settles only once its
 * subscription holds the result after that mutation (MUT-7). The server runs
 * one client's mutations in order (`ordered-answers`), can reject or hold
 * one, rewrite a stored row, and stall its transitions at a commit
 * (`held-echoes`, `log-ordered-echoes`); another client can write; and the
 * adapter does not order the application's handlers (`application-handlers`).
 */

const property = `adapter-conformance.mutations.convex`
const driver = convexMutationDriver()
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

describe(`mutation conformance: Convex`, () => {
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
