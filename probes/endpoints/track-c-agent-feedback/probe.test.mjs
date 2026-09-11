import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { fixtureText, revision } from './fixture.mjs'
import { pathToFileURL } from 'node:url'
const root = import.meta.dirname
mkdirSync(`${root}/traces`, { recursive: true })
const file = `${root}/traces/todo.fixture.ts`
const trace = []
const save = () => writeFileSync(`${root}/traces/protocol.json`, JSON.stringify(trace, null, 2))
function record(path, value) { trace.push({ path, ...value }); save() }
test('CLI returns changed then cleared full report, stale and execution-error distinctions', () => {
  for (const [i, mode] of ['initial', 'changed', 'clear'].entries()) {
    writeFileSync(file, fixtureText(mode))
    const run = spawnSync(process.execPath, ['cli.mjs', file, String(i + 1)], { cwd: root, encoding: 'utf8' })
    const result = JSON.parse(run.stdout)
    record('CLI', { mode, exit: run.status, result })
    assert.equal(run.status, mode === 'clear' ? 0 : 1)
    assert.equal(result.source.revision, revision(fixtureText(mode)))
    assert.equal(result.findings.length, mode === 'clear' ? 0 : 1)
    if (mode !== 'clear') assert.equal(result.findings[0].marker, mode === 'initial' ? 'TRACK_C_INITIAL_17' : 'TRACK_C_CHANGED_28')
  }
  const stale = spawnSync(process.execPath, ['cli.mjs', file, '3', revision(fixtureText('initial'))], { cwd: root, encoding: 'utf8' })
  assert.equal(stale.status, 3)
  record('CLI', { mode: 'stale', exit: stale.status, result: JSON.parse(stale.stdout) })
  const error = spawnSync(process.execPath, ['cli.mjs', `${root}/missing`], { cwd: root, encoding: 'utf8' })
  assert.equal(error.status, 2)
  record('CLI', { mode: 'execution-error', exit: error.status, result: JSON.parse(error.stderr) })
})
test('MCP stdio initialize, discover, request changed/clear/stale and distinguish domain failure', { timeout: 10000 }, async () => {
  const child = spawn(process.execPath, ['mcp-server.mjs'], { cwd: root })
  const lines = createInterface({ input: child.stdout })
  const iterator = lines[Symbol.asyncIterator]()
  let id = 0
  async function request(method, params = {}) {
    const sent = { jsonrpc: '2.0', id: ++id, method, params }
    child.stdin.write(`${JSON.stringify(sent)}\n`)
    const received = JSON.parse((await iterator.next()).value)
    record('MCP-stdio-fixture-client', { sent, received })
    return received
  }
  try {
    assert.equal((await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture-test', version: '0.1.0' } })).result.protocolVersion, '2025-06-18')
    child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
    assert.equal((await request('tools/list')).result.tools.length, 1)
    for (const [i, mode] of ['initial', 'changed', 'clear'].entries()) {
      writeFileSync(file, fixtureText(mode))
      const response = await request('tools/call', { name: 'check_endpoint_fixture', arguments: { file, version: i + 1 } })
      assert.equal(response.result.isError, false)
      const report = response.result.structuredContent
      assert.deepEqual(report, JSON.parse(response.result.content[0].text))
      assert.equal(report.source.revision, revision(fixtureText(mode)))
      assert.equal(report.status, mode === 'clear' ? 'pass' : 'fail')
    }
    const stale = await request('tools/call', { name: 'check_endpoint_fixture', arguments: { file, version: 3, expectedRevision: revision(fixtureText('initial')) } })
    assert.equal(stale.result.structuredContent.status, 'stale')
    const error = await request('tools/call', { name: 'check_endpoint_fixture', arguments: { file: `${root}/missing` } })
    assert.equal(error.result.isError, true)
  } finally { child.kill(); lines.close() }
})
test('LSP wire publishes versioned replacement and clears; fixture consumer rejects stale publish', { timeout: 10000 }, async () => {
  const child = spawn(process.execPath, ['lsp-server.mjs'], { cwd: root })
  let buffer = Buffer.alloc(0)
  const messages = [], waiters = []
  child.stdout.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk])
    while (true) {
      const split = buffer.indexOf('\r\n\r\n')
      if (split < 0) return
      const length = Number(buffer.subarray(0, split).toString().match(/Content-Length: (\d+)/)[1])
      if (buffer.length < split + 4 + length) return
      const message = JSON.parse(buffer.subarray(split + 4, split + 4 + length))
      buffer = buffer.subarray(split + 4 + length)
      if (waiters.length) waiters.shift()(message); else messages.push(message)
    }
  })
  const next = () => messages.length ? Promise.resolve(messages.shift()) : new Promise(resolve => waiters.push(resolve))
  function send(message) {
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }))
    child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`); child.stdin.write(body)
  }
  let displayed = [], currentVersion = 0
  function consume(params) {
    if (params.version < currentVersion) return false
    currentVersion = params.version; displayed = params.diagnostics; return true
  }
  try {
    send({ id: 1, method: 'initialize', params: { processId: null, rootUri: pathToFileURL(root).href, capabilities: { textDocument: { publishDiagnostics: { versionSupport: true } } } } })
    assert.equal((await next()).result.capabilities.textDocumentSync, 1)
    send({ method: 'initialized', params: {} })
    let first
    for (const [i, mode] of ['initial', 'changed', 'clear'].entries()) {
      const text = fixtureText(mode), version = i + 1, uri = pathToFileURL(file).href
      send({ method: i ? 'textDocument/didChange' : 'textDocument/didOpen', params: i ? { textDocument: { uri, version }, contentChanges: [{ text }] } : { textDocument: { uri, version, languageId: 'typescript', text } } })
      const received = await next()
      record('LSP-wire-fixture-client', { mode, received })
      assert.equal(received.params.version, version)
      assert.equal(consume(received.params), true)
      assert.equal(displayed.length, mode === 'clear' ? 0 : 1)
      if (i === 0) first = received.params
    }
    assert.equal(consume(first), false)
    assert.equal(displayed.length, 0)
    record('LSP-fixture-consumer-only', { mode: 'late-v1-after-clear-v3', accepted: false, displayed })
  } finally { child.kill() }
})
test('rerun from a caller outside the probe executes the returned command and cwd', () => {
  const caller = pathToFileURL(root).pathname.split('/probes/')[0]
  const relative = 'probes/endpoints/track-c-agent-feedback/root-receipt.fixture.ts'
  const initial = spawnSync(process.execPath, ['probes/endpoints/track-c-agent-feedback/cli.mjs', relative], { cwd: caller, encoding: 'utf8' })
  const report = JSON.parse(initial.stdout)
  const rerun = spawnSync(report.rerun.command, report.rerun.args, { cwd: report.rerun.cwd, encoding: 'utf8' })
  record('CLI-exact-rerun', { initialExit: initial.status, rerunExit: rerun.status, stderr: rerun.stderr })
  assert.equal(rerun.status, initial.status)
  assert.equal(JSON.parse(rerun.stdout).source.revision, report.source.revision)
})
