import { fc } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import {
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from '../../db/tests/oracle-config'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { createOracleReach } from '../../db/tests/oracle-reach'
import {
  ConformanceViolation,
  checkMutationHistory,
  mutationHistoryArb,
  mutationModel,
  mutationProperty,
  mutationReachStatesFor,
  queuedHeldWritesCalibration,
} from '../../db-adapter-conformance/src'
import { electricMutationDriver } from './mutation-conformance-driver'

/**
 * # Electric on the shared mutation oracle
 *
 * A receiving driver for `packages/db-adapter-conformance`. The shared
 * module states the laws (MUT-1, MUT-2, MUT-7, MUT-8, MUT-10, MUT-13, FID-5,
 * HEALTH-5), the model, the history grammar, and the check. This file
 * supplies only the Electric production driver in
 * `mutation-conformance-driver.ts` and the campaigns; it states no expected
 * results.
 *
 * Electric does not persist writes: the driver's application handlers write
 * through a backend API and confirm each with the adapter's `awaitTxId`, so
 * this checks what Electric owns, the confirmation through its shape stream
 * (MUT-7), with the handlers' requests and the backend's rows as the
 * application's. The backend can reject or hold a write, rewrite a stored
 * row, and stall its shape log at a commit (`held-echoes`,
 * `log-ordered-echoes`); another client can write; and the adapter does not
 * order the application's handlers (`application-handlers`).
 */

const property = `adapter-conformance.mutations.electric`
const driver = electricMutationDriver()
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

describe(`mutation conformance: Electric`, () => {
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
  // Cleanup after a violation answers a held write that reaches the
  // provider only during teardown, so the violation is reported; a hang
  // fails at the test timeout (ORC-010).
  oracleReplayTest(it)(
    `reports a violation found while a held write waits in the queue`,
    async () => {
      const calibration = queuedHeldWritesCalibration(driver)
      const error = await checkMutationHistory(
        calibration.driver,
        calibration.history,
      ).then(
        () => undefined,
        (failure: unknown) => failure,
      )
      expect(error).toBeInstanceOf(ConformanceViolation)
      expect((error as ConformanceViolation).law).toBe(
        `MUT-10/MUT-13 (extra or early request)`,
      )
    },
    10_000,
  )
})

declareOracle({
  check: [checkMutationHistory, mutationProperty],
  model: [mutationModel.step, mutationModel.visible],
  grammar: [historyArb],
})
