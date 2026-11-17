/**
 * Calibrations of the generated scenario-matrix grammar check in
 * expression-index-grammar-oracle.ts. They sample the grammar at the oracle's
 * fixed seed and check the grammar check itself; they run no production, so
 * they are ordinary tests. The oracle that drives production with this grammar
 * is expression-index-oracle.test.ts.
 */
import fc from 'fast-check'
import { describe, expect, it as vitestIt } from 'vitest'
import {
  oracleFixedSeed,
  oracleReplayTest,
} from '../../db/tests/oracle-config.js'
import { oracleAssertion } from '../../db/tests/oracle-assertion-adapter'
import {
  DEFAULT_ORACLE_SEED,
  GENERATED_SCENARIO_FAULTS,
  GENERATED_SCENARIO_KINDS,
  assertGeneratedScenarioGrammar,
  generatedScenarioMatrixArbitrary,
  resolveGeneratedScenarioMatrix,
} from './expression-index-grammar-oracle'

describe(`SQLite expression-index oracle`, () => {
  const generatedControlTest = oracleReplayTest(vitestIt)

  generatedControlTest(
    `reconstructs the retained generated grammar and rejects a nearby duplicate axis`,
    () => {
      const [matrix] = fc.sample(
        generatedScenarioMatrixArbitrary.map(resolveGeneratedScenarioMatrix),
        oracleFixedSeed(DEFAULT_ORACLE_SEED, { numRuns: 1 }),
      )
      if (!matrix) throw new Error(`fixed grammar witness was not generated`)
      assertGeneratedScenarioGrammar(matrix)
      oracleAssertion(
        `expect(GENERATED_SCENARIO_FAULTS.map(({ kind }) => kind)).toEqual( GENERATED_SCENARIO_KINDS, )`,
        () =>
          expect(GENERATED_SCENARIO_FAULTS.map(({ kind }) => kind)).toEqual(
            GENERATED_SCENARIO_KINDS,
          ),
      )
      const equalityScenario = matrix[0]
      if (!equalityScenario) {
        throw new Error(`fixed grammar witness omitted equality`)
      }
      oracleAssertion(
        `expect(() => assertGeneratedScenarioGrammar([...matrix, equalityScenario]), ).toThrow('duplicate=eq'`,
        () =>
          expect(() =>
            assertGeneratedScenarioGrammar([...matrix, equalityScenario]),
          ).toThrow(`duplicate=eq`),
      )
    },
  )

  // Grammar calibration: ablating any one axis from the fixed matrix fails
  // the grammar check that every native history runs, naming that axis.
  generatedControlTest.each(GENERATED_SCENARIO_KINDS)(
    `rejects the generated grammar when the %s axis is ablated`,
    (kind) => {
      const [matrix] = fc.sample(
        generatedScenarioMatrixArbitrary.map(resolveGeneratedScenarioMatrix),
        oracleFixedSeed(DEFAULT_ORACLE_SEED, { numRuns: 1 }),
      )
      if (!matrix) throw new Error(`fixed grammar witness was not generated`)
      oracleAssertion(
        `expect(() => assertGeneratedScenarioGrammar(ablated)).toThrow('missing=${kind}')`,
        () =>
          expect(() =>
            assertGeneratedScenarioGrammar(
              matrix.filter((scenario) => scenario.kind !== kind),
            ),
          ).toThrow(`missing=${kind}`),
      )
    },
  )
})
