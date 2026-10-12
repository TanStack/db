import { describe, expect, it } from 'vitest'
import { getLazyLoadTargets } from '../../../src/query/compiler/lazy-targets.js'
import {
  CollectionRef,
  Func,
  PropRef,
  QueryRef,
  UnionFrom,
} from '../../../src/query/ir.js'
import type { QueryIR } from '../../../src/query/ir.js'
import type { CollectionImpl } from '../../../src/collection/index.js'

describe(`lazy load target identity`, () => {
  const collection = { id: `items` } as CollectionImpl

  function targetsForAlias(alias: string) {
    const source = new CollectionRef(collection, `inner`)
    const inner: QueryIR = {
      from: source,
    }
    const query: QueryIR = {
      from: new QueryRef(inner, `selected`),
    }

    return {
      source,
      targets: getLazyLoadTargets(
        query,
        source,
        `selected`,
        new PropRef([`selected`, `id`]),
        collection,
        { selected: alias },
      ),
    }
  }

  it(`resolves the lexical source even when alias remapping agrees`, () => {
    const { source, targets } = targetsForAlias(`inner`)

    expect(targets).toEqual([
      {
        sourceId: source.sourceId,
        alias: `inner`,
        collection,
        path: [`id`],
      },
    ])
  })

  it(`keeps the lexical source when alias remapping names another source`, () => {
    const { source, targets } = targetsForAlias(`other`)
    expect(targets).toEqual([
      {
        sourceId: source.sourceId,
        alias: `inner`,
        collection,
        path: [`id`],
      },
    ])
  })

  it(`retains dotted and nested paths from one lazy source`, () => {
    const source = new CollectionRef(collection, `item`)
    const from = new UnionFrom([
      source,
      new CollectionRef({ id: `other` } as CollectionImpl, `other`),
    ])
    const query: QueryIR = { from }

    const targets = getLazyLoadTargets(
      query,
      from,
      `item`,
      new Func(`coalesce`, [
        new PropRef([`item`, `a.b`]),
        new PropRef([`item`, `a`, `b`]),
      ]),
      undefined,
      {},
    )

    expect(targets.map(({ path }) => path)).toEqual([[`a.b`], [`a`, `b`]])
  })
})
