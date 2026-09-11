// Audits recorded trials. It does not rerun model calls or claim hidden-context visibility.
import { readFileSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const root = import.meta.dirname
const readLines = file => readFileSync(`${root}/traces/${file}`, 'utf8').trim().split('\n').map(line => JSON.parse(line))
const summary = { nativeLsp: [], nativeMcp: [] }
for (const [session, wire, needle] of [
  ['claude-native-session.jsonl', 'claude-first-edit-lsp-wire.jsonl', 'C2_NATIVE_LSP_4c671efb'],
  ['claude-delayed-session.jsonl', 'claude-delayed-lsp-wire.jsonl', 'C2_NATIVE_LSP_4c671efb'],
  ['claude-actual-lsp-session.jsonl', 'claude-actual-lsp-wire.jsonl', 'ENDPOINT_ORDER_NOT_TOTAL'],
]) {
  const messages = readLines(session), protocol = readLines(wire)
  const toolNames = messages.filter(m => m.type === 'assistant').flatMap(m => m.message.content.filter(c => c.type === 'tool_use').map(c => c.name))
  assert.ok(toolNames.includes('Edit'))
  assert.ok(toolNames.every(name => ['Read', 'Edit'].includes(name)))
  const published = protocol.filter(e => e.message?.method === 'textDocument/publishDiagnostics')
  assert.ok(published.length > 0)
  assert.ok(published.some(e => JSON.stringify(e).includes(needle)))
  const final = messages.findLast(m => m.type === 'result')
  assert.equal(final.is_error, false)
  assert.match(final.result, /no diagnostics received/i)
  const visibleContext = messages.filter(m => m.type === 'assistant' || m.type === 'user')
  assert.equal(JSON.stringify(visibleContext).includes(needle), false)
  const init = protocol.find(e => e.message?.method === 'initialize')
  summary.nativeLsp.push({ session, wire, result: 'diagnostic receipt not observed', published: published.length, toolNames, clientCapabilities: init.message.params.capabilities.textDocument.publishDiagnostics, model: messages.find(m => m.type === 'system' && m.subtype === 'init')?.model, final: final.result, costUSD: final.total_cost_usd, limits: 'Wire publication observed; marker absent in visible model/tool transcript and model reports none. Stream output does not expose every hidden model-context detail. No product-wide absence claim; no idle-wakeup trial.' })
}
for (const [session, wire, expected] of [
  ['claude-real-mcp-session.jsonl', 'mcp-real-wire.jsonl', ['violation', 'supported']],
  ['claude-mcp-states-session.jsonl', 'mcp-states-wire.jsonl', ['stale', 'not checked']],
]) {
  const messages = readLines(session), protocol = readLines(wire)
  const responses = protocol.filter(e => e.response?.result?.structuredContent).map(e => e.response.result.structuredContent)
  assert.deepEqual(responses.map(r => r.status), expected)
  const tools = messages.filter(m => m.type === 'assistant').flatMap(m => m.message.content.filter(c => c.type === 'tool_use').map(c => c.name))
  assert.equal(tools.filter(name => name === 'mcp__endpoint__check_endpoint').length, 2)
  const final = messages.findLast(m => m.type === 'result')
  assert.equal(final.is_error, false)
  if (expected[0] === 'violation') {
    assert.ok(tools.includes('Edit'))
    assert.match(final.result, /ENDPOINT_ORDER_NOT_TOTAL/)
    assert.ok(final.result.includes(responses[0].source.sha256))
    assert.ok(final.result.includes(responses[1].source.sha256))
    assert.ok(responses[0].check.evidence.keyIndex)
  } else {
    assert.ok(tools.every(name => name === 'mcp__endpoint__check_endpoint'))
    assert.match(final.result, /stale/i)
    assert.match(final.result, /not checked/i)
  }
  summary.nativeMcp.push({ session, wire, result: 'observed agent request and status comprehension', tools, states: responses.map(r => ({ status: r.status, source: r.source, diagnostics: r.diagnostics, evidence: r.check?.evidence })), model: messages.find(m => m.type === 'system' && m.subtype === 'init')?.model, final: final.result, costUSD: final.total_cost_usd })
}
writeFileSync(`${root}/traces/observation-audit.json`, JSON.stringify(summary, null, 2))
console.log('PASS: 3 native LSP negative observations and 2 native MCP positive observations audited')
