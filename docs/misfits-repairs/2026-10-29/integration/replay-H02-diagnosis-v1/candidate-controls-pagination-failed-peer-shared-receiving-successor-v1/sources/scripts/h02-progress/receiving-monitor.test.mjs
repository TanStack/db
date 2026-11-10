import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  createHeapDiagnostic,
  createPostEnqueueMonitor,
  postEnqueueWindowMs,
  selectSupervisorReason,
} from './receiving-monitor.mjs'

// Pure instrument calibration. No provider, production graph or receiving
// invocation runs. Captured diagnostics are immutable prior-run inputs.
const premise = () => ({
  sequence: 214,
  phase: `conflicting-cache-premise`,
  cut: `held-queryFn-registration`,
  pivot: 3,
  pendingAtom: `["h02-progress-markers",2,[3]]`,
  pendingKey: [`h02-progress-markers`, 2, [3]],
  cached: { version: 4, backendVersion: 0, rows: [3] },
  emptySibling: {
    atom: `["h02-progress-markers",1,[3]]`,
    key: [`h02-progress-markers`, 1, [3]],
    answer: { version: 10, backendVersion: 1, rows: [] },
  },
  observed: {
    pending: true,
    aborted: false,
    pendingScope: [3],
    siblingScope: [3],
    pendingOwner: 2,
    siblingOwner: 1,
    pendingStartCount: 1,
    pendingActualCount: 1,
    pendingStatus: `success`,
    pendingFetchStatus: `fetching`,
    siblingStartCount: 0,
    siblingActualCount: 1,
    siblingStatus: `success`,
    siblingRows: [],
    physicalQueriesCurrent: true,
    pendingPhysicalQuery: 4,
    currentPhysicalQuery: 4,
    siblingPhysicalQuery: 10,
    siblingAnswerPhysicalQuery: 10,
  },
})
const queued = () => ({
  sequence: 216,
  phase: `answer-queued`,
  kind: `resolving-conflict`,
  atom: `["h02-progress-markers",2,[3]]`,
  key: [`h02-progress-markers`, 2, [3]],
  cachedVersion: 4,
  emptyVersion: 10,
  scheduler: `microtask`,
  enqueueReturned: true,
})
const executed = () => ({
  ...queued(),
  phase: `answer-executed`,
  sequence: 300,
})
const armed = () => {
  const monitor = createPostEnqueueMonitor()
  monitor.observe(premise(), 20_000)
  monitor.observe(queued(), 20_001)
  return monitor
}
const heapText = `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`

test(`detects a complete incoming diagnostic before trimming its long tail`, () => {
  const input = `${heapText}\n${`x`.repeat(8000)}`
  assert.equal(
    /Allocation failed - JavaScript heap out of memory/.test(
      input.slice(-4000),
    ),
    false,
  )
  assert.equal(createHeapDiagnostic().feed(input), true)
})

test(`detects every split inside the native heap marker and stays sticky`, () => {
  for (let split = 1; split < heapText.length; split++) {
    const detector = createHeapDiagnostic()
    detector.feed(heapText.slice(0, split))
    assert.equal(detector.feed(heapText.slice(split)), true)
    assert.equal(detector.feed(`ordinary later diagnostics`.repeat(500)), true)
    assert.equal(detector.detected(), true)
  }
})

test(`captured v6 heap bytes classify under whole, tiny and 1024-byte chunks`, () => {
  const file = process.env.H02_PROGRESS_V6_STDERR
  assert.ok(file, `H02_PROGRESS_V6_STDERR must name the frozen raw diagnostic`)
  const bytes = readFileSync(file)
  assert.equal(
    createHash(`sha256`).update(bytes).digest(`hex`),
    `9bd25bc081ade65c74934beeb7deba2323c5f836bf73b758940cbcaa4178aa7c`,
  )
  for (const size of [bytes.length, 1024, 1]) {
    const detector = createHeapDiagnostic()
    for (let offset = 0; offset < bytes.length; offset += size)
      detector.feed(bytes.subarray(offset, offset + size).toString(`utf8`))
    assert.equal(detector.detected(), true)
  }
})

test(`captured v5 inspector assertion and ordinary heap words do not classify as OOM`, () => {
  const file = process.env.H02_PROGRESS_V5_STDERR
  assert.ok(file, `H02_PROGRESS_V5_STDERR must name the frozen raw diagnostic`)
  const text = readFileSync(file, `utf8`)
  assert.match(text, /Assertion failed|Check failed|CHECK/i)
  const detector = createHeapDiagnostic()
  detector.feed(text)
  detector.feed(`the ordinary heap has available space`)
  assert.equal(detector.detected(), false)
})

test(`startup and a conflict without completed enqueue never arm progress containment`, () => {
  const monitor = createPostEnqueueMonitor()
  monitor.observe({ sequence: 1, phase: `worker-start` }, 0)
  assert.equal(monitor.expired(10 ** 9), false)
  monitor.observe(premise(), 10 ** 9)
  assert.equal(monitor.expired(2 * 10 ** 9), false)
})

test(`rejects enqueue before measured premise instead of arming retroactively`, () => {
  const monitor = createPostEnqueueMonitor()
  assert.throws(
    () => monitor.observe(queued(), 100),
    /invalid resolving enqueue/,
  )
  assert.equal(monitor.expired(10 ** 9), false)
})

