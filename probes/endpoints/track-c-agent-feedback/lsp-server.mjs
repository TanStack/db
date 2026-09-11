// Minimal LSP 3.17 server: full-document sync and push diagnostics only.
import { revision } from './fixture.mjs'
let buffer = Buffer.alloc(0)
function send(message) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }))
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`)
  process.stdout.write(body)
}
function receive(message) {
  if (message.method === 'initialize') send({ id: message.id, result: { capabilities: { textDocumentSync: 1 }, serverInfo: { name: 'synthetic-endpoints-lsp', version: '0.1.0' } } })
  else if (message.method === 'shutdown') send({ id: message.id, result: null })
  else if (message.method === 'exit') process.exit(0)
  else if (['textDocument/didOpen', 'textDocument/didChange'].includes(message.method)) {
    const doc = message.params.textDocument
    const text = doc.text ?? message.params.contentChanges[0].text
    send({ method: 'textDocument/publishDiagnostics', params: { uri: doc.uri, version: doc.version, diagnostics: text.includes("'id'") ? [] : [{ range: { start: { line: 1, character: 14 }, end: { line: 1, character: text.split('\n')[1].length } }, severity: 1, code: 'ENDPOINT_ORDER_NOT_TOTAL', source: 'SYNTHETIC-endpoints', message: text.includes("'text'") ? 'TRACK_C_CHANGED_28: fixture order lacks id' : 'TRACK_C_INITIAL_17: fixture order lacks id', data: { sourceRevision: revision(text), synthetic: true } }] } })
  }
}
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk])
  while (true) {
    const split = buffer.indexOf('\r\n\r\n')
    if (split < 0) return
    const length = Number(buffer.subarray(0, split).toString().match(/Content-Length: (\d+)/i)[1])
    if (buffer.length < split + 4 + length) return
    const message = JSON.parse(buffer.subarray(split + 4, split + 4 + length))
    buffer = buffer.subarray(split + 4 + length)
    receive(message)
  }
})
