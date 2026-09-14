// CONSTRUCTED negative controls, not an implementation of the frozen candidate.
// Each models an explicitly insufficient rule and its missing assertion.
import assert from 'node:assert/strict'
const results = []

{
  const epoch = 1
  const earlyOrdinaryRead = { epoch, rows: 0, covers: [] }
  const quietRead = { epoch, rows: 1, covers: ['M'] }
  let authority = quietRead.rows
  const acceptedFrontier = new Set(quietRead.covers)
  // M has now retired. A current-pending-only check sees no outstanding work.
  const outstanding = []
  const weakAdmission = earlyOrdinaryRead.epoch === epoch && outstanding.length === 0
  const strongAdmission = [...acceptedFrontier].every((m) => earlyOrdinaryRead.covers.includes(m))
  if (weakAdmission) authority = earlyOrdinaryRead.rows
  assert.equal(authority, 0)
  assert.equal(strongAdmission, false)
  results.push({ scene: 'late ordinary read after retirement', weakAuthority: authority,
    justifiedAuthority: quietRead.rows, strongAdmission,
    events: ['M starts / epoch 1', 'ordinary read observes 0 while M runs',
      'M commits 1 / outcome known', 'quiet read observes 1', 'install 1 / retire M',
      'ordinary read returns at epoch 1 / weak rule installs 0'] })
}

{
  const retained = new Map([['C1', 1]])
  const readTargets = new Map(retained)
  retained.set('C2', 1)
  const weakComplete = [...readTargets].every(([c, generation]) => retained.get(c) === generation)
  const strongComplete = [...retained].every(([c, generation]) => readTargets.get(c) === generation)
  assert.equal(weakComplete, true)
  assert.equal(strongComplete, false)
  results.push({ scene: 'late retained instance', weakComplete, strongComplete,
    events: ['M finished', 'quiet read captures C1 lifetime 1',
      'C2 lifetime 1 becomes retained / its initial read held',
      'quiet read returns only C1 / no mutation epoch changed',
      'weak rule retires M while C2 has no authoritative coverage'] })
}

{
  const authority = { all: false, completedContains: false }
  const observations = []
  authority.all = true
  observations.push({ ...authority })
  authority.completedContains = true
  observations.push({ ...authority })
  assert.equal(observations[0].all === observations[0].completedContains, false)
  const baseline = 20
  const overlays = new Map([['M1', 1], ['M2', 2]])
  const visible = () => [...overlays.values()].at(-1) ?? baseline
  const rows = [visible()]
  overlays.delete('M2')
  rows.push(visible())
  overlays.delete('M1')
  rows.push(visible())
  assert.deepEqual(rows, [2, 1, 20])
  results.push({ scene: 'disclosed non-atomic publication and retirement', observations,
    retirementVisibleRows: rows, authorityNeverRegressed: baseline,
    note: 'Not a candidate safety refutation: intermediate rows remain owned guesses.' })
}

{
  const observationsBeforeRelease = { transport: 'rejected', readRows: 0 }
  const worldA = { ...observationsBeforeRelease, laterAuthority: 0 }
  const worldB = { ...observationsBeforeRelease, laterAuthority: 1 }
  assert.deepEqual({ transport: worldA.transport, readRows: worldA.readRows },
    { transport: worldB.transport, readRows: worldB.readRows })
  results.push({ scene: 'unknown handler cannot be closed by a fresh read', observationsBeforeRelease,
    worlds: { A: 'handler already stopped without writing',
      B: 'handler still running; commits 1 after fresh read' },
    requirement: 'keep closure unknown until evidence exists; a retry of the read is not closure evidence' })
}

console.log(JSON.stringify({ evidence: 'constructed scheduler models / unsafe negative controls only', results }, null, 2))
