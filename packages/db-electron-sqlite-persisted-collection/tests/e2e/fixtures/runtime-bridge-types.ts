import type {
  RuntimeBridgeE2EContractError,
  RuntimeBridgeE2EContractTodo,
} from '../../../../db-sqlite-persisted-collection-core/tests/contracts/runtime-bridge-e2e-contract'
import type { SQLiteCoreAdapterOptions } from '@tanstack/db-sqlite-persisted-collection-core'
import type {
  ElectronPersistenceRequestEnvelope,
  ElectronPersistenceResponseEnvelope,
} from '../../../src/protocol'

export const E2E_RESULT_PREFIX = `__TANSTACK_DB_E2E_RESULT__:`

export type ElectronRuntimeBridgeHostKind = `core-host` | `node-registry`

export type ElectronRuntimeBridgeAdapterOptions = Omit<
  SQLiteCoreAdapterOptions,
  `driver`
>

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
  | {
      type: `invokeRequest`
      request: ElectronPersistenceRequestEnvelope
    }

export type ElectronRuntimeBridgeInput = {
  dbPath: string
  collectionId: string
  hostKind?: ElectronRuntimeBridgeHostKind
  adapterOptions?: ElectronRuntimeBridgeAdapterOptions
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
  | {
      type: `invokeRequest`
      response: ElectronPersistenceResponseEnvelope
    }

export type ElectronRuntimeBridgeProcessError = {
  name: string
  message: string
  stack?: string
}

export type ElectronRuntimeBridgeProcessResult =
  | {
      ok: true
      result: ElectronRuntimeBridgeScenarioResult
    }
  | {
      ok: false
      error: ElectronRuntimeBridgeProcessError
    }
