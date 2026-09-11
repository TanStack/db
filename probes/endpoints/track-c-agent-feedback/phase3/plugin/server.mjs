import { appendFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const trial = process.env.TRACK_C_TRIAL
if (!['control', 'bash-enabled', 'next-request', 'lifecycle'].includes(trial)) throw new Error('explicit trial required')
const traceFile = new URL(`../traces/${trial}-wire.jsonl`, import.meta.url)
const marker = 'C3_LSP_GATE_6d8e72a1'
let buffer = Buffer.alloc(0)
const docs = new Map()
function trace(direction, message) { appendFileSync(traceFile, JSON.stringify({ time: new Date().toISOString(), direction, message }) + '\n') }
function send(message) {
  message = { jsonrpc: '2.0', ...message }; trace('server-to-client', message)
  const body = Buffer.from(JSON.stringify(message)); process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`); process.stdout.write(body)
}
function publish(uri, text, version) {
  docs.set(uri, { text, version })
  const sourceLines = text.split('\n')
  const line = sourceLines.findIndex(line => line.includes('const order'))
  const sha256 = createHash('sha256').update(text).digest('hex')
  send({ method: 'textDocument/publishDiagnostics', params: { uri, version, diagnostics: text.includes("'id'") ? [] : [{ range: { start: { line, character: 14 }, end: { line, character: sourceLines[line].length } }, severity: 1, code: 'ENDPOINT_ORDER_NOT_TOTAL', source: 'synthetic-endpoints-native-probe', message: `${marker}: Synthetic fixture order lacks an id tie-breaker. This is not database analysis. Source revision ${sha256}`, data: { sha256, synthetic: true } }] } })
}
function receive(message) {
  trace('client-to-server', message)
  const p = message.params
  if (message.method === 'initialize') send({ id: message.id, result: { capabilities: { textDocumentSync: { openClose: true, change: 1, save: { includeText: true } } }, serverInfo: { name: 'synthetic-endpoints-native-probe', version: '0.3.0' } } })
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
