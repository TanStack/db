import fc from 'fast-check'
import { expect, it } from 'vitest'
import {
  oracleReplayTest,
  oracleRoute,
  readOracleRunConfig,
} from '../../db/tests/oracle-config'
import {
  MUTATION_WIRE_PROPERTY,
  mutationMeaningProperty,
  mutationWireOracle,
} from './transaction-serializer-oracle'

// This runner calibration preserves raw RunDetails and shrink-path identity.
// Production value laws use native oracleProperty in the owner runner.
oracleReplayTest(it, MUTATION_WIRE_PROPERTY)(
  `replays a shrunk mutation-wire failure at the same checkpoint`,
  async () => {
    oracleRoute(`calibration`)
    // The fault drops a mutation field after the real encoder runs. It leaves
    // zero-edit histories green, so fast-check must find and shrink a generated
    // history that reaches the wire assertion. A seed alone reseeds this
    // capture, and a path replay of MUTATION_WIRE_PROPERTY runs the recorded
    // path once. Captured replay: TANSTACK_DB_ORACLE_SEED=20260914
    // TANSTACK_DB_ORACLE_PATH=0:1:0:0:0:1:1:1:1:1
    // TANSTACK_DB_ORACLE_PROPERTY=offline.serializer.mutation-wire
    const property = mutationMeaningProperty(`omit-changes`)
    const replay = mutationWireOracle.random
    const { campaignSeed } = readOracleRunConfig()
    const captured = await fc.check(property, {
      ...replay,
      seed: campaignSeed ?? 20260914,
    })
    expect(captured.failed).toBe(true)
    expect(captured.errorInstance).toMatchObject({ name: `AssertionError` })
    expect(String(captured.errorInstance)).toContain(`mutation wire checkpoint`)
    if (campaignSeed !== undefined) return

    expect(captured.numShrinks).toBeGreaterThan(0)
    expect(captured.counterexamplePath).toMatch(/^\d+(?::\d+)*$/)
    const capturedPath = captured.counterexamplePath
    if (capturedPath === null) throw new Error(`Missing captured shrink path`)
    const original = await fc.check(property, {
      seed: captured.seed,
      numRuns: mutationWireOracle.runs,
      endOnFailure: true,
    })
    expect(original.failed).toBe(true)
    expect(original.errorInstance).toMatchObject({ name: `AssertionError` })
    expect(String(original.errorInstance)).toContain(`mutation wire checkpoint`)
    const replayed = await fc.check(property, {
      seed: captured.seed,
      path: capturedPath,
      numRuns: mutationWireOracle.runs,
    })
    expect(replayed.failed).toBe(true)
    expect(replayed.counterexample).toEqual(captured.counterexample)
    expect(replayed.errorInstance).toMatchObject({ name: `AssertionError` })
    expect(String(replayed.errorInstance)).toContain(`mutation wire checkpoint`)
  },
)
