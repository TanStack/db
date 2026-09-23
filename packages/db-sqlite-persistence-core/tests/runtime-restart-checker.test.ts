import { describe, expect, it } from 'vitest'
import { assertRuntimeRestartHistory } from './contracts/runtime-bridge-e2e-contract'
import type {
  RuntimeBridgeE2EContractHarness,
  RuntimeBridgeE2EContractTodo,
} from './contracts/runtime-bridge-e2e-contract'

describe(`runtime restart history checker`, () => {
  it.each([`none`, `score`, `id`, `extra-row`, `drop-next-write`] as const)(
    `distinguishes %s from a faithful restart`,
    async (fault) => {
      const rows = new Map<string, RuntimeBridgeE2EContractTodo>()
      let restarted = false
      let faultHits = 0
      const harness: RuntimeBridgeE2EContractHarness = {
        writeTodoFromClient: (todo) => {
          if (restarted && fault === `drop-next-write`) {
            faultHits++
            return Promise.resolve()
          }
          rows.set(todo.id, { ...todo })
          return Promise.resolve()
        },
        loadTodosFromClient: () =>
          Promise.resolve(
            [...rows].map(([key, value]) => ({ key, value: { ...value } })),
          ),
        restartHost: () => {
          restarted = true
          const row = rows.get(`restart-1`)!
          if (fault === `score`) {
            faultHits++
            row.score++
          } else if (fault === `id`) {
            faultHits++
            row.id = `wrong-id`
          } else if (fault === `extra-row`) {
            faultHits++
            rows.set(`phantom`, { id: `phantom`, title: `Extra`, score: 0 })
          }
          return Promise.resolve()
        },
        loadUnknownCollectionErrorFromClient: () =>
          Promise.reject(new Error(`not part of the restart history`)),
        cleanup: () => {},
      }
      if (fault === `none`) {
        await assertRuntimeRestartHistory(harness)
        expect(faultHits).toBe(0)
      } else {
        await expect(
          assertRuntimeRestartHistory(harness),
        ).rejects.toMatchObject({
          name: `AssertionError`,
        })
        expect(faultHits).toBe(1)
      }
    },
  )
})
