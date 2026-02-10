import type {
  RuntimeBridgeE2EContractError,
  RuntimeBridgeE2EContractTodo,
} from '../../../../db-sqlite-persisted-collection-core/tests/contracts/runtime-bridge-e2e-contract'

export const E2E_RESULT_PREFIX = `__TANSTACK_DB_E2E_RESULT__:`

export type ElectronRuntimeBridgeScenario =
  | {
      type: `noop`
    }
  | {
      type: `writeTodo`
      todo: RuntimeBridgeE2EContractTodo
      txId: string
      seq: number
      rowVersion: number
    }
  | {
      type: `loadTodos`
      collectionId?: string
    }
  | {
      type: `loadUnknownCollectionError`
      collectionId: string
    }

export type ElectronRuntimeBridgeInput = {
  dbPath: string
  collectionId: string
  channel?: string
  timeoutMs?: number
  scenario: ElectronRuntimeBridgeScenario
}

export type ElectronRuntimeBridgeScenarioResult =
  | {
      type: `noop`
    }
  | {
      type: `writeTodo`
    }
  | {
      type: `loadTodos`
      rows: Array<{
        key: string
        value: RuntimeBridgeE2EContractTodo
      }>
    }
  | {
      type: `loadUnknownCollectionError`
      error: RuntimeBridgeE2EContractError
    }

export type ElectronRuntimeBridgeProcessResult =
  | {
      ok: true
      result: ElectronRuntimeBridgeScenarioResult
    }
  | {
      ok: false
      error: {
        name: string
        message: string
        stack?: string
      }
    }
