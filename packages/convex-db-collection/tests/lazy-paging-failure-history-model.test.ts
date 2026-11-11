// A model calibration of LazyTerminalGraphModel: old graphs may not recover or
// change after cleanup. It runs no production;
// lazy-paging-failure-history-oracle.property.test.ts judges production with
// the same model.
import { expect, it } from 'vitest'
import { oracleAssertion } from '../../db/tests/oracle-assertion-adapter'
import { LazyTerminalGraphModel } from './lazy-paging-model-oracle'

it(`rejects old graphs recovering or changing after cleanup`, () => {
  const row = { id: `one`, rank: 1, text: `authored` }
  const model = new LazyTerminalGraphModel()
  model.cleanup([row])
  model.observe(`crashed`, [row])
  oracleAssertion(
    `lazy-paging-failure-history-oracle.property.test.ts:459:toThrow`,
    () =>
      expect(() => model.observe(`ready`, [row])).toThrow(
        `old graph recovered`,
      ),
  )
  oracleAssertion(
    `lazy-paging-failure-history-oracle.property.test.ts:460:toThrow`,
    () =>
      expect(() =>
        model.observe(`crashed`, [{ ...row, text: `new run` }]),
      ).toThrow(`dead graph published`),
  )
})
