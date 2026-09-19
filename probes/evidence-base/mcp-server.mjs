#!/usr/bin/env -S node --experimental-strip-types
import { pathToFileURL } from 'node:url'
import { createEvidenceService } from './service.mjs'

export const evidenceTools = [
  {
    name: 'evidence_status',
    description: 'Summarize the evidence store and its open challenges.',
    inputSchema: { type: 'object', additionalProperties: false },
  },
  {
    name: 'evidence_assess',
    description: 'Assess one exact structured claim against current evidence.',
    inputSchema: {
      type: 'object',
      required: ['claim'],
      properties: { claim: { type: 'object' } },
      additionalProperties: false,
    },
  },
  {
    name: 'evidence_run_endpoints',
    description:
      'Run the registered Endpoints safe-skip-refetch check and record its evidence.',
    inputSchema: {
      type: 'object',
      required: ['input'],
      properties: { input: { type: 'object' } },
      additionalProperties: false,
    },
  },
  {
    name: 'evidence_history',
    description: 'Return recorded observations and challenge history.',
    inputSchema: { type: 'object', additionalProperties: false },
  },
  {
    name: 'evidence_context',
    description:
      'Record current dependency fingerprints, advancing revisions for changes.',
    inputSchema: {
      type: 'object',
      required: ['dependencies'],
      properties: {
        dependencies: { type: 'array', items: { type: 'object' } },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'evidence_resolve',
    description: 'Resolve a challenge with a causally later exact replay.',
    inputSchema: {
      type: 'object',
      required: ['challenge', 'replay'],
      properties: {
        challenge: { type: 'integer' },
        replay: { type: 'integer' },
      },
      additionalProperties: false,
    },
  },
]

const operations = {
  evidence_status: () => ({ operation: 'status' }),
  evidence_assess: (input) => ({ operation: 'assess', claim: input.claim }),
  evidence_run_endpoints: (input) => ({
    operation: 'runEndpoints',
    input: input.input,
  }),
  evidence_history: () => ({ operation: 'history' }),
  evidence_context: (input) => ({
    operation: 'context',
    dependencies: input.dependencies,
  }),
  evidence_resolve: (input) => ({
    operation: 'resolve',
    challenge: input.challenge,
    replay: input.replay,
  }),
}

export function createMcpHandler(service) {
  return async ({ id, method, params }) => {
    if (method === 'initialize')
      return {
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'evidence-base', version: '1' },
        },
      }
    if (method === 'ping') return { id, result: {} }
    if (method === 'tools/list') return { id, result: { tools: evidenceTools } }
    if (method === 'tools/call') {
      const build = operations[params?.name]
      if (!build) throw new Error(`Unknown evidence tool: ${params?.name}`)
      const result = await service.request(build(params.arguments ?? {}))
      return {
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        },
      }
    }
    if (id !== undefined)
      return {
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const index = process.argv.indexOf('--store')
  const storePath =
    (index === -1 ? undefined : process.argv[index + 1]) ??
    process.env.EVIDENCE_STORE ??
    '.evidence/evidence.json'
  const service = createEvidenceService({ storePath })
  const handler = createMcpHandler(service)
  let buffer = ''
  let queue = Promise.resolve()
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buffer += chunk
    for (;;) {
      const newline = buffer.indexOf('\n')
      if (newline === -1) break
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line) continue
      queue = queue.then(async () => {
        let message
        try {
          message = JSON.parse(line)
          const response = await handler(message)
          if (response)
            process.stdout.write(
              JSON.stringify({ jsonrpc: '2.0', ...response }) + '\n',
            )
        } catch (error) {
          process.stdout.write(
            JSON.stringify({
              jsonrpc: '2.0',
              id: message?.id ?? null,
              error: {
                code: message ? -32603 : -32700,
                message: error instanceof Error ? error.message : String(error),
              },
            }) + '\n',
          )
        }
      })
    }
  })
}
