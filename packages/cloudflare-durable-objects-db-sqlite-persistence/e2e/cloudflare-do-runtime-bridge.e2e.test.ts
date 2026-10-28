import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runRuntimeBridgeE2EContractSuite } from '../../db-sqlite-persistence-core/tests/contracts/runtime-bridge-e2e-contract'
import { postJson, startWranglerRuntime } from './fixtures/wrangler-runtime'
import type {
  RuntimeBridgeE2EContractError,
  RuntimeBridgeE2EContractHarness,
  RuntimeBridgeE2EContractHarnessFactory,
  RuntimeBridgeE2EContractTodo,
} from '../../db-sqlite-persistence-core/tests/contracts/runtime-bridge-e2e-contract'
import type { WranglerRuntimeResponse } from './fixtures/wrangler-runtime'

function assertRuntimeError(
  response: WranglerRuntimeResponse<unknown>,
): RuntimeBridgeE2EContractError {
  if (!response.ok) {
    return response.error
  }

  throw new Error(`Expected runtime call to fail, but it succeeded`)
}

function assertRuntimeSuccess<TPayload>(
  response: WranglerRuntimeResponse<TPayload>,
): TPayload | undefined {
  if (response.ok) {
    return response.rows
  }

  throw new Error(`${response.error.name}: ${response.error.message}`)
}

const createHarness: RuntimeBridgeE2EContractHarnessFactory = () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-cloudflare-do-e2e-`))
  const persistPath = join(tempDirectory, `wrangler-state`)
  const collectionId = `todos`
  let nextSequence = 1
  const runtimePromise = startWranglerRuntime({
    persistPath,
  })

  const harness: RuntimeBridgeE2EContractHarness = {
    writeTodoFromClient: async (todo: RuntimeBridgeE2EContractTodo) => {
      const runtime = await runtimePromise
      const result = await postJson<void>(runtime, `/write-todo`, {
        collectionId,
        todo,
        txId: `tx-${nextSequence}`,
        seq: nextSequence,
        rowVersion: nextSequence,
      })
      nextSequence++

      if (!result.ok) {
        throw new Error(`${result.error.name}: ${result.error.message}`)
      }
    },
    loadTodosFromClient: async (targetCollectionId?: string) => {
      const runtime = await runtimePromise
      const result = await postJson<
        Array<{ key: string; value: RuntimeBridgeE2EContractTodo }>
      >(runtime, `/load-todos`, {
        collectionId: targetCollectionId ?? collectionId,
      })
      if (!result.ok) {
        throw new Error(`${result.error.name}: ${result.error.message}`)
      }
      return result.rows ?? []
    },
    loadUnknownCollectionErrorFromClient:
      async (): Promise<RuntimeBridgeE2EContractError> => {
        const runtime = await runtimePromise
        const result = await postJson<never>(
          runtime,
          `/load-unknown-collection-error`,
          {
            collectionId: `missing`,
          },
        )
        if (result.ok) {
          throw new Error(
            `Expected unknown collection request to fail, but it succeeded`,
          )
        }
        return result.error
      },
    restartHost: async () => {
      const runtime = await runtimePromise
      await runtime.restart()
    },
    cleanup: async () => {
      try {
        const runtime = await runtimePromise
        await runtime.stop()
      } finally {
        rmSync(tempDirectory, { recursive: true, force: true })
      }
    },
  }

  return harness
}

runRuntimeBridgeE2EContractSuite(
  `cloudflare durable object runtime bridge e2e (wrangler local)`,
  createHarness,
  {
    testTimeoutMs: 90_000,
  },
)

describe(`cloudflare durable object schema mismatch behavior (wrangler local)`, () => {
  it(`throws on schema mismatch in sync-absent mode`, async () => {
    const tempDirectory = mkdtempSync(
      join(tmpdir(), `db-cloudflare-do-local-mismatch-e2e-`),
    )
    const persistPath = join(tempDirectory, `wrangler-state`)
    const collectionId = `todos`
    let runtime = await startWranglerRuntime({
      persistPath,
      syncEnabled: false,
      schemaVersion: 1,
      collectionId,
    })

    try {
      const writeResult = await postJson<void>(runtime, `/write-todo`, {
        collectionId,
        txId: `tx-1`,
        seq: 1,
        rowVersion: 1,
        todo: {
          id: `local-1`,
          title: `Local mode row`,
          score: 10,
        },
      })
      assertRuntimeSuccess(writeResult)
    } finally {
      await runtime.stop()
    }

    runtime = await startWranglerRuntime({
      persistPath,
      syncEnabled: false,
      schemaVersion: 2,
      collectionId,
    })
    try {
      const loadResult = await postJson<
        Array<{ key: string; value: RuntimeBridgeE2EContractTodo }>
      >(runtime, `/load-todos`, {
        collectionId,
      })
      const runtimeError = assertRuntimeError(loadResult)
      expect(runtimeError.message).toContain(`Schema version mismatch`)
    } finally {
      await runtime.stop()
      rmSync(tempDirectory, { recursive: true, force: true })
    }
  }, 90_000)

  it(`resets collection on schema mismatch in sync-present mode`, async () => {
    const tempDirectory = mkdtempSync(
      join(tmpdir(), `db-cloudflare-do-sync-mismatch-e2e-`),
    )
    const persistPath = join(tempDirectory, `wrangler-state`)
    const collectionId = `todos`
    let runtime = await startWranglerRuntime({
      persistPath,
      syncEnabled: true,
      schemaVersion: 1,
      collectionId,
    })

    try {
      const writeResult = await postJson<void>(runtime, `/write-todo`, {
        collectionId,
        txId: `tx-1`,
        seq: 1,
        rowVersion: 1,
        todo: {
          id: `sync-1`,
          title: `Sync mode row`,
          score: 20,
        },
      })
      assertRuntimeSuccess(writeResult)
    } finally {
      await runtime.stop()
    }

    runtime = await startWranglerRuntime({
      persistPath,
      syncEnabled: true,
      schemaVersion: 2,
      collectionId,
    })
    try {
      const loadResult = await postJson<
        Array<{ key: string; value: RuntimeBridgeE2EContractTodo }>
      >(runtime, `/load-todos`, {
        collectionId,
      })
      const rows = assertRuntimeSuccess(loadResult) ?? []
      expect(rows).toEqual([])
    } finally {
      await runtime.stop()
      rmSync(tempDirectory, { recursive: true, force: true })
    }
  }, 90_000)
})
