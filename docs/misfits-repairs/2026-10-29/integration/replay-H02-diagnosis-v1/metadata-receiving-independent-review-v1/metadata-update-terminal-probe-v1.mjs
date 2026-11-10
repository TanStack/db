import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// This allowlisted loader evaluates pure models/checkers only. It imports no
// production, test registration, QueryClient, supervisor or receiving driver.
const directory = "/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-survey-open-items/docs/misfits-repairs/2026-10-29/integration/replay-H02-diagnosis-v1/metadata-update-source-v1"
const root = resolve(directory, 'sources')
const require = createRequire(resolve(root, 'package.json'))
const ts = require('typescript')
const prefix = 'packages/query-db-collection/tests/'
const allowed = new Set([
  `${prefix}queued-answer-progress-oracle.ts`,
  `${prefix}queued-answer-metadata-oracle.ts`,
  'packages/db/tests/oracle-declaration.ts',
  'packages/db/tests/query/load-subset-retained-publication-oracle.ts',
  'packages/db/tests/query/virtual-row-fields-publication-oracle.ts',
  'packages/db/tests/query/virtual-row-fields-source-oracle.ts',
  'packages/db/tests/query/virtual-row-fields-support.ts',
])
const expect = (actual) => ({
  toEqual: (expected) => assert.deepEqual(actual, expected),
  toBe: (expected) => assert.ok(Object.is(actual, expected)),
  toBeGreaterThan: (expected) => assert.ok(actual > expected),
})
const cache = new Map()
function load(relative) {
  assert.ok(allowed.has(relative), `undeclared pure import: ${relative}`)
  if (cache.has(relative)) return cache.get(relative)
  const file = resolve(root, relative)
  const source = readFileSync(file, 'utf8')
  const compiled = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  const localRequire = (id) => {
    if (id === 'vitest') return { expect }
    if (['node:util', 'fast-check'].includes(id)) return require(id)
    return load(resolve(dirname(file), id.replace(/\.js$/, '.ts')).slice(root.length + 1))
  }
  new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports)
  cache.set(relative, module.exports)
  return module.exports
}
const progress = load(`${prefix}queued-answer-progress-oracle.ts`)
const metadata = load(`${prefix}queued-answer-metadata-oracle.ts`)
const publication = load('packages/db/tests/query/virtual-row-fields-publication-oracle.ts')
const clone = structuredClone
function lawful(history, withAcquisition = false) {
  const model = (stage, layer) => {
    const payload = progress.modelProgressValue(history, stage > 0, stage > 1)
    const key = (target, id) => history.metadataKeys === 'authored'
      ? `metadata-${target}-${id}` : `opaque-${target}-${id}`
    const ordinary = layer === 'root' ? payload : payload.map((row) => ({
      ...row, observedKey: key('root', row.id), observedCollectionId: 'root',
      observedOrigin: 'remote', observedPending: false,
    }))
    return publication.attributeMetadataRows(ordinary, 'structured-projection',
      new Set(), 'source', layer, (id) => key(layer, id))
  }
  const rows = (stage, layer) => publication.publishedModelRows(model(stage, layer))
  const entries = (stage, layer) => rows(stage, layer).map((row) => [row.$key, clone(row)])
  const pair = (phase, stage, extra = {}) => ({ phase,
    rows: rows(stage, 'root'), entries: entries(stage, 'root'),
    downstream: rows(stage, 'downstream'), downstreamEntries: entries(stage, 'downstream'),
    ready: true, syncError: false, ...extra,
  })
  const event = (before, after, layer) => ({
    phase: layer === 'root' ? 'public-change' : 'downstream-change',
    rows: rows(after, layer), entries: entries(after, layer),
    ...(layer === 'downstream' ? { upstreamEntries: entries(after, 'root') } : {}),
    changes: publication.expectedMetadataChanges(model(before, layer), model(after, layer)),
  })
  const result = [
    { phase: 'metadata-identities', sourceId: 'source', rootId: 'root',
      downstreamId: 'downstream', keyLane: history.metadataKeys },
    pair('initial-publication', 0), { phase: 'reload-start' },
    pair('retained-publication', 0, { reason: 'provider-hold-before-release', pendingProviderAnswers: 1 }),
    { phase: 'answer-queued', enqueueReturned: true }, { phase: 'answer-executed' },
    event(0, 1, 'root'), event(0, 1, 'downstream'),
  ]
  if (history.metadataFollowupQuarter !== undefined) result.push({ phase: 'reload-settled' })
  result.push(pair('final-publication', 1, history.metadataFollowupQuarter === undefined ? {} : {
    reloadSettled: true, rootSubscriptionStatus: 'ready', downstreamSubscriptionStatus: 'ready',
    rootLoadingSubset: false, downstreamLoadingSubset: false,
  }))
  if (history.metadataFollowupQuarter !== undefined) {
    result.push({ phase: 'followup-start' })
    if (withAcquisition) result.push({ phase: 'acquisition-accepted', attempt: 99, literalTrue: false })
    if (history.metadataFollowupQuarter > 0) result.push(event(1, 2, 'root'), event(1, 2, 'downstream'))
    result.push({ phase: 'followup-source-accepted', literalTrue: true }, { phase: 'followup-source-applied' })
    if (withAcquisition) result.push({ phase: 'followup-acquisition-settled', attempt: 99, outcome: 'fulfilled' })
    result.push({ phase: 'followup-settled', attempts: withAcquisition ? [[99, 'fulfilled']] : [],
      rootCallbacks: history.metadataFollowupQuarter > 0 ? 1 : 0,
      downstreamCallbacks: history.metadataFollowupQuarter > 0 ? 1 : 0,
      rootSubscriptionStatus: 'ready', downstreamSubscriptionStatus: 'ready',
      rootLoadingSubset: false, downstreamLoadingSubset: false,
    }, pair('followup-publication', 2))
  }
  result.push({ phase: 'cleanup-start' }, { phase: 'worker-cleaned' })
  return result.map((receipt, index) => ({ ...clone(receipt), h02: true, sequence: index + 1 }))
}
function check(history, receipts, required = true) {
  const reached = new Set()
  const meta = metadata.createMetadataReceiptCheck(history, (state) => reached.add(state))
  const root = progress.createProgressReceiptCheck(history)
  const downstream = progress.createProgressReceiptCheck(history)
  for (const receipt of receipts) {
    root(receipt)
    if (receipt.phase === 'downstream-change') downstream({ ...receipt, phase: 'public-change' })
    else if (['reload-start', 'cleanup-start', 'followup-start'].includes(receipt.phase)) downstream(receipt)
    else if (['final-publication', 'followup-publication'].includes(receipt.phase))
      downstream({ ...receipt, rows: receipt.downstream })
    meta(receipt)
    if (receipt.phase === 'conflicting-cache-premise') reached.add('conflicting-cache-premise')
  }
  if (required) for (const state of metadata.metadataHistoryStates(history))
    if (state !== 'conflicting-cache-premise') assert.ok(reached.has(state), state)
  return [...reached]
}

