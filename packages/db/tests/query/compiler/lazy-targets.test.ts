import { describe, expect, it } from 'vitest'
import { getLazyLoadTargets } from '../../../src/query/compiler/lazy-targets.js'
import { CollectionRef, PropRef, QueryRef } from '../../../src/query/ir.js'
import type { QueryIR } from '../../../src/query/ir.js'
import type { CollectionImpl } from '../../../src/collection/index.js'

describe(`lazy load target identity`, () => {
  const collection = { id: `items` } as CollectionImpl

  function targetsForAlias(alias: string) {
    const inner: QueryIR = {
      from: new CollectionRef(collection, `inner`),
    }
    const query: QueryIR = {
      from: new QueryRef(inner, `selected`),
    }
    const optimizedSource = new CollectionRef(collection, `optimized`)

    return {
      optimizedSource,
      targets: getLazyLoadTargets(
        query,
        optimizedSource,
        `selected`,
        new PropRef([`selected`, `id`]),
        collection,
        { selected: alias },
      ),
    }
  }

  it(`uses a fallback source when its lexical alias matches`, () => {
    const { optimizedSource, targets } = targetsForAlias(`optimized`)

    expect(targets).toEqual([
      {
        sourceId: optimizedSource.sourceId,
        alias: `optimized`,
        collection,
        path: [`id`],
      },
    ])
  })

  it(`does not route demand through a fallback with another alias`, () => {
    expect(targetsForAlias(`other`).targets).toEqual([])
  })
})
