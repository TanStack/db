// Model calibrations for lazy-paging-revalidation-oracle.property.test.ts:
// each steps LazyReceiptModel or LazyVersionModel by hand and requires the
// rule to reject a wrong settlement or publication. They run no production.
import { expect, it } from 'vitest'
import { oracleAssertion } from '../../db/tests/oracle-assertion-adapter'
import { LazyReceiptModel } from './lazy-paging-receipt-model'
import { LazyVersionModel } from './lazy-paging-version-model-oracle'

it(`calibrates cleanup authority without treating cleanup as receipt application`, () => {
  const model = new LazyReceiptModel()
  model.acquire(`a`, [`equal`])
  model.accept(`actual`, [`equal`], [`a`])
  model.abort(`a`)
  oracleAssertion(
    `lazy-paging-revalidation-oracle.property.test.ts:374:toThrow`,
    () =>
      expect(() => model.abandon(`actual`)).toThrow(
        /abandonment without pending cleanup work/,
      ),
  )
  model.cleanup()
  oracleAssertion(
    `lazy-paging-revalidation-oracle.property.test.ts:378:toThrow`,
    () =>
      expect(() => model.observe(`a`, `canceled`)).toThrow(
        /settled before actual applied/,
      ),
  )
  model.abandon(`actual`)
  oracleAssertion(
    `lazy-paging-revalidation-oracle.property.test.ts:382:toThrow`,
    () =>
      expect(() => model.observe(`a`, `success`)).toThrow(
        /settled before actual applied/,
      ),
  )
  model.observe(`a`, `canceled`)
  model.complete()
})

it(`calibrates exact window order while accepting coherent skipped revisions`, () => {
  const a = { id: `a`, rank: 0, text: `old` }
  const b = { id: `b`, rank: 1, text: `old` }
  const latest = [
    { ...a, text: `latest` },
    { ...b, text: `latest` },
  ]
  const model = new LazyVersionModel(`sequence`)
  model.offer([a, b])
  model.offer([
    { ...a, text: `middle` },
    { ...b, text: `middle` },
  ])
  model.offer(latest)
  model.observe([a, b])
  oracleAssertion(
    `lazy-paging-revalidation-oracle.property.test.ts:405:toThrow`,
    () =>
      expect(() => model.observe([b, a])).toThrow(
        /mixed revision or public rollback/,
      ),
  )
  model.observe(latest)
  oracleAssertion(
    `lazy-paging-revalidation-oracle.property.test.ts:409:toThrow`,
    () =>
      expect(() => model.observe([a, b])).toThrow(
        /mixed revision or public rollback/,
      ),
  )
})
