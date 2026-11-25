// @vitest-environment node
/** Ordinary receiving tests inject a failure after actual native key removal. */
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../../browser-db-sqlite-persistence/tests/adapter-chromium-host'
import {
  checkHistory,
  expectedResult,
} from './local-storage-write-order-oracle'
import type { History } from './local-storage-write-order-oracle'

const history: History = {
  writes: [{ kind: `update`, id: `a` }],
  release: [0],
  accepted: [true],
}
let host: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  host = await startAdapterChromium({
    entry: `/packages/db/e2e/local-stores-receiving.html`,
    ready: `runLocalStorageWriteOrder`,
  })
}, 120_000)
afterAll(async () => {
  await host?.close()
}, 120_000)

async function receive(id: string) {
  if (!host) throw new Error(`Native Storage cleanup host did not start`)
  const active = host
  return captureBrowserHistory(active, () =>
    active.page.evaluate(
      ({ input, identity }) =>
        window.runLocalStorageWriteOrder(input, identity, true),
      { input: history, identity: id },
    ),
  )
}

test(`transports native cleanup failure beside completed product observations`, async () => {
  const raw = await receive(`native-cleanup-only`)
  expect(raw.browserErrors).toEqual([])
  expect(
    checkHistory(history, raw.observations, expectedResult(history)),
  ).toMatchObject({
    kind: `violation`,
    checkpoint: `cleanup errors`,
    law: `receiving cleanup`,
  })
})

test(`retains product mismatch when native teardown also fails`, async () => {
  const raw = await receive(`native-paired-failure`)
  const corrupted = raw.observations.map((entry) =>
    entry.checkpoint === `settled`
      ? { ...entry, value: { ...(entry.value as object), public: [] } }
      : entry,
  )
  expect(
    checkHistory(history, corrupted, expectedResult(history)),
  ).toMatchObject({ kind: `violation`, checkpoint: `settled` })
  expect(
    raw.observations.find(({ checkpoint }) => checkpoint === `cleanup errors`)
      ?.value,
  ).toEqual([`Error: native receiving storage teardown failed`])
})
