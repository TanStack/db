import { describe, expect, it } from 'vitest'
import { BasicIndex } from '../src/indexes/basic-index.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { PropRef } from '../src/query/ir.js'
import { normalizeValue } from '../src/utils/comparison.js'
import type { BaseIndex } from '../src/indexes/base-index.js'

type IndexConstructor = new (
  id: number,
  expression: PropRef,
  name?: string,
  options?: unknown,
) => BaseIndex<string> & {
  valueMapData: Map<unknown, Set<string>>
}

const indexTypes: Array<[string, IndexConstructor]> = [
  [`BasicIndex`, BasicIndex as IndexConstructor],
  [`BTreeIndex`, BTreeIndex as IndexConstructor],
]

describe.each(indexTypes)(`%s update`, (_indexName, IndexType) => {
  function createIndex(options?: unknown) {
    return new IndexType(1, new PropRef([`value`]), `test_index`, options)
  }

  it(`keeps the existing bucket when the indexed value does not change`, () => {
    const index = createIndex()
    index.add(`a`, { value: 1, version: 1 })
    const bucket = index.valueMapData.get(1)
    const lastUpdated = index.getStats().lastUpdated

    index.update(`a`, { value: 1, version: 1 }, { value: 1, version: 2 })

    expect(index.valueMapData.get(1)).toBe(bucket)
    expect(index.getStats().lastUpdated).toBe(lastUpdated)
    expect(index.lookup(`eq`, 1)).toEqual(new Set([`a`]))
  })

  it.each([
    [`undefined`, undefined, undefined],
    [`NaN`, Number.NaN, Number.NaN],
    [`signed zero`, 0, -0],
    [`equal dates`, new Date(1000), new Date(1000)],
    [`equal byte arrays`, new Uint8Array([1, 2]), new Uint8Array([1, 2])],
  ])(`keeps the existing bucket for %s`, (_caseName, oldValue, newValue) => {
    const index = createIndex()
    index.add(`a`, { value: oldValue })
    const bucket = index.valueMapData.get(normalizeValue(oldValue))

    index.update(`a`, { value: oldValue }, { value: newValue })

    expect(index.valueMapData.get(normalizeValue(newValue))).toBe(bucket)
  })

  it(`moves the key when the indexed value changes`, () => {
    const index = createIndex()
    index.add(`a`, { value: 1 })

    index.update(`a`, { value: 1 }, { value: 2 })

    expect(index.lookup(`eq`, 1)).toEqual(new Set())
    expect(index.lookup(`eq`, 2)).toEqual(new Set([`a`]))
  })

  it(`does not use comparator equality to skip an update`, () => {
    const index = createIndex({
      compareFn: (a: string, b: string) =>
        a.toLowerCase().localeCompare(b.toLowerCase()),
    })
    index.add(`a`, { value: `A` })

    index.update(`a`, { value: `A` }, { value: `a` })

    expect(index.lookup(`eq`, `A`)).toEqual(new Set())
    expect(index.lookup(`eq`, `a`)).toEqual(new Set([`a`]))
  })
})
