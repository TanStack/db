import assert from 'node:assert/strict'
import { EvidenceBase, identity } from './snapshot/kernel.ts'

const target = { law: 'assay/bounded-campaign@1', subject: 'helper', scope: { campaign: 'fixture' } }
const finding = (passed, input = 1) => ({ claim: target, case: { input }, passed, value: 'checked' })
// Mirrors the frozen test fixture's admission rule. No malicious plugin is used.
const leaf = {
  id: 'assay/observation@1',
  premises: () => [],
  inspect: (claim, observations) => observations.some((entry) =>
    identity(entry.claim) === identity(claim) && entry.value === 'checked')
    ? undefined : 'Missing matching observation',
}
function propose(base, observation) {
  base.propose({ claim: target, rule: leaf.id, observations: [observation.id] })
}
async function record(base, passed, input = 1) {
  const [observation] = await base.run('assay/checker@1', async () => [finding(passed, input)])
  return observation
}

// H1: A once-valid resolution escapes all later per-use freshness checks.
{
  const base = new EvidenceBase([leaf])
  await record(base, false)
  const replay = await record(base, true)
  base.resolve(1, replay.id)
  base.advanceContext()
  assert.equal(base.assess(target).status, 'unresolved')
  const unrelated = await record(base, true, 2)
  propose(base, unrelated)
  assert.equal(base.assess(target).status, 'supported')
  const history = base.history()
  assert.equal(history.observations.find((entry) => entry.id === replay.id).epoch, 0)
  assert.equal(unrelated.epoch, 1)
  console.log(JSON.stringify({ witness: 'H1', status: base.assess(target).status, history }))
}

// H2a: Ordering two findings in a single execution creates an apparent replay.
{
  const base = new EvidenceBase([leaf])
  const [failed, passed] = await base.run('assay/checker@1', async () => [finding(false), finding(true)])
  assert.equal(failed.run, passed.run)
  base.resolve(1, passed.id)
  propose(base, passed)
  assert.equal(base.assess(target).status, 'supported')
  console.log(JSON.stringify({ witness: 'H2a', status: base.assess(target).status, history: base.history() }))
}

// H2b: A pass already measured before a failure counts as replay if delivery is late.
{
  const base = new EvidenceBase([leaf])
  let deliverEarlierMeasurement
  const measuredBeforeFailure = finding(true)
  const earlierRun = base.run('assay/checker@1', () => new Promise((resolve) => {
    deliverEarlierMeasurement = () => resolve([measuredBeforeFailure])
  }))
  await record(base, false)
  deliverEarlierMeasurement()
  const [latePass] = await earlierRun
  base.resolve(1, latePass.id)
  propose(base, latePass)
  assert.equal(base.assess(target).status, 'supported')
  console.log(JSON.stringify({ witness: 'H2b', status: base.assess(target).status, history: base.history() }))
}
