// @vitest-environment node
// Checker calibration of the value observation in structured-clone-oracle.ts.
// It runs no production and no storage: hand-built rows must match or differ
// from the authored value descriptions. The production histories that use the
// same observation are in persistence-values-oracle.test.ts.
import { expect, it } from 'vitest'
import {
  createValue,
  expectedValueRows,
  observeValueRows,
  valueKinds,
} from './structured-clone-oracle'

// Calibrate the value observation independently of storage. These wrong answers
// preserve superficial contents while losing exactly the type/offset/byte law.
it('rejects flattened values, lost offsets, corrupt bytes and absent rows', async () => {
  const row = (value: unknown) => [
    { id: 1, name: 'initial', nested: { value } },
  ]
  for (const kind of valueKinds) {
    expect(await observeValueRows(row(createValue(kind)))).toEqual(
      expectedValueRows(kind, 'initial'),
    )
    expect(await observeValueRows(row({}))).not.toEqual(
      expectedValueRows(kind, 'initial'),
    )
  }
  expect(await observeValueRows(row(new Uint8Array([17, 0, 255])))).not.toEqual(
    expectedValueRows('uint8', 'initial'),
  )
  expect(
    await observeValueRows(row(new Uint8Array([3, 17, 1, 255, 8]).buffer)),
  ).not.toEqual(expectedValueRows('buffer', 'initial'))
  expect(await observeValueRows([])).not.toEqual(
    expectedValueRows('date', 'initial'),
  )
})
