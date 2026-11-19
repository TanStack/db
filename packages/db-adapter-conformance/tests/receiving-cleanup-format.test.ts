/** Ordinary instrument controls: diagnostic formatting must retain recorded rows. */
import { expect, test } from 'vitest'
import { retainNativeObservation } from '../../powersync-db-collection/tests/receiving-cleanup'
import { retainInitialReceiptCleanup as retainDirectReceipt } from '../../powersync-direct-collection/tests/persisted-initial-receipt-driver'
import { retainInitialReceiptCleanup as retainElectricReceipt } from '../../electric-db-collection/tests/cross-adapter-receipt-driver'
import type { InitialReceiptObservation } from '../../powersync-direct-collection/tests/initial-receipt-oracle'

const reasons: Array<[string, () => unknown]> = [
  [`ordinary error`, () => new Error(`ordinary cleanup`)],
  [`null prototype`, () => Object.create(null)],
  [
    `throwing conversion`,
    () => ({
      toString() {
        throw new Error(`conversion`)
      },
    }),
  ],
  [
    `throwing prototype`,
    () =>
      new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error(`prototype`)
          },
        },
      ),
  ],
  [
    `cyclic aggregate`,
    () => {
      const error = new AggregateError([], `cycle`)
      error.errors.push(error)
      return error
    },
  ],
  [
    `throwing aggregate details`,
    () =>
      Object.defineProperty(new AggregateError([], `details`), `errors`, {
        get() {
          throw new Error(`details`)
        },
      }),
  ],
]
const retainers = [
  [`native`, retainNativeObservation<InitialReceiptObservation>],
  [`direct receipt`, retainDirectReceipt],
  [`electric receipt`, retainElectricReceipt],
] as const
for (const [name, retain] of retainers) {
  for (const [label, reason] of reasons)
    test(`${name} retains wrong rows and remaining cleanup after ${label}`, async () => {
      const raw: InitialReceiptObservation = {
        receiptCreated: true,
        receiptPendingAtCleanup: false,
        receiptAppliedBeforeCleanup: true,
        receiptRejected: false,
        finalStatus: `ready`,
        finalRows: [{ id: `wrong`, value: -1 }],
        detachedErrors: [`original mismatch`],
        cleanupErrors: [`earlier diagnostic`],
      }
      const calls: Array<string> = []
      const result = await retain(
        () => Promise.resolve(raw),
        [
          () => {
            calls.push(`first`)
            throw reason()
          },
          () => {
            calls.push(`later`)
            throw new Error(`later cleanup`)
          },
        ],
      )
      expect(result.finalRows).toBe(raw.finalRows)
      expect(result.detachedErrors).toBe(raw.detachedErrors)
      expect(result.cleanupErrors).toHaveLength(3)
      expect(result.cleanupErrors?.[0]).toBe(`earlier diagnostic`)
      expect(result.cleanupErrors?.[1]).toBeTruthy()
      expect(result.cleanupErrors?.[2]).toContain(`later cleanup`)
      expect(calls).toEqual([`first`, `later`])
      expect(raw.cleanupErrors).toEqual([`earlier diagnostic`])
    })
  test(`${name} keeps body failure and later cleanup by identity`, async () => {
    const primary = Object.create(null) as object
    const secondary = new Error(`secondary cleanup`)
    let later = false
    const result: unknown = await retain(
      () => Promise.reject(primary),
      [
        () => {
          throw secondary
        },
        () => {
          later = true
        },
      ],
    ).catch((error: unknown) => error)
    expect(result).toBeInstanceOf(AggregateError)
    expect((result as AggregateError).cause).toBe(primary)
    expect((result as AggregateError).errors).toEqual([primary, secondary])
    expect(later).toBe(true)
  })
}
