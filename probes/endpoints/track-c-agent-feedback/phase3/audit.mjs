// Checks saved native-session evidence; does not call a model.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const root = import.meta.dirname
const marker = 'C3_LSP_GATE_6d8e72a1'
const hash = value => createHash('sha256').update(value).digest('hex')
const lines = path => readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line))
const result = { scope: 'Claude Code 2.1.265; saved noninteractive native LSP trials', trials: [] }
for (const name of ['control', 'bash-enabled', 'actual']) {
  const events = lines(`${root}/traces/${name}-session.jsonl`)
  const wire = lines(`${root}/traces/${name}-wire.jsonl`)
  const init = events.find(event => event.type === 'system' && event.subtype === 'init')
  const calls = events.filter(event => event.type === 'assistant').flatMap(event => event.message.content.filter(content => content.type === 'tool_use'))
  const final = events.findLast(event => event.type === 'result')
  const publications = wire.filter(event => event.message?.method === 'textDocument/publishDiagnostics')
  assert.equal(final.is_error, false)
  assert.ok(publications.length > 0)
  assert.ok(calls.every(call => ['Read', 'Edit'].includes(call.name)))
  assert.ok(calls.some(call => call.name === 'Edit'))
  const needle = name === 'actual' ? 'ENDPOINT_ORDER_NOT_TOTAL' : marker
  assert.ok(publications.some(event => JSON.stringify(event.message).includes(needle)))
  if (name === 'control') {
    assert.equal(init.tools.includes('Bash'), false)
    assert.equal(final.result.includes(needle), false)
    assert.match(final.result, /no diagnostics received/i)
  } else {
    assert.ok(init.tools.includes('Bash'))
    assert.ok(final.result.includes(needle))
  }
  const sourceRead = events.find(event => event.type === 'user' && event.tool_use_result?.type === 'text')?.tool_use_result?.file?.content
  assert.ok(sourceRead)
  result.trials.push({ name, model: init.model, toolsAvailable: init.tools, calls: calls.map(call => ({ name: call.name, input: call.input })), promptSha256: hash(readFileSync(`${root}/${name}/prompt.txt`)), initialSourceSha256: hash(sourceRead), finalSourceSha256: hash(readFileSync(`${root}/${name}/todo.ts`)), publicationCount: publications.length, publishedStates: publications.map(event => ({ time: event.time, version: event.message.params.version, diagnostics: event.message.params.diagnostics })), final: final.result, costUSD: final.total_cost_usd })
  if (name === 'actual') {
    assert.ok(publications.some(event => event.message.params.diagnostics.length === 0))
    const checks = wire.filter(event => event.direction === 'checker-result').map(event => event.message.report)
    assert.ok(checks.some(check => check.status === 'violation'))
    assert.equal(checks.at(-1).status, 'supported')
    assert.equal(checks.at(-1).source.sha256, hash(readFileSync(`${root}/${name}/todo.ts`)))
    result.actualCheckerFinal = checks.at(-1)
  }
}
assert.equal(result.trials[0].promptSha256, result.trials[1].promptSha256)
assert.equal(result.trials[0].initialSourceSha256, result.trials[1].initialSourceSha256)
assert.equal(result.trials[0].model, result.trials[1].model)
assert.deepEqual(result.trials[1].toolsAvailable.filter(tool => tool !== 'Bash'), result.trials[0].toolsAvailable)
result.totalReportedCostUSD = result.trials.reduce((total, trial) => total + trial.costUSD, 0)
writeFileSync(`${root}/traces/audit.json`, JSON.stringify(result, null, 2))
console.log('PASS: matched tool-availability control; automatic native model receipt; real-analyzer repair and wire clear')
