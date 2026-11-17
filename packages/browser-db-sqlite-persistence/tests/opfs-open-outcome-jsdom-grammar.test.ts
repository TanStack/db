// A check of test code: the open histories that the jsdom driver in
// opfs-open-outcome-oracle.test.ts runs reach every outcome that it controls.
// It runs no production, so it is an ordinary test.
import { describe, expect, it } from 'vitest'
import { openHistories, reachedOutcomes } from './opfs-open-outcome-oracle'
import { jsdomReach } from './opfs-open-outcome-jsdom-grammar-oracle'

const histories = openHistories(jsdomReach)

describe(`OPFS open outcome oracle (jsdom driver)`, () => {
  it(`reaches every outcome that this driver controls`, () => {
    expect(reachedOutcomes(histories)).toEqual([
      `initialization: AbortError`,
      `initialization: TimeoutError`,
      `none: opened`,
      `wasm: PersistenceUnavailableError`,
      `worker start: PersistenceUnavailableError`,
    ])
  })
})
