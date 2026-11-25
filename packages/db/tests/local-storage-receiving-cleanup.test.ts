/** Actual receiving handoff keeps completed row checks beside teardown errors. */
import { expect, test } from 'vitest'
import { collectLocalStorageWriteOrder } from './local-storage-write-order-driver'
import {
  checkHistory,
  expectedResult,
} from './local-storage-write-order-oracle'
import type { StorageApi } from '../src/local-storage'
import type { History } from './local-storage-write-order-oracle'

const history: History = {
  writes: [{ kind: `update`, id: `a` }],
  release: [0],
  accepted: [true],
}

async function faultyTeardown() {
  const bytes = new Map<string, string>()
  let removed = false
  const storage: StorageApi = {
    getItem: (key) => bytes.get(key) ?? null,
    setItem: (key, value) => {
      bytes.set(key, value)
    },
    removeItem: (key) => {
      bytes.delete(key)
      removed = true
      throw new Error(`receiving storage teardown failed`)
    },
  }
  const completed = await collectLocalStorageWriteOrder(
    history,
    storage,
    `rows`,
    { addEventListener() {}, removeEventListener() {} },
  )
  return { completed, removed }
}

test(`reports cleanup failure after the actual receiving handoff completes`, async () => {
  const { completed, removed } = await faultyTeardown()
  const verdict = checkHistory(
    history,
    completed.observations,
    expectedResult(history),
  )
  expect(removed).toBe(true)
  expect(verdict).toMatchObject({
    kind: `violation`,
    checkpoint: `cleanup errors`,
    law: `receiving cleanup`,
  })
})

test(`keeps the product mismatch primary beside actual teardown failure`, async () => {
  const { completed, removed } = await faultyTeardown()
  const corrupted = completed.observations.map((entry) =>
    entry.checkpoint === `settled`
      ? { ...entry, value: { ...(entry.value as object), public: [] } }
      : entry,
  )
  const verdict = checkHistory(history, corrupted, expectedResult(history))
  expect(removed).toBe(true)
  expect(verdict).toMatchObject({ kind: `violation`, checkpoint: `settled` })
  expect(
    completed.observations.find(
      ({ checkpoint }) => checkpoint === `cleanup errors`,
    )?.value,
  ).toEqual([`Error: receiving storage teardown failed`])
})
