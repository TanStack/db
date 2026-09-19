#!/usr/bin/env -S node --experimental-strip-types
import { readFile } from 'node:fs/promises'
import { createEvidenceService } from './service.mjs'

const usage = `Usage: evidence [--store PATH] COMMAND [ARG]

Commands:
  init                         create an empty verified store
  status                       summarize the store
  assess JSON|@FILE|-          assess one claim
  run-endpoints JSON|@FILE|-   run the real skip-refetch check
  context JSON|@FILE|-         update dependency fingerprints
  history                      print observations and challenges
  resolve CHALLENGE REPLAY     link a causally later passing replay
`

async function jsonArgument(value) {
  if (!value) throw new Error('Missing JSON argument')
  const text =
    value === '-'
      ? await readFile(0, 'utf8')
      : value.startsWith('@')
        ? await readFile(value.slice(1), 'utf8')
        : value
  return JSON.parse(text)
}

try {
  const args = process.argv.slice(2)
  const storeIndex = args.indexOf('--store')
  let storePath = process.env.EVIDENCE_STORE ?? '.evidence/evidence.json'
  if (storeIndex !== -1) {
    if (!args[storeIndex + 1]) throw new Error('--store requires a path')
    storePath = args[storeIndex + 1]
    args.splice(storeIndex, 2)
  }
  const [command, ...rest] = args
  if (!command || command === '--help' || command === '-h') {
    console[command ? 'log' : 'error'](usage)
    process.exitCode = command ? 0 : 64
  } else {
    const service = createEvidenceService({ storePath })
    let request
    if (command === 'init' || command === 'status' || command === 'history')
      request = { operation: command }
    else if (command === 'assess')
      request = { operation: 'assess', claim: await jsonArgument(rest[0]) }
    else if (command === 'run-endpoints')
      request = {
        operation: 'runEndpoints',
        input: await jsonArgument(rest[0]),
      }
    else if (command === 'context')
      request = {
        operation: 'context',
        dependencies: await jsonArgument(rest[0]),
      }
    else if (command === 'resolve')
      request = {
        operation: 'resolve',
        challenge: Number(rest[0]),
        replay: Number(rest[1]),
      }
    else throw new Error(`Unknown command: ${command}\n${usage}`)

    console.log(JSON.stringify(await service.request(request), null, 2))
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
