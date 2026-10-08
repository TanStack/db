import { describe, expect, it } from 'vitest'
import {
  IR,
  Query,
  collectionOptions,
  createCollection,
} from '../../src/index.js'
import { getQueryIR } from '../../src/query/builder/index.js'
import { cloneQueryForPlacement } from '../../src/query/builder/clone-query.js'

// A concrete source retains the published CollectionRef shape. A descriptor
// stays a distinct IR source until a client binds a query placement. These
// checks cover IR representation, not adapter publication or every query form.

function source(id: string) {
  return createCollection<Record<string, unknown>>({
    id,
    getKey: (row) => String(row.id),
    sync: { sync: ({ markReady }) => markReady() },
  })
}

describe(`CollectionRef public shape`, () => {
  it(`keeps a concrete Collection as a writable own field`, () => {
    const first = source(`collection-ref-first`)
    const second = source(`collection-ref-second`)
    const ref = new IR.CollectionRef(first, `item`)

    expect(Object.keys(ref).sort()).toEqual(
      [`type`, `collection`, `alias`].sort(),
    )
    expect({ ...ref }.collection).toBe(first)
    ref.collection = second
    expect(ref.collection).toBe(second)
  })

  it(`represents an unbound descriptor as a distinct source`, () => {
    const descriptor = collectionOptions(`collection-ref-descriptor`, () => ({
      id: `collection-ref-descriptor`,
      getKey: (row: { id: string }) => row.id,
      sync: { sync: ({ markReady }) => markReady() },
    }))
    const query = getQueryIR(new Query().from({ item: descriptor }))
    const ref = query.from

    expect(ref.type).toBe(`descriptorRef`)
    expect(ref).toBeInstanceOf(IR.DescriptorRef)
    expect(`descriptor` in ref && ref.descriptor).toBe(descriptor)
    expect(`collection` in ref).toBe(false)

    const collection = source(`collection-ref-bound`)
    const bound = cloneQueryForPlacement(query, (options) => {
      expect(options).toBe(descriptor)
      return collection
    })
    expect(bound.from.type).toBe(`collectionRef`)
    expect(query.from).toBe(ref)
    if (ref.type === `descriptorRef` && bound.from.type === `collectionRef`) {
      expect(bound.from.sourceId).not.toBe(ref.sourceId)
      expect(bound.from.collection).toBe(collection)
    }
  })

  it(`binds each descriptor source position before concrete traversal`, () => {
    const descriptor = collectionOptions(`collection-ref-placements`, () => ({
      id: `collection-ref-placements`,
      getKey: (row: { id: string }) => row.id,
      sync: { sync: ({ markReady }) => markReady() },
    }))
    const ref = (alias: string) => new IR.DescriptorRef(descriptor, alias)
    const queries: Array<{ query: IR.QueryIR; aliases: Array<string> }> = [
      {
        query: {
          from: new IR.QueryRef(
            {
              from: ref(`nested`),
              select: { id: new IR.PropRef([`nested`, `id`]) },
            },
            `derived`,
          ),
        },
        aliases: [`nested`],
      },
      {
        query: { from: new IR.UnionFrom([ref(`left`), ref(`right`)]) },
        aliases: [`left`, `right`],
      },
      {
        query: {
          from: new IR.UnionAll([
            {
              from: ref(`first`),
              select: { id: new IR.PropRef([`first`, `id`]) },
            },
            {
              from: ref(`second`),
              select: { id: new IR.PropRef([`second`, `id`]) },
            },
          ]),
        },
        aliases: [`first`, `second`],
      },
      {
        query: {
          from: ref(`root`),
          join: [
            {
              from: ref(`joined`),
              type: `inner`,
              on: new IR.Func(`eq`, [
                new IR.PropRef([`root`, `id`]),
                new IR.PropRef([`joined`, `id`]),
              ]),
            },
          ],
          select: {
            children: new IR.IncludesSubquery(
              { from: ref(`child`) },
              new IR.PropRef([`root`, `id`]),
              new IR.PropRef([`child`, `id`]),
              `children`,
            ),
          },
        },
        aliases: [`root`, `joined`, `child`],
      },
    ]

    const collection = source(`collection-ref-placements`)
    for (const { query, aliases } of queries) {
      const unbound = IR.collectSourceRefs(query)
      expect(unbound.map((sourceRef) => sourceRef.alias).sort()).toEqual(
        [...aliases].sort(),
      )
      expect(
        unbound.every((sourceRef) => sourceRef.type === `descriptorRef`),
      ).toBe(true)
      expect(() => IR.collectCollectionSources(query)).toThrow(
        /requires a DbClient/,
      )

      const bound = cloneQueryForPlacement(query, () => collection)
      const concrete = IR.collectCollectionSources(bound)
      expect(concrete.map((sourceRef) => sourceRef.alias).sort()).toEqual(
        [...aliases].sort(),
      )
      expect(
        concrete.every((sourceRef) => sourceRef.collection === collection),
      ).toBe(true)
      expect(
        new Set(concrete.map((sourceRef) => sourceRef.sourceId)).size,
      ).toBe(aliases.length)
    }
  })
})
