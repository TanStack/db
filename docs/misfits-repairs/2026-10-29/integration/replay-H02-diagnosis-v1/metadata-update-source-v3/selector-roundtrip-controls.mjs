import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Test the recorder-to-checker handoff with the real selected outcome. This
// evaluates only pure checker modules and extracted parent/selection bodies.
// It imports no supervisor module, test registration, Collection or QueryClient.
const directory = dirname(fileURLToPath(import.meta.url))
const root = resolve(directory, 'sources')
const previous = resolve(directory, '../metadata-update-source-v2')
const actual = resolve(directory, '../metadata-update-receiving-actual-v2/inner')
const require = createRequire(resolve(root, 'package.json'))
const ts = require('typescript')
const prefix = 'packages/query-db-collection/tests/'
const hash = (value) => createHash('sha256').update(value).digest('hex')
const text = (path) => readFileSync(path, 'utf8')
const json = (name) => JSON.parse(text(resolve(actual, name)))
const clone = structuredClone
const allowed = new Set([
  `${prefix}queued-answer-progress-oracle.ts`,
  `${prefix}queued-answer-metadata-oracle.ts`,
  `${prefix}queued-answer-progress-receipts.ts`,
  'packages/db/tests/oracle-declaration.ts',
  'packages/db/tests/query/load-subset-retained-publication-oracle.ts',
  'packages/db/tests/query/virtual-row-fields-publication-oracle.ts',
  'packages/db/tests/query/virtual-row-fields-source-oracle.ts',
  'packages/db/tests/query/virtual-row-fields-support.ts',
])
const expect = (value) => ({
  toEqual: (expected) => assert.deepEqual(value, expected),
  toBe: (expected) => assert.ok(Object.is(value, expected)),
  toBeGreaterThan: (expected) => assert.ok(value > expected),
})
const cache = new Map()
function evaluate(source, file, inputs) {
  const compiled = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  const localRequire = (id) => {
    if (id === 'inputs') return inputs
    if (id === 'vitest') return { expect }
    if (['node:util', 'fast-check'].includes(id)) return require(id)
    const relative = resolve(dirname(file), id.replace(/\.js$/, '.ts')).slice(root.length + 1)
    return load(relative)
  }
  new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports)
  return module.exports
}
function load(relative) {
  assert.ok(allowed.has(relative), `undeclared pure module: ${relative}`)
  if (!cache.has(relative)) {
    const file = resolve(root, relative)
    cache.set(relative, evaluate(text(file), file))
  }
  return cache.get(relative)
}
const parse = (path) => ts.createSourceFile(path, text(path), ts.ScriptTarget.Latest, true)
const functionText = (path, name) => {
  const source = parse(path)
  const node = source.statements.find((part) => ts.isFunctionDeclaration(part) && part.name?.text === name)
  assert.ok(node, name)
  return node.getText(source)
}

