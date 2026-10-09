import { describe, expectTypeOf, it } from 'vitest'
import type { Transaction } from '../src/transactions'
import type {
  BaseCollectionConfig,
  DeleteMutationFn,
  InsertMutationFn,
  TransactionWithMutations,
  UpdateMutationFn,
  UtilsRecord,
} from '../src/types'

describe(`mutation handler return compatibility`, () => {
  type Row = { id: string }
  type LegacyResult = { txid: number }

  it(`keeps default handler aliases compatible with legacy returns`, () => {
    const insert: InsertMutationFn<Row> = () => Promise.resolve({ txid: 1 })
    const update: UpdateMutationFn<Row> = () => Promise.resolve({ txid: 1 })
    const remove: DeleteMutationFn<Row> = () => Promise.resolve({ txid: 1 })

    expectTypeOf(insert).toBeFunction()
    expectTypeOf(update).toBeFunction()
    expectTypeOf(remove).toBeFunction()
  })

  it(`retains the deprecated fifth BaseCollectionConfig parameter`, () => {
    type LegacyConfig = BaseCollectionConfig<
      Row,
      string,
      never,
      UtilsRecord,
      LegacyResult
    >

    expectTypeOf<LegacyConfig>().toBeObject()
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
