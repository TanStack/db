import { contextBridge, ipcRenderer } from 'electron'
import {
  createElectronPersistenceInvoke,
  createElectronRendererPersistenceAdapter,
} from '../../../src/renderer'
import type {
  ElectronRuntimeBridgeInput,
  ElectronRuntimeBridgeScenarioResult,
} from './runtime-bridge-types'

async function runScenario(
  input: Pick<
    ElectronRuntimeBridgeInput,
    `collectionId` | `channel` | `timeoutMs` | `scenario`
  >,
): Promise<ElectronRuntimeBridgeScenarioResult> {
  const adapter = createElectronRendererPersistenceAdapter<
    Record<string, unknown>,
    string
  >({
    invoke: createElectronPersistenceInvoke(ipcRenderer),
    channel: input.channel,
    timeoutMs: input.timeoutMs,
  })

  const scenario = input.scenario
  switch (scenario.type) {
    case `noop`:
      return { type: `noop` }

    case `writeTodo`: {
      await adapter.applyCommittedTx(input.collectionId, {
        txId: scenario.txId,
        term: 1,
        seq: scenario.seq,
        rowVersion: scenario.rowVersion,
        mutations: [
          {
            type: `insert`,
            key: scenario.todo.id,
            value: scenario.todo,
          },
        ],
      })

      return { type: `writeTodo` }
    }

    case `loadTodos`: {
      const rows = await adapter.loadSubset(
        scenario.collectionId ?? input.collectionId,
        {},
      )
      return {
        type: `loadTodos`,
        rows: rows.map((row) => ({
          key: String(row.key),
          value: {
            id: String((row.value as { id?: unknown }).id ?? ``),
            title: String((row.value as { title?: unknown }).title ?? ``),
            score: Number((row.value as { score?: unknown }).score ?? 0),
          },
        })),
      }
    }

    case `loadUnknownCollectionError`: {
      try {
        await adapter.loadSubset(scenario.collectionId, {})
        return {
          type: `loadUnknownCollectionError`,
          error: {
            name: `Error`,
            message: `Expected unknown collection error but operation succeeded`,
          },
        }
      } catch (error) {
        if (error instanceof Error) {
          const code =
            `code` in error && typeof error.code === `string`
              ? error.code
              : undefined

          return {
            type: `loadUnknownCollectionError`,
            error: {
              name: error.name,
              message: error.message,
              code,
            },
          }
        }

        return {
          type: `loadUnknownCollectionError`,
          error: {
            name: `Error`,
            message: `Unknown error type`,
          },
        }
      }
    }

    default: {
      const unsupportedScenario: never = scenario
      throw new Error(
        `Unsupported electron bridge scenario: ${JSON.stringify(unsupportedScenario)}`,
      )
    }
  }
}

type RuntimeBridgePreloadApi = {
  runScenario: (
    input: Pick<
      ElectronRuntimeBridgeInput,
      `collectionId` | `channel` | `timeoutMs` | `scenario`
    >,
  ) => Promise<ElectronRuntimeBridgeScenarioResult>
}

const runtimeBridgePreloadApi: RuntimeBridgePreloadApi = {
  runScenario,
}

contextBridge.exposeInMainWorld(`__tanstackDbRuntimeBridge__`, runtimeBridgePreloadApi)

declare global {
  interface Window {
    __tanstackDbRuntimeBridge__: RuntimeBridgePreloadApi
  }
}