test(`rejects missing physical, applied, current, scope or pending premise facts`, () => {
  const mutations = [
    (receipt) => {
      receipt.observed.pending = false
    },
    (receipt) => {
      receipt.observed.aborted = true
    },
    (receipt) => {
      receipt.observed.currentPhysicalQuery = 99
    },
    (receipt) => {
      receipt.observed.siblingAnswerPhysicalQuery = 99
    },
    (receipt) => {
      receipt.observed.physicalQueriesCurrent = false
    },
    (receipt) => {
      receipt.observed.siblingActualCount = 0
    },
    (receipt) => {
      receipt.observed.pendingActualCount = 2
    },
    (receipt) => {
      receipt.observed.siblingOwner = 2
    },
    (receipt) => {
      receipt.observed.pendingScope = [2]
    },
    (receipt) => {
      receipt.emptySibling.answer.rows = [3]
    },
  ]
  for (const mutate of mutations) {
    const monitor = createPostEnqueueMonitor()
    const receipt = premise()
    mutate(receipt)
    assert.throws(
      () => monitor.observe(receipt, 100),
      /invalid measured conflict/,
    )
    assert.equal(monitor.expired(10 ** 9), false)
  }
})

test(`requires completed enqueue after the exact measured key and answer versions`, () => {
  for (const change of [
    { enqueueReturned: false },
    { atom: `other` },
    { key: [`other`] },
    { cachedVersion: 5 },
    { emptyVersion: 11 },
    { sequence: 213 },
    { scheduler: `inline` },
  ]) {
    const monitor = createPostEnqueueMonitor()
    monitor.observe(premise(), 100)
    assert.throws(
      () => monitor.observe({ ...queued(), ...change }, 101),
      /invalid resolving enqueue/,
    )
    assert.equal(monitor.expired(10 ** 9), false)
  }
})

test(`arms from parent enqueue observation and honors the exact containment boundary`, () => {
  const monitor = armed()
  assert.equal(monitor.expired(20_001 + postEnqueueWindowMs - 1), false)
  assert.equal(monitor.expired(20_001 + postEnqueueWindowMs), true)
  assert.equal(monitor.snapshot().queuedAtParentMonotonicMs, 20_001)
})

test(`execution disarms the progress window even if final drain observes it after cutoff`, () => {
  const monitor = armed()
  assert.equal(monitor.expired(30_000), true)
  monitor.observe(executed(), 30_001)
  assert.equal(monitor.expired(40_000), false)
  assert.equal(monitor.snapshot().executedSequence, 300)
})

test(`rejects duplicate premise, enqueue and execution milestones`, () => {
  const monitor = armed()
  assert.throws(
    () => monitor.observe(premise(), 20_002),
    /duplicate measured conflict/,
  )
  assert.throws(
    () => monitor.observe(queued(), 20_002),
    /invalid resolving enqueue/,
  )
  monitor.observe(executed(), 20_003)
  assert.throws(
    () => monitor.observe(executed(), 20_004),
    /invalid resolving execution/,
  )
})

test(`rejects execution without matching completed enqueue or answer identity`, () => {
  const monitor = createPostEnqueueMonitor()
  assert.throws(
    () => monitor.observe(executed(), 100),
    /invalid resolving execution/,
  )
  for (const change of [
    { atom: `other` },
    { emptyVersion: 11 },
    { sequence: 215 },
  ])
    assert.throws(
      () => armed().observe({ ...executed(), ...change }, 20_002),
      /invalid resolving execution/,
    )
})

test(`lawful ablation control callbacks do not require or arm a conflicting premise`, () => {
  const monitor = createPostEnqueueMonitor()
  monitor.observe(
    { sequence: 1, phase: `answer-queued`, kind: `lawful-control` },
    100,
  )
  monitor.observe(
    { sequence: 2, phase: `answer-executed`, kind: `lawful-control` },
    101,
  )
  assert.equal(monitor.expired(10 ** 9), false)
})

test(`milestones retain only fixed scalar identity and counters as receipts grow`, () => {
  const monitor = armed()
  const fields = Object.keys(monitor.snapshot()).sort()
  for (let index = 0; index < 20_000; index++)
    monitor.observe(
      {
        sequence: 217 + index,
        phase: index % 2 ? `acquisition-attempt` : `acquisition-release`,
      },
      20_002,
    )
  const snapshot = monitor.snapshot()
  assert.deepEqual(Object.keys(snapshot).sort(), fields)
  assert.equal(snapshot.receiptCount, 20_002)
  assert.equal(snapshot.acquisitionCount, 10_000)
  assert.equal(snapshot.releaseCount, 10_000)
  assert.equal(snapshot.lastSequence, 20_216)
  assert.ok(
    Object.values(snapshot).every(
      (value) =>
        value === undefined || [`number`, `string`].includes(typeof value),
    ),
  )
})

test(`resource and observation failures take precedence over watchdog evidence`, () => {
  for (const prior of [`heap`, `rss`, `observation`])
    assert.equal(selectSupervisorReason(prior, `wall`, false), prior)
  for (const next of [`heap`, `rss`, `observation`])
    assert.equal(selectSupervisorReason(`wall`, next, false), next)
  assert.equal(selectSupervisorReason(`observation`, `wall`, true), `heap`)
  assert.equal(selectSupervisorReason(`exited`, `wall`, false), `wall`)
})
