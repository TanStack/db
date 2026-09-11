// Minimal MCP 2025-06-18 stdio fixture, not a product host integration.
import { createInterface } from 'node:readline'
import { check } from './fixture.mjs'
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line)
  if (request.id === undefined) continue
  let result
  if (request.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'synthetic-endpoints', version: '0.1.0' } }
  else if (request.method === 'tools/list') result = { tools: [{ name: 'check_endpoint_fixture', description: 'Check SYNTHETIC delivery fixture; no Drizzle analysis', inputSchema: { type: 'object', properties: { file: { type: 'string' }, version: { type: 'integer' }, expectedRevision: { type: 'string' } }, required: ['file'] } }] }
  else if (request.method === 'tools/call' && request.params.name === 'check_endpoint_fixture') {
    try {
      const { file, version, expectedRevision } = request.params.arguments
      const report = check(file, version, expectedRevision)
      result = { content: [{ type: 'text', text: JSON.stringify(report) }], structuredContent: report, isError: false }
    } catch (error) { result = { content: [{ type: 'text', text: error.message }], isError: true } }
  } else {
    console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } }))
    continue
  }
  console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }))
}
