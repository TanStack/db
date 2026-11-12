import { describe, expect, it } from 'vitest'
import { oracleAssertion } from './oracle-assertion-adapter.js'
import {
  createLifecycleModel,
  pendingSupersessionHistory,
  reduceLifecycle,
} from './collection-subscription-lifecycle-grammar-oracle.js'

/**
 * Model-rule checks of the shared lifecycle grammar in
 * collection-subscription-lifecycle-grammar-oracle.ts. They step the
 * independent model without production, so they moved here from
 * collection-subscription-lifecycle-history-oracle.property.test.ts.
 */
describe(`CollectionSubscription async lifecycle history oracle`, () => {
  it(`names the overlapping replay transition in the model`, () => {
    const model = createLifecycleModel()
    for (const command of pendingSupersessionHistory) {
      reduceLifecycle(model, command)
    }
    oracleAssertion(`lifecycle history comparison at 1374`, () =>
      expect(model.reach).toContain(`overlapping-replay`),
    )
  })
})
