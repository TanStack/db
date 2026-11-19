// Model calibration for where-predicate-publication-oracle.property.test.ts.
// It runs no production: it checks that each named snapshot history
// distinguishes the independent Kleene model from a two-valued fold, so that
// the history calibrates the oracle. The law, its authority, and the
// production comparison are in that oracle file; the model and named
// histories are in where-predicate-publication-model-oracle.ts.
import { describe, expect, it } from 'vitest'
import { oracleReplayRequested } from '../oracle-config.js'
import {
  expectedEquality,
  expectedVisible,
  fixedHistories,
  operandValue,
  settledModelRow,
} from './where-predicate-publication-model-oracle.js'
import type { ModelRow } from './where-predicate-publication-model-oracle.js'
import type { Predicate } from './where-predicate-support.js'

describe(`WHERE predicate publication oracle`, () => {
  if (!oracleReplayRequested()) {
    it(`fixed snapshot histories distinguish Kleene logic from two-valued logic`, () => {
      // A checker that folds UNKNOWN into FALSE before NOT must disagree with
      // the model on each fixed snapshot, or the history does not calibrate.
      const twoValued = (predicate: Predicate, row: ModelRow): boolean => {
        switch (predicate.kind) {
          case `eq`:
            return (
              expectedEquality(
                operandValue(predicate.left, row),
                operandValue(predicate.right, row),
              ) === true
            )
          case `not`:
            return !twoValued(predicate.arg, row)
          case `and`:
            return predicate.args.every((arg) => twoValued(arg, row))
          case `or`:
            return predicate.args.some((arg) => twoValued(arg, row))
        }
      }
      for (const history of fixedHistories) {
        if (history.kind !== `snapshot`) throw new Error(`expected a snapshot`)
        const rows = new Map(
          history.rows.map((seed, index): [string, ModelRow] => [
            `r${index}`,
            {
              ...settledModelRow(`r${index}`, seed.v),
              $hasPendingWrites: seed.optimistic,
              $origin: seed.optimistic ? `local` : `remote`,
            },
          ]),
        )
        const naive = [...rows.values()]
          .filter((row) => twoValued(history.predicate, row))
          .map((row) => row.id)
          .sort()
        expect(naive).not.toEqual(expectedVisible(history.predicate, rows))
      }
    })
  }
})