// Extract the actual push guard, including its body. The old phase allowlist
// stays in its immutable source; this calibration never copies either list.
function selectFromSupervisor(path, support) {
  const source = parse(path)
  const nodes = []
  const visit = (node) => {
    if (ts.isIfStatement(node) && node.thenStatement.getText(source).trim() === '{\n        outcome.receipts.push(receipt)\n      }') nodes.push(node)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.equal(nodes.length, 1, 'one actual retained-outcome push guard')
  const body = `const { retainProgressReceipt } = require('inputs');\n` +
    `module.exports = function(receipts) { const outcome = { receipts: [] }; for (const receipt of receipts) { ${nodes[0].getText(source)} } return outcome.receipts; };`
  return { select: evaluate(body, resolve(root, 'selected-guard.ts'), support), source: nodes[0].getText(source) }
}
const progress = load(`${prefix}queued-answer-progress-oracle.ts`)
const metadata = load(`${prefix}queued-answer-metadata-oracle.ts`)
const publication = load('packages/db/tests/query/virtual-row-fields-publication-oracle.ts')
const support = load(`${prefix}queued-answer-progress-receipts.ts`)
const oldSelector = selectFromSupervisor(resolve(previous, `sources/${prefix}queued-answer-progress-supervisor.ts`), {})
const newSelector = selectFromSupervisor(resolve(root, `${prefix}queued-answer-progress-supervisor.ts`), support)
assert.equal(newSelector.source.split('retainProgressReceipt(receipt)').length, 2)
const runtimePath = resolve(root, `${prefix}queued-answer-metadata-oracle.test.ts`)
const runSource = functionText(runtimePath, 'run')

// Execute the exact parent run() with a pure replacement for receiving. That
// replacement preserves the actual ordering: every raw receipt is observed,
// observation errors are retained, selected outcome is judged, then finish().
// The outcome's host/provenance facts are captured premises, not new execution.
async function roundtrip(history, receipts, select = newSelector.select, mutateOutcome = () => {}) {
  const counts = new Map()
  const stats = { beginHistory: 0, observed: 0, observationErrors: [], outcomeStarted: 0, outcomePassed: 0, finishAttempted: 0, finishPassed: 0 }
  const reach = {
    beginHistory: () => { stats.beginHistory++ },
    reach: (state) => counts.set(state, 1),
    counts: () => counts,
  }
  const inputs = {
    createMetadataReceiptCheck: (...args) => {
      const observe = metadata.createMetadataReceiptCheck(...args)
      return Object.assign(observe, { finish: (() => {
        const finish = observe.finish.bind(observe)
        return () => { stats.finishAttempted++; finish(); stats.finishPassed++ }
      })() })
    },
    createProgressReceiptCheck: progress.createProgressReceiptCheck,
    checkQueuedAnswerProgress: (...args) => {
      stats.outcomeStarted++
      progress.checkQueuedAnswerProgress(...args)
      stats.outcomePassed++
    },
    receiveProgressHistory: async (_history, observe) => {
      const outcome = { ...clone(capturedOutcome), receipts: select(clone(receipts)) }
      mutateOutcome(outcome)
      for (const receipt of clone(receipts)) {
        stats.observed++
        try { observe(receipt) } catch (error) {
          stats.observationErrors.push(String(error))
          outcome.primaryObservationError ??= error.stack ?? String(error)
        }
      }
      return outcome
    },
    console: { info: () => {} },
  }
  const run = evaluate(`const { createMetadataReceiptCheck, createProgressReceiptCheck, checkQueuedAnswerProgress, receiveProgressHistory, console } = require('inputs');\n${runSource}\nmodule.exports = run;`, runtimePath, inputs)
  try {
    await run(history, reach)
    return { accepted: true, stats, states: [...counts.keys()] }
  } catch (error) {
    return { accepted: false, error: String(error), stats, states: [...counts.keys()] }
  }
}
const capturedReceipts = text(resolve(actual, 'receipts.jsonl')).trim().split('\n').map(JSON.parse)
const history = json('history.json')
const capturedOutcome = json('supervisor.json').outcome
assert.equal(capturedReceipts.length, 206)
assert.deepEqual(oldSelector.select(capturedReceipts), capturedOutcome.receipts)
assert.equal(capturedOutcome.receipts.length, 21)
const selected = newSelector.select(capturedReceipts)
assert.equal(selected.length, 23)
assert.deepEqual(selected.filter((r) => r.phase.startsWith('followup-')).map((r) => [r.sequence, r.phase]), [[162, 'followup-start'], [185, 'followup-publication']])
assert.deepEqual(selected.filter((r) => !r.phase.startsWith('followup-')), capturedOutcome.receipts)
const historical = await roundtrip(history, capturedReceipts, oldSelector.select)
assert.equal(historical.accepted, false)
assert.match(historical.error, /rank: 35/)
assert.match(historical.error, /rank: 30/)
assert.deepEqual(historical.stats.observationErrors, [])
assert.equal(historical.stats.outcomeStarted, 1)
assert.equal(historical.stats.outcomePassed, 0)
assert.equal(historical.stats.finishAttempted, 0)
const corrected = await roundtrip(history, capturedReceipts)
assert.equal(corrected.accepted, true, corrected.error)
assert.equal(corrected.stats.observed, 206)
assert.equal(corrected.stats.outcomePassed, 1)
assert.equal(corrected.stats.finishPassed, 1)
for (const state of metadata.metadataHistoryStates(history)) assert.ok(corrected.states.includes(state), state)
assert.equal(corrected.states.length, 31)

const faults = []
async function reject(name, mutate, faultHistory = history, receipts = capturedReceipts, mutateOutcome) {
  const changed = clone(receipts)
  mutate(changed)
  const result = await roundtrip(faultHistory, changed, newSelector.select, mutateOutcome)
  assert.equal(result.accepted, false, name)
  assert.equal(result.stats.finishPassed, 0, name)
  faults.push({ name, error: result.error, stats: result.stats })
  return result
}
const remove = (receipts, phase) => receipts.splice(receipts.findIndex((r) => r.phase === phase), 1)
const lastEvent = (receipts, layer) => receipts.findLast((r) => r.phase === (layer === 'root' ? 'public-change' : 'downstream-change'))
for (const layer of ['root', 'downstream']) {
  await reject(`${layer}/omitted-callback`, (r) => r.splice(r.indexOf(lastEvent(r, layer)), 1))
  await reject(`${layer}/missing-previousValue`, (r) => { delete lastEvent(r, layer).changes[0].previousValue })
  await reject(`${layer}/current-row-previousValue`, (r) => {
    const change = lastEvent(r, layer).changes[0]; change.previousValue = clone(change.value)
  })
  await reject(`${layer}/stale-prior-window-previousValue`, (r) => {
    const prior = r.find((x) => x.phase === 'initial-publication')
    lastEvent(r, layer).changes[0].previousValue = clone(prior[layer === 'root' ? 'rows' : 'downstream'][0])
  })
  for (const field of ['$key', '$collectionId', '$hasPendingWrites', '$origin'])
    await reject(`${layer}/wrong-previousValue-${field}`, (r) => { lastEvent(r, layer).changes[0].previousValue[field] = 'wrong' })
  await reject(`${layer}/stale-followup-publication`, (r) => {
    const final = r.find((x) => x.phase === 'followup-publication')
    final[layer === 'root' ? 'rows' : 'downstream'][0].rank = 30
  })
  await reject(`${layer}/stale-callback-read`, (r) => { lastEvent(r, layer).rows[0].rank = 30 })
  await reject(`${layer}/wrong-reload-baseline`, (r) => {
    r.find((x) => x.phase === 'final-publication')[layer === 'root' ? 'rows' : 'downstream'][0].rank = 35
  })
  // Metadata fields do not change in this history. Copying the current fields
  // onto the correct previous ordinary row is equivalent and must remain legal.
  const equivalent = clone(capturedReceipts)
  const change = lastEvent(equivalent, layer).changes[0]
  for (const field of ['$key', '$collectionId', '$hasPendingWrites', '$origin']) change.previousValue[field] = change.value[field]
  const accepted = await roundtrip(history, equivalent)
  assert.equal(accepted.accepted, true, accepted.error)
}
for (const phase of ['final-publication', 'followup-start', 'followup-publication', 'followup-source-accepted', 'followup-source-applied', 'followup-settled', 'worker-cleaned'])
  await reject(`omitted/${phase}`, (r) => remove(r, phase))
await reject('entire-followup-omitted', (r) => {
  const start = r.findIndex((x) => x.phase === 'followup-start')
  r.splice(start, r.findIndex((x) => x.phase === 'followup-publication') - start + 1)
})
const finalizer = await reject('followup-and-cleanup-omitted-without-reach-assertion', (r) => {
  const start = r.findIndex((x) => x.phase === 'followup-start')
  r.splice(start)
})
assert.equal(finalizer.stats.outcomePassed, 1)
assert.equal(finalizer.stats.finishAttempted, 1)
assert.match(finalizer.error, /declared follow-up publication was not compared/)
await reject('postrun-only-stale-followup-callback', () => {}, history, capturedReceipts, (outcome) => {
  outcome.receipts.find((r) => r.sequence === 182).rows[0].rank = 30
})
await reject('postrun-only-omitted-followup-start', () => {}, history, capturedReceipts, (outcome) => remove(outcome.receipts, 'followup-start'))
await reject('postrun-only-missing-final-checkpoint', () => {}, history, capturedReceipts, (outcome) => remove(outcome.receipts, 'final-publication'))

// Preserve the old 17-state histories and the opt-in no-op/acquisition neighbors
// through the same actual parent body. Reuse the unchanged authored-receipt
// grammar from source-v2; its values remain pure controls, not host reach.
const authored = evaluate(`const { progress, publication, clone } = require('inputs');\n${functionText(resolve(previous, 'pure-controls.mjs'), 'lawful')}\nmodule.exports = lawful;`, resolve(root, 'authored-controls.ts'), { progress, publication, clone })
const neighbors = []
for (const neighbor of [...metadata.metadataReceivingHistories, ...metadata.metadataFollowupHistories]) {
  const receipts = authored(neighbor, true)
  if (neighbor.cacheIdentity === 'subscription') receipts.unshift({ phase: 'conflicting-cache-premise' })
  receipts.forEach((r, index) => { r.sequence = index + 1 })
  const result = await roundtrip(neighbor, receipts)
  assert.equal(result.accepted, true, result.error)
  for (const state of metadata.metadataHistoryStates(neighbor)) assert.ok(result.states.includes(state), state)
  if (neighbor.metadataFollowupQuarter === undefined)
    assert.deepEqual(newSelector.select(receipts), oldSelector.select(receipts))
  neighbors.push({ history: neighbor, states: result.states, finishPassed: result.stats.finishPassed })
  if (neighbor.metadataFollowupQuarter !== undefined) {
    const removeStage = (r) => {
      const start = r.findIndex((x) => x.phase === 'followup-start')
      r.splice(start, r.findIndex((x) => x.phase === 'followup-publication') - start + 1)
    }
    await reject(`neighbor/${neighbor.cacheIdentity}/${neighbor.metadataKeys}/${neighbor.metadataFollowupQuarter}/omitted-stage`, removeStage, neighbor, receipts)
    await reject(`neighbor/${neighbor.cacheIdentity}/${neighbor.metadataKeys}/${neighbor.metadataFollowupQuarter}/unsettled-acquisition`, (r) => remove(r, 'followup-acquisition-settled'), neighbor, receipts)
  }
}
const result = {
  status: 'source/static/pure calibration only; no new native registration or receiving execution',
  authority: 'metadata-update-receiving-root-classification-v2.json',
  binding: {
    rawReceiptsSha256: hash(readFileSync(resolve(actual, 'receipts.jsonl'))),
    rawReceipts: capturedReceipts.length,
    oldSupervisorSha256: hash(readFileSync(resolve(previous, `sources/${prefix}queued-answer-progress-supervisor.ts`))),
    newSupervisorSha256: hash(readFileSync(resolve(root, `${prefix}queued-answer-progress-supervisor.ts`))),
    newSelectorSha256: hash(readFileSync(resolve(root, `${prefix}queued-answer-progress-receipts.ts`))),
    exactParentRunSourceSha256: hash(runSource),
    parentRuntimeModuleSha256: hash(readFileSync(runtimePath)),
    oldSelectedReceipts: 21,
    newSelectedReceipts: 23,
  },
  historical,
  corrected,
  rejected: faults.length,
  faults,
  neighbors,
  equivalentCurrentMetadataAccepted: 2,
  limits: 'Strict Node assertions replace Vitest assertions. Actual outcome host/provenance fields are captured premises. Pure corruption controls are no new host or production evidence. Metadata omissions/full previousValue and finish are judged on realtime raw receipts; the retained post-run payload checker is not a second metadata checker. Changing-metadata sensitivity, fresh native receiving and production closure remain unestablished.',
}
writeFileSync(resolve(directory, 'selector-roundtrip-results.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ status: result.status, raw: 206, retainedBefore: 21, retainedAfter: 23, historicalRejected: !historical.accepted, correctedFinalizer: corrected.stats.finishPassed, reached: corrected.states.length, rejected: faults.length, neighbors: neighbors.length }, null, 2))
