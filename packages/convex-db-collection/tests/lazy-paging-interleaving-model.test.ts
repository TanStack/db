// A model rule of the lazy receipt settlement model, checked by hand without
// production. lazy-paging-interleaving-oracle.property.test.ts judges
// production with the same LazyReceiptModel.
import { expect, it } from 'vitest'
import { oracleAssertion } from '../../db/tests/oracle-assertion-adapter'
import { LazyReceiptModel } from './lazy-paging-receipt-model'

it(`permits core fulfillment after abort once an uncancelable baseline applies`, () => {
  const model = new LazyReceiptModel()
  model.acquire(`a`, [`v1`])
  model.initiate(`a`, `baseline`)
  model.abort(`a`)
  model.accept(`receipt`, [`v1`], [`a`])
  oracleAssertion(
    `lazy-paging-interleaving-oracle.property.test.ts:437:toThrow`,
    () => expect(() => model.observe(`a`, `success`)).toThrow(`in-flight work`),
  )
  model.finish(`a`, `baseline`)
  oracleAssertion(
    `lazy-paging-interleaving-oracle.property.test.ts:439:toThrow`,
    () => expect(() => model.observe(`a`, `success`)).toThrow(`receipt`),
  )
  model.apply(`receipt`)
  model.observe(`a`, `success`)
  model.complete()
})
