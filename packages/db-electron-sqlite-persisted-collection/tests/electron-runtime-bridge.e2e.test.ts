import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runRuntimeBridgeE2EContractSuite } from '../../db-sqlite-persisted-collection-core/tests/contracts/runtime-bridge-e2e-contract'
import { runElectronRuntimeBridgeScenario } from './e2e/electron-process-client'
import type {
  RuntimeBridgeE2EContractError,
  RuntimeBridgeE2EContractHarness,
  RuntimeBridgeE2EContractHarnessFactory,
  RuntimeBridgeE2EContractTodo,
} from '../../db-sqlite-persisted-collection-core/tests/contracts/runtime-bridge-e2e-contract'
import type {
  ElectronRuntimeBridgeInput,
  ElectronRuntimeBridgeScenarioResult,
} from './e2e/fixtures/runtime-bridge-types'

const createHarness: RuntimeBridgeE2EContractHarnessFactory = () => {
  const tempDirectory = mkdtempSync(
    join(tmpdir(), `db-electron-runtime-bridge-`),
  )
  const dbPath = join(tempDirectory, `state.sqlite`)
  const collectionId = `todos`
  let nextSequence = 1

  const runScenario = async (
    scenario: ElectronRuntimeBridgeInput[`scenario`],
  ): Promise<ElectronRuntimeBridgeScenarioResult> =>
    runElectronRuntimeBridgeScenario({
      dbPath,
      collectionId,
      timeoutMs: 4_000,
      scenario,
    })

  const harness: RuntimeBridgeE2EContractHarness = {
    writeTodoFromClient: async (todo: RuntimeBridgeE2EContractTodo) => {
      const result = await runScenario({
        type: `writeTodo`,
        todo,
        txId: `tx-${nextSequence}`,
        seq: nextSequence,
        rowVersion: nextSequence,
      })
      nextSequence++

      if (result.type !== `writeTodo`) {
        throw new Error(`Unexpected write scenario result: ${result.type}`)
      }
    },
    loadTodosFromClient: async (targetCollectionId?: string) => {
      const result = await runScenario({
        type: `loadTodos`,
        collectionId: targetCollectionId,
      })
      if (result.type !== `loadTodos`) {
        throw new Error(`Unexpected load scenario result: ${result.type}`)
      }
      return result.rows
    },
    loadUnknownCollectionErrorFromClient:
      async (): Promise<RuntimeBridgeE2EContractError> => {
        const result = await runScenario({
          type: `loadUnknownCollectionError`,
          collectionId: `missing`,
        })
        if (result.type !== `loadUnknownCollectionError`) {
          throw new Error(`Unexpected error scenario result: ${result.type}`)
        }
        return result.error
      },
    restartHost: async () => {
      const result = await runScenario({
        type: `noop`,
      })
      if (result.type !== `noop`) {
        throw new Error(`Unexpected restart scenario result: ${result.type}`)
      }
    },
    cleanup: () => {
      rmSync(tempDirectory, { recursive: true, force: true })
    },
  }

  return harness
}

runRuntimeBridgeE2EContractSuite(
  `electron runtime bridge e2e (real main/renderer IPC)`,
  createHarness,
  {
    testTimeoutMs: 45_000,
  },
)
