/** Instrument regressions: teardown cannot discard an already-recorded result. */
import { expect, test } from 'vitest'
import { initialReceiptViolations } from './initial-receipt-oracle'
import { observeNodePersistedInitialReceipt } from './persisted-initial-receipt-node-driver'
import { retainInitialReceiptCleanup } from './persisted-initial-receipt-driver'

const history = { rows: 1, cleanupAt: `after-application`, reason: 1 } as const
for (const host of [`controlled`, `node-sqlite`] as const)
  for (const fault of [`close`, `after-record`] as const)
    test(`retains the completed ${host} receipt result across ${fault} failure`, async () => {
      const actual = await observeNodePersistedInitialReceipt(
        history,
        host,
        fault,
      )
      expect(initialReceiptViolations(history, actual)).toEqual([])
      expect(actual.cleanupErrors).toHaveLength(1)
      expect(actual.cleanupErrors?.[0]).toContain(`Injected receipt`)
    })

test(`retains a receipt mismatch across a later throwing cleanup`, async () => {
  const actual = await observeNodePersistedInitialReceipt(history, `controlled`)
  const completed = { ...actual, detachedErrors: [`Hostile detached receipt`] }
  const recorded = await retainInitialReceiptCleanup(
    () => Promise.resolve(completed),
    [
      () => {
        throw new Error(`Injected receipt cleanup failure`)
      },
    ],
  )
  expect(initialReceiptViolations(history, recorded)).toEqual([
    `detachedErrors`,
  ])
  expect(recorded.detachedErrors).toEqual(completed.detachedErrors)
  expect(recorded.cleanupErrors?.[0]).toContain(
    `Injected receipt cleanup failure`,
  )
})
