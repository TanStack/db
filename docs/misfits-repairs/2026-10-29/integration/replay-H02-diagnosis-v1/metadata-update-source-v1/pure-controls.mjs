import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// This allowlisted loader evaluates pure models/checkers only. It imports no
// production, test registration, QueryClient, supervisor or receiving driver.
const directory = dirname(fileURLToPath(import.meta.url))
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
const results = []
let accepted = 0
for (const history of [...metadata.metadataReceivingHistories, ...metadata.metadataFollowupHistories]) {
  check(history, lawful(history)); accepted++
  if (history.metadataFollowupQuarter !== undefined) {
    check(history, lawful(history, true)); accepted++
  }
}
for (const original of metadata.metadataReceivingHistories) {
  const history = { ...original, metadataFollowupQuarter: 2 }
  const receipts = lawful(history, true)
  const late = clone(receipts)
  const settled = late.findIndex((r) => r.phase === 'followup-settled')
  late.splice(settled, 0,
    { phase: 'acquisition-accepted', attempt: 100, literalTrue: false },
    { phase: 'followup-acquisition-settled', attempt: 100, outcome: 'fulfilled' })
  late.find((r) => r.phase === 'followup-settled').attempts.push([100, 'fulfilled'])
  check(history, late); accepted++
  const faults = []
  const reject = (name, mutate) => {
    const changed = clone(receipts)
    mutate(changed)
    assert.throws(() => check(history, changed), name)
    faults.push(name)
  }
  const lastEvent = (input, layer) => input.findLast((r) =>
    r.phase === (layer === 'root' ? 'public-change' : 'downstream-change'))
  for (const layer of ['root', 'downstream']) {
    reject(`${layer}/missing-previous`, (r) => { delete lastEvent(r, layer).changes[0].previousValue })
    reject(`${layer}/current-previous`, (r) => {
      const change = lastEvent(r, layer).changes[0]; change.previousValue = clone(change.value)
    })
    reject(`${layer}/reload-prior-previous`, (r) => {
      lastEvent(r, layer).changes[0].previousValue = clone(r[1][layer === 'root' ? 'rows' : 'downstream'][0])
    })
    for (const field of ['$key', '$collectionId', '$hasPendingWrites', '$origin'])
      reject(`${layer}/previous-${field}`, (r) => { lastEvent(r, layer).changes[0].previousValue[field] = 'wrong' })
    reject(`${layer}/duplicate-update`, (r) => {
      const event = lastEvent(r, layer); event.changes.push(clone(event.changes[0]))
    })
    reject(`${layer}/omitted-callback`, (r) => { r.splice(r.indexOf(lastEvent(r, layer)), 1) })
    reject(`${layer}/callback-read-stale-final-correct`, (r) => { lastEvent(r, layer).rows[0].rank = 30 })
    reject(`${layer}/key-churn`, (r) => {
      const event = lastEvent(r, layer)
      event.entries[0][0] = 'changed'; event.entries[0][1].$key = 'changed'; event.rows[0].$key = 'changed'
      event.changes[0].key = 'changed'; event.changes[0].value.$key = 'changed'
    })
    // Copying unchanged current metadata onto the correct previous ordinary
    // row is equivalent. This is deliberately accepted, never a claimed kill.
    const equivalent = clone(receipts)
    const change = lastEvent(equivalent, layer).changes[0]
    for (const field of ['$key', '$collectionId', '$hasPendingWrites', '$origin'])
      change.previousValue[field] = change.value[field]
    check(history, equivalent); accepted++
  }
  const lateUnsettled = clone(late)
  lateUnsettled.splice(lateUnsettled.findIndex((r) => r.phase === 'followup-acquisition-settled' && r.attempt === 100), 1)
  assert.throws(() => check(history, lateUnsettled), 'later acquisition must settle')
  faults.push('later-acquisition-must-settle')
  reject('start-before-compared-baseline', (r) => {
    const start = r.splice(r.findIndex((x) => x.phase === 'followup-start'), 1)[0]
    r.splice(r.findIndex((x) => x.phase === 'final-publication'), 0, start)
  })
  reject('baseline-unsettled', (r) => { r.find((x) => x.phase === 'final-publication').rootLoadingSubset = true })
  reject('source-applied-omitted', (r) => { r.splice(r.findIndex((x) => x.phase === 'followup-source-applied'), 1) })
  reject('acquisition-settlement-omitted', (r) => { r.splice(r.findIndex((x) => x.phase === 'followup-acquisition-settled'), 1) })
  reject('acquisition-settlement-invented', (r) => { r.find((x) => x.phase === 'followup-acquisition-settled').attempt = 88 })
  reject('acquisition-rejected', (r) => { r.find((x) => x.phase === 'followup-acquisition-settled').outcome = 'rejected' })
  reject('unsettled-output-final-correct', (r) => { r.find((x) => x.phase === 'followup-settled').downstreamSubscriptionStatus = 'loadingSubset' })
  reject('duplicate-baseline-reset', (r) => { r.splice(-2, 0, clone(r.find((x) => x.phase === 'final-publication'))) })
  results.push({ cacheIdentity: history.cacheIdentity, keys: history.metadataKeys, rejected: faults.length, faults })
}

// Finite model/grammar checks vary all translations/scales/quarter distances;
// they are pure judgments of authored receipts, never generated native reach.
let modeled = 0
for (const path of metadata.metadataReceivingPaths)
  for (let keyShift = 0; keyShift <= 20; keyShift++)
    for (let rankScale = 1; rankScale <= 20; rankScale++)
      for (const metadataFollowupQuarter of [0, 1, 2, 3]) {
        const history = { ...progress.queuedAnswerExample, ...path, keyShift, rankScale,
          nonemptyPrior: true, metadataFollowupQuarter }
        assert.deepEqual(progress.modelProgressValue(history, true, true), [{
          id: keyShift + 3, rank: (3 + metadataFollowupQuarter / 4) * rankScale, markers: [],
        }])
        check(history, lawful(history)); modeled++
      }
const result = {
  status: 'pure/source preparation only; no native registration, receiving, production or mutants',
  assertionAdapter: 'node:assert/strict; native Vitest execution remains unestablished',
  acceptedControls: accepted, modeledReceiptHistories: modeled, paths: results,
  rejected: results.reduce((n, r) => n + r.rejected, 0),
  equivalentCurrentMetadataAccepted: 8,
  limits: 'Actual same-key updates, acquisition settlement, terminal metadata and per-layer native production-mutant kills remain UNREACHED.',
}
writeFileSync(resolve(directory, 'pure-results.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
