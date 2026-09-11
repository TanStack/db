// Bounded MCP stdio server around Track A's actual analyzer, not a host-wide install.
import { createInterface } from 'node:readline'
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runCheck } from './delivery.mjs'
const mode = process.env.ENDPOINTS_PROBE_MODE === 'states' ? 'states' : 'agent'
const file = resolve(import.meta.dirname, `${mode}/todo.ts`)
const trace = message => appendFileSync(new URL(mode === 'states' ? './traces/mcp-states-wire.jsonl' : './traces/mcp-real-wire.jsonl', import.meta.url), JSON.stringify({ time: new Date().toISOString(), ...message }) + '\n')
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line); trace({ direction: 'host-to-server', request })
  if (request.id === undefined) continue
  let result
  if (request.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'track-a-endpoint-check', version: '0.2.0' } }
  else if (request.method === 'tools/list') result = { tools: [{ name: 'check_endpoint', description: 'Run the actual bounded Drizzle/PostgreSQL analyzer on this task’s todo.ts. Returns complete current rule status, source hash/location, supported schema evidence, suggested source edit, and exact rerun. A not checked result is not success.', inputSchema: { type: 'object', properties: { expectedRevision: { type: 'string', description: 'Optional source hash from a prior check; refuse stale requests.' } }, additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } }] }
  else if (request.method === 'tools/call' && request.params.name === 'check_endpoint') {
    const report = runCheck(file, request.params.arguments?.expectedRevision)
    result = { content: [{ type: 'text', text: JSON.stringify(report) }], structuredContent: report, isError: report.status === 'error' }
  } else { const response = { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } }; trace({ direction: 'server-to-host', response }); console.log(JSON.stringify(response)); continue }
  const response = { jsonrpc: '2.0', id: request.id, result }; trace({ direction: 'server-to-host', response }); console.log(JSON.stringify(response))
}
