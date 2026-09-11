import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { runCheck, consume as guardedConsume, sha256, checker } from './delivery.mjs'
const consume = process.env.TRACK_C_NAIVE_CONSUMER ? report => ({ status: report.diagnostics.length ? 'violation' : 'supported', success: !report.diagnostics.length }) : guardedConsume
const root = import.meta.dirname
const original = readFileSync(`${root}/fixtures/todo.original.ts`, 'utf8')
const file = `${root}/fixtures/todo.test.ts`
const observations = []
function record(stage, report) { observations.push({ stage, report }); writeFileSync(`${root}/traces/real-delivery.json`, JSON.stringify(observations, null, 2)) }
test('actual analyzer replacement, clear, unsupported and stale revisions stay distinct', { timeout: 60000 }, () => {
  writeFileSync(file, original)
  const first = runCheck(file)
  record('initial', first)
  assert.equal(first.status, 'violation')
  assert.equal(first.diagnostics[0].code, 'ENDPOINT_ORDER_NOT_TOTAL')
  assert.ok(first.check.evidence.schemaFingerprint)
  assert.match(first.versions.database, /PostgreSQL 17\.5/)
  const shifted = '\n\n' + original
  writeFileSync(file, shifted)
  const changed = runCheck(file)
  record('changed', changed)
  assert.equal(changed.diagnostics[0].range.start.line, first.diagnostics[0].range.start.line + 2)
  assert.notEqual(changed.source.sha256, first.source.sha256)
  assert.equal(consume(first, sha256(shifted)).status, 'stale')
  assert.equal(consume(changed, sha256(shifted)).status, 'violation')
  const expectedOld = runCheck(file, first.source.sha256)
  record('stale-request', expectedOld)
  assert.equal(expectedOld.status, 'stale')
  assert.equal(consume(expectedOld, sha256(shifted)).success, false)
  const beforeStaleApply = readFileSync(file, 'utf8')
  writeFileSync(`${root}/fixtures/stale-report.json`, JSON.stringify(first))
  const staleApply = spawnSync(process.execPath, [checker, 'apply', '--file', file, '--diagnostic', `${root}/fixtures/stale-report.json`], { encoding: 'utf8' })
  record('stale-edit-refusal', JSON.parse(staleApply.stdout))
  assert.equal(JSON.parse(staleApply.stdout).code, 'STALE_DIAGNOSTIC')
  assert.equal(readFileSync(file, 'utf8'), beforeStaleApply)
  const edit = changed.diagnostics[0].edit
  const fixed = shifted.slice(0, edit.start) + edit.text + shifted.slice(edit.end)
  writeFileSync(file, fixed)
  const [command, ...args] = changed.rerun
  const rerun = spawnSync(command, args, { encoding: 'utf8', cwd: '/', timeout: 30000 })
  const clear = JSON.parse(rerun.stdout)
  record('cleared-exact-rerun-from-root', clear)
  assert.equal(rerun.status, 0)
  assert.equal(consume(clear, sha256(fixed)).success, true)
  assert.deepEqual(clear.diagnostics, [])
  const unsupportedSource = original.replace('.orderBy(asc(todo.createdAt))', '.orderBy(asc(todo.createdAt)).limit(1)')
  writeFileSync(file, unsupportedSource)
  const unsupported = runCheck(file)
  record('unsupported', unsupported)
  assert.equal(unsupported.status, 'not checked')
  assert.equal(consume(unsupported, sha256(unsupportedSource)).success, false)
  assert.notEqual(consume(unsupported, sha256(unsupportedSource)).status, 'violation')
  assert.equal(consume(clear, sha256(unsupportedSource)).status, 'stale')
  const unavailable = runCheck(`${root}/missing.ts`)
  record('source-error', unavailable)
  assert.equal(unavailable.status, 'error')
  assert.equal(consume(unavailable, sha256(unsupportedSource)).success, false)
  assert.equal(consume(unavailable, sha256(unsupportedSource)).status, 'error')
})

test('expected revision is rechecked across checker read boundary', { timeout: 30000 }, () => {
  writeFileSync(file, original)
  const expected = sha256(original)
  const result = runCheck(file, expected, (...args) => {
    writeFileSync(file, '\n' + original)
    return spawnSync(...args)
  })
  record('injected-read-boundary-race', result)
  assert.equal(result.status, 'stale')
  assert.equal(result.expectedRevision, expected)
  assert.deepEqual(result.diagnostics, [])
})
