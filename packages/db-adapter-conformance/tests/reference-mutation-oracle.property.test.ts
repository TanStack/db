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
 * - **Value domain.** The fixed campaign also runs with a JSON provider,
 *   which declares `undefinedField: 'absent'`: a field an update removes is
 *   absent from its request and the provider's copy (FID-1's value domain).
 * - **SQL provider.** The fixed campaign also runs with a provider like
 *   TrailBase's or PowerSync's: `undefinedField: 'null'`, `field-updates`,
 *   and `held-echoes`, so the adapter confirms each write through sync.
 * - **Log provider, application handlers.** The fixed campaign also runs
 *   like Electric: a SQL provider whose change feed is a log
 *   (`log-ordered-echoes`) and handlers the application writes, which the
 *   adapter does not order (`application-handlers`). Another runs like
 *   Convex: a JSON provider that answers requests in arrival order
 *   (`ordered-answers`), with a log feed and application handlers.
 * - **Transactions.** The default and JSON configurations send a
 *   transaction's requests one at a time, as RxDB must; the others answer a
 *   transaction all-or-nothing (`atomic-transactions`).
 * - **Counted confirmation.** Another runs like TrailBase: a SQL provider
 *   whose adapter confirms the n-th answered write on a key at the n-th
 *   copy there (`counted-echoes`), so a commit by another client can settle
 *   a pending write.
 * - **Campaigns per configuration.** Each configuration is its own grammar,
 *   so each runs a fixed and a random campaign, under its own property name.
 * - **Calibration.** Each hostile mutant of the reference adapter breaks one
 *   law, and the fixed campaign must reject it with that law (ORC-006). A
 *   provider that breaks a rule its driver declares (log order,
 *   application-handler requests, in-order answers, confirmation by its
 *   own copy) must fail too.
 */

const property = `adapter-conformance.mutations.reference`
const driver = referenceMutationDriver()
const historyArb = mutationHistoryArb(driver)
const runs = 300
const campaignTimeoutMs = 120_000

const jsonDriver = referenceMutationDriver(undefined, { json: true })
const sqlDriver = referenceMutationDriver(undefined, {
  sql: true,
  atomic: true,
})
const logDriver = referenceMutationDriver(undefined, {
  sql: true,
  log: true,
  application: true,
  atomic: true,
})
const countedDriver = referenceMutationDriver(undefined, {
  sql: true,
  counted: true,
  atomic: true,
})
const inOrderDriver = referenceMutationDriver(undefined, {
  json: true,
  log: true,
  application: true,
  inOrder: true,
  confirms: true,
  atomic: true,
})

/**
 * The violation a failed check threw: itself, or the cause of the error that
 * also carries cleanup failures, as a mutant that strands a write leaves one.
 */
function violationIn(error: unknown): unknown {
  return error instanceof AggregateError ? error.cause : error
}

