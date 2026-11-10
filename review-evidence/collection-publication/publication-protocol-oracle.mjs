import assert from 'node:assert/strict'
import { declareOracle } from '../../packages/db/tests/oracle-declaration.ts'

/**
 * A bounded protocol model, not a production test or a new product oracle owner.
 * The maintainer's new law holds replacement rows until provider success.
 * The existing contract makes an applied receipt mean public visibility and
 * permits provider success or failure only after awaiting that receipt.
 *
 * `stage` abstracts one or two establishing writes. `finish` is the provider's
 * verdict after its last establishing write. `apply` makes rows public and
 * settles their applied receipts together. No production queue is represented.
 * The three protocols differ only in where acceptance and completion occur.
 */
const protocols = ['current', 'hold-existing-commit', 'private-staging']
const outcomes = ['success', 'failure']

function nextStates(state, protocol, outcome) {
  const result = []
  const add = (event, changes) => result.push({ ...state, ...changes, trace: [...state.trace, event] })
  if (!state.staged) add('stage', { staged: true, accepted: protocol !== 'private-staging' })
  if (state.staged && !state.finished && (protocol === 'private-staging' || state.applied))
    add(`provider-${outcome}`, { finished: outcome })
  if (state.staged && !state.applied && (protocol === 'current' || state.finished === 'success'))
    add('public-apply-and-receipt', { applied: true, accepted: true, publicValue: state.candidateValue })
  if (protocol === 'private-staging' && state.finished === 'failure' && !state.discarded)
    add('discard-unaccepted-candidate', { discarded: true })
  return result
}

function violations(state) {
  const result = []
  if (state.applied && state.finished !== 'success') result.push('public replacement before provider success')
  // Every protocol action applies state and messages together. A real receiving
  // oracle must separately observe this, rather than assume it as this model does.
  if (state.applied && state.publicValue !== state.candidateValue) result.push('applied receipt without visible writes')
  if (state.accepted && state.discarded) result.push('discarded accepted sync transaction')
  return result
}

function explore(protocol, outcome, writes) {
  const initial = { staged: false, accepted: false, applied: false, finished: undefined, discarded: false,
    publicValue: 1, candidateValue: writes + 1, trace: [] }
  const queue = [initial], terminals = [], unsafe = []
  while (queue.length) {
    const state = queue.shift()
    const faults = violations(state)
    if (faults.length) unsafe.push({ trace: state.trace, faults })
    const next = nextStates(state, protocol, outcome)
    if (next.length) queue.push(...next)
    else terminals.push(state)
  }
  const deadlocks = terminals.filter((state) => !state.finished)
  return { protocol, outcome, writes, unsafe, deadlocks, terminals }
}

const results = protocols.flatMap((protocol) => outcomes.flatMap((outcome) =>
  [1, 2].map((writes) => explore(protocol, outcome, writes))))
for (const result of results) {
  if (result.protocol === 'current') assert.ok(result.unsafe.length, 'current API must distinguish the new publication law')
  if (result.protocol === 'hold-existing-commit') assert.ok(result.deadlocks.length, 'holding existing receipt must expose circular wait')
  if (result.protocol === 'private-staging') {
    assert.equal(result.unsafe.length, 0)
    assert.equal(result.deadlocks.length, 0)
    for (const state of result.terminals) {
      assert.equal(state.finished, result.outcome)
      assert.equal(state.publicValue, result.outcome === 'success' ? result.writes + 1 : 1)
      assert.equal(state.accepted, result.outcome === 'success')
    }
  }
}
// Checker controls reject two tempting protocol shortcuts at the same boundary.
assert.ok(violations({ applied: true, finished: 'failure', publicValue: 2, candidateValue: 2 }).length)
assert.ok(violations({ applied: true, finished: 'success', publicValue: 1, candidateValue: 2 }).length)
assert.ok(violations({ accepted: true, discarded: true }).length)
console.log(JSON.stringify({ scope: 'bounded design model only; no production or receiving evidence',
  cases: results.length, results: results.map(({ protocol, outcome, writes, unsafe, deadlocks, terminals }) =>
    ({ protocol, outcome, writes, unsafe: unsafe[0] ?? null, deadlock: deadlocks[0]?.trace ?? null,
      terminalTraces: terminals.map(({ trace }) => trace) })) }, null, 2))

declareOracle({ model: [nextStates, explore], check: [violations] })
