import assert from 'node:assert/strict'
import { EvidenceBase, identity } from './snapshot/kernel.ts'

const claim = (subject) => ({ law: 'audit/accepted-check@1', subject, scope: { context: 'explicit-epoch' } })
const observationRule = {
  id: 'audit/observation@1',
  premises: () => [],
  inspect: (target, observations) => observations.some((entry) => identity(entry.claim) === identity(target))
    ? undefined : 'Need matching check',
}
async function observe(base, target, passed, testCase) {
  const [observation] = await base.run('audit/trusted-check', async () => [{
    claim: target, case: testCase, passed, value: 'campaign result',
  }])
  if (passed) base.propose({ claim: target, rule: observationRule.id, observations: [observation.id] })
  return observation
}

// Same missing claims but different legal routes to completion.
const a = claim('A'), b = claim('B'), c = claim('C'), goal = claim('goal')
function graph(routes) {
  const rules = routes.map((premises, index) => ({
    id: `audit/route-${index}@1`,
    premises: (target) => identity(target) === identity(goal) ? premises : undefined,
    inspect: () => undefined,
  }))
  const base = new EvidenceBase([observationRule, ...rules])
  for (const rule of rules) base.propose({ claim: goal, rule: rule.id, observations: [] })
  return base
}
const alternatives = graph([[a, b], [c]])
const conjunction = graph([[a, b, c]])
assert.deepEqual(alternatives.assess(goal), conjunction.assess(goal))
await observe(alternatives, c, true, { sample: 'C' })
await observe(conjunction, c, true, { sample: 'C' })
assert.equal(alternatives.assess(goal).status, 'supported')
assert.equal(conjunction.assess(goal).status, 'unresolved')
console.log('F1: identical gap reports conceal (A AND B) OR C versus A AND B AND C; establishing C has different consequences.')

// Resolution is used forever even though its supporting replay is out of date.
const base = new EvidenceBase([observationRule])
const target = claim('shared helper')
await observe(base, target, false, { input: 'original-counterexample' })
base.advanceContext()
const repair = await observe(base, target, true, { input: 'original-counterexample' })
base.resolve(1, repair.id)
assert.equal(base.assess(target).status, 'supported')
base.advanceContext()
assert.equal(base.assess(target).status, 'unresolved')
const ordinary = await observe(base, target, true, { input: 'unrelated-campaign' })
assert.equal(base.assess(target).status, 'supported')
const saved = base.history()
assert.notEqual(saved.observations.find((entry) => entry.id === repair.id).epoch, ordinary.epoch)
assert.equal(saved.challenges[0].resolution, repair.id)
console.log('F2: a stale original-case replay still clears the historical counterexample; a fresh unrelated campaign restores support in a later context.')

// Proper negative controls for candidate F2.
const fresh = new EvidenceBase([observationRule])
await observe(fresh, target, false, { input: 'original-counterexample' })
await observe(fresh, target, true, { input: 'unrelated-campaign' })
assert.equal(fresh.assess(target).status, 'contradicted')
console.log('Control: without an earlier explicit resolution, unrelated green evidence does NOT erase a counterexample.')
