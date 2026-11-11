// Calibrations of the ordinary SQLite committed-transaction grammars and
// comparison in ordinary-transaction-work-oracle.ts: the generated action
// histories and independent-key work cases reconstruct their axes at the
// oracle's fixed seeds, and the complete-observation comparison rejects lost
// metadata. They run no production, so they are ordinary tests. Importing the
// oracle module registers nothing; its tests register only through
// runOrdinaryTransactionWorkOracle().
import { fc } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { oracleFixedSeed } from '../../db/tests/oracle-config'
import { oracleAssertion } from '../../db/tests/oracle-assertion-adapter'
import { clone } from './ordinary-transaction-work-support'
import {
  generatedHistoryArbitrary,
  independentWorkArbitrary,
  modelAfter,
  sameObservation,
  semanticCases,
} from './ordinary-transaction-work-oracle'
import type {
  GeneratedScenario,
  IndependentWorkCase,
} from './ordinary-transaction-work-oracle'

describe('ordinary SQLite committed transaction oracle', () => {
  it('reconstructs the bounded generated action-history axes', () => {
    const samples = fc.sample(
      generatedHistoryArbitrary,
      oracleFixedSeed(1992, { numRuns: 120 }),
    )
    oracleAssertion('existing comparison at 1045', () =>
      expect(new Set(samples.map((sample) => sample.scenario))).toEqual(
        new Set<GeneratedScenario>([
          'repeated-key',
          'delete-reinsert',
          'partial-update',
          'metadata-present-set',
          'metadata-present-delete',
          'metadata-absent-set',
          'metadata-absent-delete',
        ]),
      ),
    )
    oracleAssertion('existing comparison at 1056', () =>
      expect(new Set(samples.map((sample) => sample.rollback))).toEqual(
        new Set([true, false]),
      ),
    )
    oracleAssertion('existing comparison at 1059', () =>
      expect(new Set(samples.map((sample) => sample.followup))).toEqual(
        new Set([true, false]),
      ),
    )
    oracleAssertion('existing comparison at 1062', () =>
      expect(
        new Set(
          samples.map((sample) => `${sample.scenario}:${sample.rollback}`),
        ).size,
      ).toBe(14),
    )
    oracleAssertion('existing comparison at 1067', () =>
      expect(new Set(samples.map((sample) => sample.target))).toEqual(
        new Set(['a', 'b']),
      ),
    )
    oracleAssertion('existing comparison at 1070', () =>
      expect(
        samples.some(
          (sample) =>
            sample.prefix.length > 0 && sample.rowMetadataPrefix.length > 0,
        ),
      ).toBe(true),
    )
    oracleAssertion('existing comparison at 1076', () =>
      expect(
        samples.every(
          (sample) =>
            sample.prefix.length <= 60 &&
            sample.rowMetadataPrefix.length <= 3 &&
            sample.collectionMetadata.length <= 2,
        ),
      ).toBe(true),
    )
    oracleAssertion('existing comparison at 1084', () =>
      expect(samples.some((sample) => sample.prefix.length >= 25)).toBe(true),
    )
  })
  it('reconstructs independent-key work shapes and host caps', () => {
    const samples = fc.sample(
      independentWorkArbitrary,
      oracleFixedSeed(31992, { numRuns: 120 }),
    )
    oracleAssertion('existing comparison at 1092', () =>
      expect(new Set(samples.map((sample) => sample.shape))).toEqual(
        new Set<IndependentWorkCase['shape']>([
          'insert-later-metadata',
          'insert-inline-metadata',
          'partial-update',
          'delete',
          'row-metadata-only',
          'collection-metadata-only',
        ]),
      ),
    )
    oracleAssertion('existing comparison at 1102', () =>
      expect(new Set(samples.map((sample) => sample.cap))).toEqual(
        new Set([100, 999]),
      ),
    )
    oracleAssertion('existing comparison at 1105', () =>
      expect(
        samples.every((sample) => sample.size >= 0 && sample.size <= 60),
      ).toBe(true),
    )
  })
  it('calibrates the complete-observation comparison', () => {
    const expected = modelAfter([
      semanticCases[0]!.seed!,
      semanticCases[0]!.candidate,
    ])
    const wrong = clone(expected)
    wrong.rows[0]!.metadata = undefined
    oracleAssertion('existing comparison at 1199', () =>
      expect(sameObservation(expected, expected)).toBe(true),
    )
    oracleAssertion('existing comparison at 1200', () =>
      expect(sameObservation(wrong, expected)).toBe(false),
    )
  })
})