// Independent bounded challenge of the actual streamed runner semantics.
// Do not use the v1 pure helper's stronger per-history reach assertion.
// No test registration, production driver, supervisor or Collection is loaded.
function judge(history, input) {
  const receipts = structuredClone(input)
  if (history.cacheIdentity === 'subscription') {
    const at = receipts.findIndex((r) => r.phase === 'answer-queued')
    receipts.splice(at, 0, { phase: 'conflicting-cache-premise' })
  }
  for (let index = 0; index < receipts.length; index++)
    receipts[index].sequence = index + 1
  const meta = metadata.createMetadataReceiptCheck(history)
  const root = progress.createProgressReceiptCheck(history)
  const downstream = progress.createProgressReceiptCheck(history)
  for (const receipt of receipts) {
    root(receipt)
    if (receipt.phase === 'downstream-change')
      downstream({ ...receipt, phase: 'public-change' })
    else if (['reload-start', 'cleanup-start', 'followup-start'].includes(receipt.phase))
      downstream(receipt)
    else if (['final-publication', 'followup-publication'].includes(receipt.phase))
      downstream({ ...receipt, rows: receipt.downstream })
    meta(receipt)
  }
  progress.checkQueuedAnswerProgress(history, {
    reason: 'exited', exitCode: 0, signal: null, receipts,
    keyCallbacks: 1, prefixViolations: 0, warnings: 0, cleanupErrors: [],
    logPath: 'pure-authored-receipts-only', bindingStatus: 'bound',
  })
  if (meta.finish) meta.finish()
}
const observations = []
for (const original of metadata.metadataReceivingHistories) {
  judge(original, lawful(original))
  for (const quarter of [0, 2]) {
    const history = { ...original, metadataFollowupQuarter: quarter }
    const good = lawful(history, true)
    judge(history, good)
    const omittedStage = good.filter((r) => !r.phase.startsWith('followup-') && r.phase !== 'acquisition-accepted')
    const missingFinal = good.filter((r) => r.phase !== 'followup-publication')
    const missingWorker = good.filter((r) => r.phase !== 'worker-cleaned')
    for (const [fault, receipts] of [
      ['entire-optional-stage-omitted', omittedStage],
      ['followup-final-omitted', missingFinal],
      ['worker-cleanup-omitted', missingWorker],
    ]) {
      let error
      try { judge(history, receipts) } catch (caught) { error = String(caught.message) }
      observations.push({ cacheIdentity: history.cacheIdentity, keys: history.metadataKeys,
        quarter, fault, rejected: error !== undefined, error: error ?? null })
    }
  }
}
const version = 1
assert.equal(observations.length, 24)
assert.equal(observations.filter((r) => r.rejected).length, version === 1 ? 0 : 24)
const result = { version, lawfulOriginalAndFollowupControls: 12,
  observations, rejected: observations.filter((r) => r.rejected).length,
  limits: 'Pure authored observations only. No native registration, receiving, production execution or production RED/GREEN.' }
writeFileSync("/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-survey-open-items/docs/misfits-repairs/2026-10-29/integration/replay-H02-diagnosis-v1/metadata-receiving-independent-review-v1/metadata-update-terminal-probe-v1.json", JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
