import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { collectionOptions } from '../src/client.js'
import {
  getLiveQueryHash,
  getPreparedLiveQueryIdentity,
  prepareLiveQueryValue,
  resolveLiveQueryValue,
} from '../src/live-query-options.js'
import { BaseQueryBuilder } from '../src/query/builder/index.js'

describe(`live query preparation`, () => {
  it(`requires a client when a standalone descriptor query is consumed`, () => {
    const descriptor = collectionOptions(`unbound-descriptor`, () => ({
      id: `unbound-descriptor`,
      getKey: (row: { id: string }) => row.id,
      sync: { sync: ({ markReady }) => markReady() },
    }))
    const query = new BaseQueryBuilder().from({ item: descriptor })

    const consume = () =>
      resolveLiveQueryValue(
        prepareLiveQueryValue(query, undefined, new Set()),
        { pool: false },
      )

    expect(consume).toThrow(
      /descriptor "item" requires a DbClient when the query is consumed/,
    )
    expect(consume).not.toThrow(/DbProvider/)
  })

  it(`leaves an unfinished builder unchanged when no client can bind it`, () => {
    const query = new BaseQueryBuilder()

    expect(prepareLiveQueryValue(query, undefined, new Set())).toBe(query)
  })

  it.each([undefined, null])(
    `promotes a nullish config query result to a disabled query`,
    (disabled) => {
      const prepared = prepareLiveQueryValue(
        { query: () => disabled },
        undefined,
        new Set(),
      )

      expect(prepared).toBe(disabled)
    },
  )
})

describe(`live query identity`, () => {
  it(`hashes Map values in an explicit queryKey deterministically`, () => {
    const first = getLiveQueryHash(undefined, [
      new Map<string, number>([
        [`b`, 2],
        [`a`, 1],
      ]),
    ])
    const second = getLiveQueryHash(undefined, [
      new Map<string, number>([
        [`a`, 1],
        [`b`, 2],
      ]),
    ])

    expect(first).toBe(second)
  })

  it(`hashes Set values in an explicit queryKey deterministically`, () => {
    const first = getLiveQueryHash(undefined, [new Set([`b`, `a`])])
    const second = getLiveQueryHash(undefined, [new Set([`a`, `b`])])

    expect(first).toBe(second)
  })

  it(`treats an empty queryKey as absent`, () => {
    const first = createCollection<{ id: string }>({
      id: `empty-query-key-first`,
      getKey: (row) => row.id,
      sync: { sync: ({ markReady }) => markReady() },
    })
    const second = createCollection<{ id: string }>({
      id: `empty-query-key-second`,
      getKey: (row) => row.id,
      sync: { sync: ({ markReady }) => markReady() },
    })

    expect(getLiveQueryHash(first, [])).not.toBe(getLiveQueryHash(second, []))
  })

  it(`does not collapse configs with opaque row identity behavior`, () => {
    const source = createCollection<{ id: string }>({
      id: `live-query-config-identity-source`,
      getKey: (row) => row.id,
      sync: { sync: ({ markReady }) => markReady() },
    })
    const query = new BaseQueryBuilder().from({ source })
    const first = { query, getKey: (row: { id: string }) => row.id }
    const second = { query, getKey: (row: { id: string }) => `x-${row.id}` }

    expect(getPreparedLiveQueryIdentity(first)).not.toEqual(
      getPreparedLiveQueryIdentity(second),
    )
    expect(() => getLiveQueryHash(first)).toThrow(/function value/)
    expect(() => getLiveQueryHash(second)).toThrow(/function value/)
  })

  it(`uses exact custom comparator identity in live-query config hashes`, () => {
    const source = createCollection<{ id: string }>({
      id: `live-query-custom-collation-source`,
      getKey: (row) => row.id,
      sync: { sync: ({ markReady }) => markReady() },
    })
    const query = new BaseQueryBuilder().from({ source })
    const compare = (a: string, b: string) => a.length - b.length
    const config = (candidate: typeof compare) => ({
      query,
      defaultStringCollation: {
        stringSort: `custom` as const,
        compare: candidate,
      },
    })

    expect(getLiveQueryHash(config(compare))).toBe(
      getLiveQueryHash(config(compare)),
    )
    expect(getLiveQueryHash(config(compare))).not.toBe(
      getLiveQueryHash(config((a: string, b: string) => a.length - b.length)),
    )
  })
})
