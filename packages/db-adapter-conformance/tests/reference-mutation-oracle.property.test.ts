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
} from '../src'
import { referenceMutationDriver } from './reference-mutation-adapter'
import type { MutationDriver } from '../src'
import type { ReferenceMutationMutant } from './reference-mutation-adapter'

/**
 * # The mutation oracle on a conforming adapter
 *
 * The shared oracle in `src/mutation-oracle.ts` states the laws, the model,
 * the history grammar, and the check. This file supplies one production
 * driver: the reference adapter in `reference-mutation-adapter.ts`, which
 * persists its own writes and declares every mutation capability. A green
 * run here shows that the check accepts a conforming adapter; it says nothing
 * about a published adapter, which needs its own driver.
 *
 * - **Campaigns.** The same property, grammar, and run budget run with a
 *   fixed seed and without one (ORC-007). Each fails when fewer than five
 *   histories reach a declared state (ORC-015).
 * - **Value domain.** The same campaigns run with a JSON provider, which
 *   declares `undefinedField: 'absent'`: a field an update removes is absent
 *   from its request and the provider's copy (FID-1's value domain).
 * - **Calibration.** Each hostile mutant of the reference adapter breaks one
 *   law, and the fixed campaign must reject it with that law (ORC-006).
 */

const property = `adapter-conformance.mutations.reference`
const driver = referenceMutationDriver()
const historyArb = mutationHistoryArb(driver)
const runs = 300
const campaignTimeoutMs = 120_000

const jsonDriver = referenceMutationDriver(undefined, { json: true })

async function campaign(
  options: fc.Parameters<[unknown]>,
  under: MutationDriver = driver,
) {
  const reach = createOracleReach(property, mutationReachStatesFor(under), {
    minimum: 5,
  })
  await fc.assert(mutationProperty(under, reach), options)
  return reach
}

describe(`mutation conformance: reference adapter`, () => {
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

  oracleReplayTest(it)(
    `conforms with a JSON provider on a fixed-seed campaign`,
    async () => {
      const reach = await campaign(
        { seed: 2118, numRuns: oracleRuns(runs) },
        jsonDriver,
      )
      reach.assertReached()
    },
    campaignTimeoutMs,
  )

  const mutants: Array<[ReferenceMutationMutant, string | RegExp]> = [
    [`applies-copy-late`, `MUT-1`],
    [`swallows-rejection`, `MUT-2`],
    [`wraps-rejection`, `MUT-2`],
    [`writes-insert-twice`, `MUT-10/MUT-13`],
    [`writes-concurrently`, `MUT-10/MUT-13`],
    [`skips-delete`, /MUT-8|FID-5/],
    [`sends-changes-only`, `MUT-8`],
    [`echoes-authored-row`, /FID-5/],
  ]
  oracleReplayTest(it).each(mutants)(
    `rejects the %s mutant with %s`,
    async (mutant, law) => {
      const result = await fc.check(
        mutationProperty(referenceMutationDriver(mutant)),
        { seed: 2118, numRuns: runs },
      )
      expect(result.failed).toBe(true)
      expect(result.errorInstance).toBeInstanceOf(ConformanceViolation)
      expect((result.errorInstance as ConformanceViolation).law).toMatch(law)
    },
    campaignTimeoutMs,
  )
})

declareOracle({
  check: [checkMutationHistory, mutationProperty],
  model: [mutationModel.step, mutationModel.visible],
  grammar: [historyArb],
})
