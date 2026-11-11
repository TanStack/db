// A model rule of LazyVersionModel, checked by hand without production.
// lazy-paging-version-oracle.property.test.ts judges production with it.
import { expect, it } from 'vitest'
import { oracleAssertion } from '../../db/tests/oracle-assertion-adapter'
import { LazyVersionModel } from './lazy-paging-version-model-oracle'

it(`allows stuttering, skipped and observationally identical revisions`, () => {
  const a = [{ id: `a`, rank: 0, text: `first` }]
  const b = [{ id: `a`, rank: 0, text: `middle` }]
  const c = [{ id: `a`, rank: 0, text: `last` }]
  const model = new LazyVersionModel()
  for (const rows of [a, a, b, c]) model.offer(rows)
  for (const rows of [a, a, c, c]) model.observe(rows)
  oracleAssertion(
    `lazy-paging-version-oracle.property.test.ts:258:toThrow`,
    () => expect(() => model.observe(a)).toThrow(`lazy version`),
  )
})