async function campaign(
  options: fc.Parameters<[unknown]>,
  under: MutationDriver = driver,
  name: string = property,
) {
  const reach = createOracleReach(name, mutationReachStatesFor(under), {
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

  // Each provider configuration is its own grammar, so each runs a fixed and
  // a random campaign (ORC-007), under its own property name for replay.
  const configurations: Array<[string, string, MutationDriver]> = [
    [
      `adapter-conformance.mutations.reference-json`,
      `a JSON provider`,
      jsonDriver,
    ],
    [
      `adapter-conformance.mutations.reference-sql`,
      `a SQL provider`,
      sqlDriver,
    ],
    [
      `adapter-conformance.mutations.reference-log`,
      `a SQL log provider and application handlers`,
      logDriver,
    ],
    [
      `adapter-conformance.mutations.reference-in-order`,
      `an in-order JSON log provider and application handlers`,
      inOrderDriver,
    ],
    [
      `adapter-conformance.mutations.reference-counted`,
      `a SQL provider and confirmation by counted copies`,
      countedDriver,
    ],
  ]
  for (const [configured, label, under] of configurations) {
    oracleReplayTest(it)(
      `conforms with ${label} on a fixed-seed campaign`,
      async () => {
        const reach = await campaign(
          { seed: 2118, numRuns: oracleRuns(runs) },
          under,
          configured,
        )
        reach.assertReached()
      },
      campaignTimeoutMs,
    )
    oracleReplayTest(it, configured)(
      `conforms with ${label} on a random campaign or a replayed seed`,
      async () => {
        const reach = await campaign(
          oraclePropertyOptions(runs, configured),
          under,
          configured,
        )
        reach.assertReached()
      },
      campaignTimeoutMs,
    )
  }

  // A provider that breaks a rule its driver declares must fail: the model's
  // log order, application-handler requests, and in-order answers each
  // decide what the check owes.
  const misdeclared: Array<[string, MutationDriver, string | RegExp]> = [
    [
      `a provider whose copies overtake a withheld one, declared a log`,
      {
        ...referenceMutationDriver(undefined, { sql: true, application: true }),
        capabilities: logDriver.capabilities,
      },
      `MUT-7 (settlement)`,
    ],
    [
      `an adapter that orders its writes, declared application handlers`,
      {
        ...referenceMutationDriver(undefined, { sql: true, log: true }),
        capabilities: logDriver.capabilities,
      },
      `MUT-10/MUT-13 (missing or late request)`,
    ],
    [
      `a provider that answers out of order, declared in order`,
      {
        ...referenceMutationDriver(undefined, {
          json: true,
          log: true,
          application: true,
          confirms: true,
        }),
        capabilities: inOrderDriver.capabilities,
      },
      /MUT-13 \(settlement\)|MUT-1 /,
    ],
    [
      `an atomic adapter, declared to send a transaction's requests one by one`,
      {
        ...referenceMutationDriver(undefined, { atomic: true }),
        capabilities: driver.capabilities,
      },
      /MUT-|FID-5/,
    ],
    [
      `an adapter that sends a transaction's requests one by one, declared atomic`,
      {
        ...referenceMutationDriver(),
        capabilities: new Set([
          ...driver.capabilities,
          `atomic-transactions` as const,
        ]),
      },
      /MUT-|FID-5/,
    ],
    [
      `an adapter that counts copies per key, declared to confirm by its own copy`,
      {
        ...referenceMutationDriver(undefined, { sql: true, counted: true }),
        capabilities: sqlDriver.capabilities,
      },
      /MUT-1 |MUT-7/,
    ],
  ]
  oracleReplayTest(it).each(misdeclared)(
    `rejects %s`,
    async (_name, under, law) => {
      const result = await fc.check(mutationProperty(under), {
        seed: 2118,
        numRuns: runs,
      })
      expect(result.failed).toBe(true)
      const violation = violationIn(result.errorInstance)
      expect(violation).toBeInstanceOf(ConformanceViolation)
      expect((violation as ConformanceViolation).law).toMatch(law)
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

  const mutants: Array<[ReferenceMutationMutant, string | RegExp]> = [
    [`applies-copy-late`, `MUT-1`],
    [`swallows-rejection`, `MUT-2`],
    [`wraps-rejection`, `MUT-2`],
    [`writes-insert-twice`, `MUT-10/MUT-13 (extra or early request)`],
    [`writes-concurrently`, `MUT-10/MUT-13 (extra or early request)`],
    [`skips-delete`, /missing or late request|FID-5/],
    [`sends-changes-only`, `MUT-8`],
    [`echoes-authored-row`, /FID-5/],
    [`writes-back-authored`, /FID-5/],
    [`sends-complete-row`, `MUT-8 (provider requests)`],
    [`drops-removal`, `MUT-8 (provider requests)`],
    [`settles-on-answer`, /MUT-1|MUT-7/],
    [`chains-on-confirmation`, `MUT-10/MUT-13 (missing or late request)`],
    [`confirms-by-high-water`, /MUT-1|MUT-7/],
    [`drops-joint-settlement`, /MUT-[12] \(publication\)/],
    [`replays-joint-settlement`, /MUT-[12] \(publication\)/],
    [`confirms-on-any-copy`, /MUT-1 |MUT-7|FID-5 \(public rows\)/],
    [
      `reload-skips-confirmation`,
      /MUT-7|FID-5 \(public rows\)|reload \(settlement\)/,
    ],
    [
      `continues-after-rejection`,
      /MUT-10\/MUT-13 \(extra or early request\)|MUT-8|FID-5/,
    ],
    [
      `reload-keeps-counts`,
      /MUT-1 |MUT-7|FID-5 \(public rows\)|reload \(settlement\)/,
    ],
  ]
  oracleReplayTest(it).each(mutants)(
    `rejects the %s mutant with %s`,
    async (mutant, law) => {
      const result = await fc.check(
        mutationProperty(referenceMutationDriver(mutant)),
        { seed: 2118, numRuns: runs },
      )
      expect(result.failed).toBe(true)
      const violation = violationIn(result.errorInstance)
      expect(violation).toBeInstanceOf(ConformanceViolation)
      expect((violation as ConformanceViolation).law).toMatch(law)
    },
    campaignTimeoutMs,
  )
})

declareOracle({
  check: [checkMutationHistory, mutationProperty],
  model: [mutationModel.step, mutationModel.visible],
  grammar: [historyArb],
})
