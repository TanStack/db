import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { endpointsRules } from './endpoints.ts'
import {
  endpointsEvidenceRules,
  runEndpointsSkipCheck,
} from './endpoints-real.mjs'
import { loadStore, saveStore } from './storage.mjs'

export const PACKAGE_ID = 'endpoints-evidence@1'
export const allRules = [...endpointsRules, ...endpointsEvidenceRules]

const here = fileURLToPath(new URL('.', import.meta.url))

async function fileDependency(path, name) {
  const bytes = await readFile(path)
  return {
    kind: 'code',
    name,
    fingerprint: createHash('sha256').update(bytes).digest('hex'),
  }
}

async function implementationDependencies() {
  return Promise.all([
    fileDependency(
      resolve(here, '../endpoints/integrated-todo/effect-verdict.mjs'),
      'endpoints/effect-verdict.mjs',
    ),
    fileDependency(
      resolve(here, 'endpoints-real.mjs'),
      'evidence/endpoints-real.mjs',
    ),
  ])
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`)
  return value
}

export function createEvidenceService({ storePath }) {
  if (!storePath) throw new Error('Evidence service requires a store path')
  let queue = Promise.resolve()

  const dispatch = async (request) => {
    requireObject(request, 'request')
    const operation = request.operation
    if (typeof operation !== 'string') throw new Error('Missing operation')
    const base = await loadStore(storePath, allRules, {
      package: PACKAGE_ID,
      create: true,
    })

    if (operation === 'init') {
      await saveStore(storePath, base, PACKAGE_ID)
      return {
        package: PACKAGE_ID,
        storePath: resolve(storePath),
        created: true,
      }
    }
    if (operation === 'status') {
      const state = base.exportState()
      const history = base.history()
      return {
        package: PACKAGE_ID,
        storePath: resolve(storePath),
        observations: state.observations.length,
        challenges: state.challenges.length,
        openChallenges: state.challenges.filter((challenge) => {
          const failed = history.observations.find(
            (observation) => observation.id === challenge.observation,
          )
          return (
            failed !== undefined &&
            base.assess(failed.claim).challenges.includes(challenge.id)
          )
        }).length,
        arguments: state.arguments.length,
        dependencies: base.currentDependencies(),
      }
    }
    if (operation === 'assess')
      return base.assess(requireObject(request.claim, 'claim'))
    if (operation === 'history') return base.history()

    if (operation === 'context') {
      if (!Array.isArray(request.dependencies))
        throw new Error('context requires dependencies')
      const dependencies = base.updateDependencies(request.dependencies)
      await saveStore(storePath, base, PACKAGE_ID)
      return { dependencies }
    }

    if (operation === 'runEndpoints') {
      const input = requireObject(request.input, 'input')
      const result = await runEndpointsSkipCheck(
        base,
        input,
        await implementationDependencies(),
      )
      await saveStore(storePath, base, PACKAGE_ID)
      return result
    }

    if (operation === 'resolve') {
      if (
        !Number.isSafeInteger(request.challenge) ||
        !Number.isSafeInteger(request.replay)
      )
        throw new Error('resolve requires integer challenge and replay IDs')
      base.resolve(request.challenge, request.replay)
      await saveStore(storePath, base, PACKAGE_ID)
      return { challenge: request.challenge, replay: request.replay }
    }

    throw new Error(`Unknown evidence operation: ${operation}`)
  }

  return {
    request(value) {
      const result = queue.then(() => dispatch(value))
      queue = result.catch(() => undefined)
      return result
    },
  }
}
