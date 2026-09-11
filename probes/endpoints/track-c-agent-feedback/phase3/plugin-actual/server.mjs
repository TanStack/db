import { appendFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runCheck, sha256 } from '../../phase2/delivery.mjs'
const traceFile = new URL('../traces/actual-wire.jsonl', import.meta.url)
let buffer = Buffer.alloc(0)
const docs = new Map()
function trace(direction, message) { appendFileSync(traceFile, JSON.stringify({ time: new Date().toISOString(), direction, message }) + '\n') }
function send(message) {
  message = { jsonrpc: '2.0', ...message }; trace('server-to-client', message)
  const body = Buffer.from(JSON.stringify(message)); process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`); process.stdout.write(body)
}
function publish(uri, text, version) {
  docs.set(uri, { text, version })
  const report = runCheck(fileURLToPath(uri), sha256(text))
  trace('checker-result', { documentVersion: version, report })
  const diagnostics = report.status === 'supported' ? [] : report.diagnostics?.map(d => ({
    range: d.range,
    severity: report.status === 'violation' ? 1 : 2,
    code: d.code,
    source: 'endpoints-real-analyzer',
    message: `${d.code}: ${d.message}; checkStatus=${report.status}; sourceSha256=${report.source.sha256}; schemaEvidence=${JSON.stringify(report.check?.evidence ?? null)}; ${report.assumptions?.join('; ') ?? ''}`,
  })) ?? [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 2, source: 'endpoints-real-analyzer', code: report.code, message: `${report.status}: ${report.code}` }]
  // Client advertised versionSupport:false and dataSupport:false. Hash remains in message.
  send({ method: 'textDocument/publishDiagnostics', params: { uri, diagnostics } })
}
function receive(message) {
  trace('client-to-server', message)
  const p = message.params
  if (message.method === 'initialize') send({ id: message.id, result: { capabilities: { textDocumentSync: { openClose: true, change: 1, save: { includeText: true } } }, serverInfo: { name: 'real-endpoints-native-probe', version: '0.3.0' } } })
  else if (message.method === 'textDocument/didOpen') publish(p.textDocument.uri, p.textDocument.text, p.textDocument.version)
  else if (message.method === 'textDocument/didChange') publish(p.textDocument.uri, p.contentChanges[0].text, p.textDocument.version)
  else if (message.method === 'textDocument/didSave') publish(p.textDocument.uri, p.text ?? readFileSync(fileURLToPath(p.textDocument.uri), 'utf8'), docs.get(p.textDocument.uri)?.version)
  else if (message.method === 'exit') process.exit(0)
  else if (message.id !== undefined) send({ id: message.id, result: null })
}
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk])
  while (true) {
    const split = buffer.indexOf('\r\n\r\n'); if (split < 0) return
    const length = Number(buffer.subarray(0, split).toString().match(/Content-Length: (\d+)/i)[1])
    if (buffer.length < split + 4 + length) return
    const message = JSON.parse(buffer.subarray(split + 4, split + 4 + length)); buffer = buffer.subarray(split + 4 + length); receive(message)
  }
})
