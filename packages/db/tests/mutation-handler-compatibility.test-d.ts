import { describe, expectTypeOf, it } from 'vitest'
import type {
  BaseCollectionConfig,
  DeleteMutationFn,
  InsertMutationFn,
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
})
