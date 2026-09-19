#!/usr/bin/env -S node --experimental-strip-types
import { createEvidenceService } from './service.mjs'
import { pathToFileURL } from 'node:url'

export async function diagnosticsFor(text, service) {
  try {
    const document = JSON.parse(text)
    if (!document?.claim) throw new Error('Expected an object containing claim')
    const assessment = await service.request({
      operation: 'assess',
      claim: document.claim,
    })
    if (assessment.status === 'supported') return []
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: Math.max(1, text.split('\n')[0].length) },
        },
        severity: assessment.status === 'contradicted' ? 1 : 2,
        source: 'evidence-base',
        code: assessment.status,
        message:
          assessment.reasons.join('; ') ||
          `Claim is ${assessment.status}; inspect structured routes`,
        data: assessment,
      },
    ]
  } catch (error) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        source: 'evidence-base',
        code: 'invalid-evidence-document',
        message: error instanceof Error ? error.message : String(error),
      },
    ]
  }
}

export function createLspHandler(service, notify) {
  const documents = new Map()
  let shutdown = false
  const publish = async (uri, text) =>
    notify('textDocument/publishDiagnostics', {
      uri,
      diagnostics: await diagnosticsFor(text, service),
    })

  return async (message) => {
    const { id, method, params } = message
    if (method === 'initialize')
      return {
        id,
        result: {
          capabilities: {
            textDocumentSync: 1,
            codeActionProvider: true,
            executeCommandProvider: { commands: ['evidence.request'] },
          },
          serverInfo: { name: 'evidence-base', version: '1' },
        },
      }
    if (method === 'shutdown') {
      shutdown = true
      return { id, result: null }
    }
    if (method === 'exit') {
      process.exit(shutdown ? 0 : 1)
    }
    if (method === 'textDocument/didOpen') {
      const { uri, text } = params.textDocument
      documents.set(uri, text)
      await publish(uri, text)
      return
    }
    if (method === 'textDocument/didChange') {
      const uri = params.textDocument.uri
      const text =
        params.contentChanges.at(-1)?.text ?? documents.get(uri) ?? ''
      documents.set(uri, text)
      await publish(uri, text)
      return
    }
    if (method === 'textDocument/didClose') {
      const uri = params.textDocument.uri
      documents.delete(uri)
      notify('textDocument/publishDiagnostics', { uri, diagnostics: [] })
      return
    }
    if (method === 'textDocument/codeAction') {
      const text = documents.get(params.textDocument.uri)
      if (!text) return { id, result: [] }
      const document = JSON.parse(text)
      return {
        id,
        result: [
          {
            title: 'Reassess evidence claim',
            kind: 'quickfix',
            command: {
              title: 'Reassess evidence claim',
              command: 'evidence.request',
              arguments: [{ operation: 'assess', claim: document.claim }],
            },
          },
        ],
      }
    }
    if (method === 'workspace/executeCommand') {
      if (params.command !== 'evidence.request')
        throw new Error(`Unknown command: ${params.command}`)
      return { id, result: await service.request(params.arguments?.[0] ?? {}) }
    }
    if (method === 'evidence/request')
      return { id, result: await service.request(params) }
    if (id !== undefined)
      return {
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      }
  }
}

function send(message) {
  const json = JSON.stringify({ jsonrpc: '2.0', ...message })
  process.stdout.write(
    `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`,
  )
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
  const handler = createLspHandler(service, (method, params) =>
    send({ method, params }),
  )
  let buffer = Buffer.alloc(0)
  let queue = Promise.resolve()

  const enqueue = (payload) => {
    queue = queue.then(async () => {
      let message
      try {
        message = JSON.parse(payload)
        const response = await handler(message)
        if (response) send(response)
      } catch (error) {
        send({
          id: message?.id ?? null,
          error: {
            code: message ? -32603 : -32700,
            message: error instanceof Error ? error.message : String(error),
          },
        })
      }
    })
  }

  process.stdin.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    for (;;) {
      const boundary = buffer.indexOf('\r\n\r\n')
      if (boundary === -1) return
      const header = buffer.subarray(0, boundary).toString('ascii')
      const match = /(?:^|\r\n)Content-Length: (\d+)/i.exec(header)
      if (!match) {
        buffer = Buffer.alloc(0)
        send({
          id: null,
          error: { code: -32600, message: 'Missing Content-Length' },
        })
        return
      }
      const length = Number(match[1])
      const start = boundary + 4
      if (buffer.length < start + length) return
      const payload = buffer.subarray(start, start + length).toString()
      buffer = buffer.subarray(start + length)
      enqueue(payload)
    }
  })
}
