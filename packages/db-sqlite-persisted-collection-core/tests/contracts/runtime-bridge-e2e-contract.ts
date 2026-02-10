import { describe, expect, it } from 'vitest'

export type RuntimeBridgeE2EContractTodo = {
  id: string
  title: string
  score: number
}

export type RuntimeBridgeE2EContractError = {
  name: string
  message: string
  code?: string
}

export type RuntimeBridgeE2EContractHarness = {
  writeTodoFromClient: (todo: RuntimeBridgeE2EContractTodo) => Promise<void>
  loadTodosFromClient: (collectionId?: string) => Promise<
    Array<{
      key: string
      value: RuntimeBridgeE2EContractTodo
    }>
  >
  loadUnknownCollectionErrorFromClient: () => Promise<RuntimeBridgeE2EContractError>
  restartHost: () => Promise<void>
  cleanup: () => Promise<void> | void
}

export type RuntimeBridgeE2EContractHarnessFactory =
  () => RuntimeBridgeE2EContractHarness

async function withRuntimeBridgeHarness<T>(
  createHarness: RuntimeBridgeE2EContractHarnessFactory,
  run: (harness: RuntimeBridgeE2EContractHarness) => Promise<T>,
): Promise<T> {
  const harness = createHarness()

  try {
    return await run(harness)
  } finally {
    await harness.cleanup()
  }
}

export function runRuntimeBridgeE2EContractSuite(
  suiteName: string,
  createHarness: RuntimeBridgeE2EContractHarnessFactory,
  options?: {
    testTimeoutMs?: number
  },
): void {
  const testTimeoutMs = options?.testTimeoutMs ?? 30_000

  describe(suiteName, () => {
    it(
      `round-trips persistence writes and reads across runtime bridge`,
      async () => {
        await withRuntimeBridgeHarness(createHarness, async (harness) => {
          await harness.writeTodoFromClient({
            id: `1`,
            title: `From bridge client`,
            score: 10,
          })

          const rows = await harness.loadTodosFromClient()
          expect(rows).toEqual([
            {
              key: `1`,
              value: {
                id: `1`,
                title: `From bridge client`,
                score: 10,
              },
            },
          ])
        })
      },
      testTimeoutMs,
    )

    it(
      `survives host restart while keeping persisted data`,
      async () => {
        await withRuntimeBridgeHarness(createHarness, async (harness) => {
          await harness.writeTodoFromClient({
            id: `restart-1`,
            title: `Persisted across restart`,
            score: 42,
          })

          await harness.restartHost()

          const rows = await harness.loadTodosFromClient()
          expect(rows.map((row) => row.key)).toContain(`restart-1`)
          expect(
            rows.find((row) => row.key === `restart-1`)?.value.title,
          ).toEqual(`Persisted across restart`)
        })
      },
      testTimeoutMs,
    )

    it(
      `returns structured remote errors for missing collections`,
      async () => {
        await withRuntimeBridgeHarness(createHarness, async (harness) => {
          const error = await harness.loadUnknownCollectionErrorFromClient()

          expect(error.name).not.toEqual(``)
          expect(error.message).not.toEqual(``)
          expect(error.code).toEqual(`UNKNOWN_COLLECTION`)
        })
      },
      testTimeoutMs,
    )
  })
}
