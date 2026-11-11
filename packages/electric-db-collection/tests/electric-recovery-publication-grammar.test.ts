// Checks that the recovery oracle's fixed-seed publication grammar sample
// reaches every deletion and reload combination. It samples the grammar and
// runs no production, so it lives outside the oracle.
import { fc } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import { oracleFixedSeed } from '../../db/tests/oracle-config'
import { publicationHistoryArbitrary } from './electric-recovery-publication-grammar-oracle'

it(`fixed recovery corpus reaches every deletion and reload combination`, () => {
  const combinations = new Set(
    fc
      .sample(
        publicationHistoryArbitrary,
        oracleFixedSeed(1659, { numRuns: 20 }),
      )
      .flat()
      .map(({ deleted, fullReload }) => `${deleted}:${fullReload}`),
  )
  expect(combinations).toEqual(
    new Set([`false:false`, `false:true`, `true:false`, `true:true`]),
  )
})
