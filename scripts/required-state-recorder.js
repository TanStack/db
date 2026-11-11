// Receiving-path bookkeeping for native enumerated histories. The caller states
// its existing required checkpoints; no product expectation is computed here.
import assert from 'node:assert/strict'
import { oracleAssertion } from '../packages/db/tests/oracle-assertion-adapter.js'

export function requiredStateRecorder(required, observe) {
  const entered = new Set()
  return {
    enter(state) {
      if (!required.includes(state))
        throw new Error('undeclared receiving state: ' + state)
      entered.add(state)
      observe('reach', state)
    },
    assertComplete() {
      oracleAssertion('required receiving states', () =>
        assert.deepEqual(
          required.filter((state) => !entered.has(state)),
          [],
          'every required receiving checkpoint ran',
        ),
      )
    },
    counts() {
      return new Map(
        required.map((state) => [state, entered.has(state) ? 1 : 0]),
      )
    },
  }
}
