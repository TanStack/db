/**
 * The pre-RC settlement replacement has one supported milestone and retains
 * the transaction's generic type on fulfillment. Runtime outcome laws live in
 * optimistic-transaction-oracle.property.test.ts.
 */
import { expectTypeOf, test } from 'vitest'
import { createTransaction } from '../src/transactions.js'

test(`when('settled') preserves the transaction type`, () => {
  const tx = createTransaction<{ id: number }>({
    autoCommit: false,
    mutationFn: async () => {},
  })

  expectTypeOf(tx.when('settled')).toEqualTypeOf<Promise<typeof tx>>()

  // @ts-expect-error This pre-RC API only supports the settlement milestone.
  tx.when('persisted')
})
