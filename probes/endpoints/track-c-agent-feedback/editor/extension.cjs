// Disposable LSP-to-VS Code bridge, not a coding-agent integration.
const vscode = require('vscode')
const { spawn } = require('node:child_process')
const { writeFileSync } = require('node:fs')
const path = require('node:path')
exports.activate = async function(context) {
  const root = path.dirname(context.extensionPath)
  const trace = []
  const save = () => writeFileSync(path.join(root, 'traces/editor.json'), JSON.stringify(trace, null, 2))
  const collection = vscode.languages.createDiagnosticCollection('SYNTHETIC-endpoints')
  context.subscriptions.push(collection)
  const child = spawn('/usr/local/bin/node', [path.join(root, 'lsp-server.mjs')])
  context.subscriptions.push({ dispose: () => child.kill() })
  let buffer = Buffer.alloc(0)
  const pending = []
  child.stdout.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk])
    while (true) {
      const split = buffer.indexOf('\r\n\r\n')
      if (split < 0) return
      const length = Number(buffer.subarray(0, split).toString().match(/Content-Length: (\d+)/)[1])
      if (buffer.length < split + 4 + length) return
      const msg = JSON.parse(buffer.subarray(split + 4, split + 4 + length))
      buffer = buffer.subarray(split + 4 + length)
      if (msg.method === 'textDocument/publishDiagnostics') {
        collection.set(vscode.Uri.parse(msg.params.uri), msg.params.diagnostics.map(d => {
          const diagnostic = new vscode.Diagnostic(new vscode.Range(d.range.start.line, d.range.start.character, d.range.end.line, d.range.end.character), d.message, vscode.DiagnosticSeverity.Error)
          diagnostic.code = d.code; diagnostic.source = d.source; return diagnostic
        }))
      }
      pending.shift()?.(msg)
    }
  })
  function exchange(message) {
    return new Promise(resolve => {
      pending.push(resolve)
      const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }))
      child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`); child.stdin.write(body)
    })
  }
  try {
    const uri = vscode.Uri.file(path.join(root, 'traces/todo.fixture.ts'))
    const doc = await vscode.workspace.openTextDocument(uri)
    await vscode.window.showTextDocument(doc)
    trace.push({ editor: vscode.version, extension: '0.1.0', surface: 'VS Code DiagnosticCollection through disposable custom LSP bridge' })
    await exchange({ id: 1, method: 'initialize', params: { processId: process.pid, rootUri: vscode.Uri.file(root).toString(), capabilities: { textDocument: { publishDiagnostics: { versionSupport: true } } } } })
    const { fixtureText } = await import(path.join(root, 'fixture.mjs'))
    for (const [index, mode] of ['initial', 'changed', 'clear'].entries()) {
      const text = fixtureText(mode), version = index + 1
      const response = await exchange({ method: index ? 'textDocument/didChange' : 'textDocument/didOpen', params: index ? { textDocument: { uri: uri.toString(), version }, contentChanges: [{ text }] } : { textDocument: { uri: uri.toString(), version, languageId: 'typescript', text } } })
      const diagnostics = vscode.languages.getDiagnostics(uri).filter(d => d.source === 'SYNTHETIC-endpoints').map(d => ({ code: d.code, message: d.message, source: d.source, range: d.range }))
      trace.push({ mode, published: response.params, editorDiagnostics: diagnostics, passed: diagnostics.length === (mode === 'clear' ? 0 : 1) && (mode === 'clear' || diagnostics[0].message.includes(mode === 'initial' ? 'TRACK_C_INITIAL_17' : 'TRACK_C_CHANGED_28')) })
      save()
    }
  } catch(error) { trace.push({ error: String(error) }); save() }
  finally { child.kill(); collection.dispose(); await vscode.commands.executeCommand('workbench.action.closeWindow') }
}
