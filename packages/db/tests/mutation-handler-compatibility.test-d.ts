import { describe, expectTypeOf, it } from 'vitest'
import type { Transaction } from '../src/transactions'
import type {
  DeleteMutationFn,
  InsertMutationFn,
  TransactionWithMutations,
  UpdateMutationFn,
} from '../src/types'

describe(`mutation handler return types`, () => {
  type Row = { id: string }

  it(`requires handlers to settle without a return value`, () => {
    expectTypeOf<ReturnType<InsertMutationFn<Row>>>().toEqualTypeOf<
      Promise<void>
    >()
    expectTypeOf<ReturnType<UpdateMutationFn<Row>>>().toEqualTypeOf<
      Promise<void>
    >()
    expectTypeOf<ReturnType<DeleteMutationFn<Row>>>().toEqualTypeOf<
      Promise<void>
    >()
  })

  // Adapters pass a handler's transaction to code that takes a Transaction.
  // `TransactionWithMutations` omits a key, which drops private members, so
  // a private member on Transaction would break this.
  it(`passes a handler's transaction where a Transaction is expected`, () => {
    expectTypeOf<TransactionWithMutations<Row, `insert`>>().toExtend<
      Transaction<any>
    >()
  })
})
