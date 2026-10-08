import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { DbClient, collectionOptions } from '../src/client.js'
import {
  getLiveQueryHash,
  getPreparedLiveQueryIdentity,
  prepareLiveQueryValue,
  resolveLiveQueryValue,
} from '../src/live-query-options.js'
import { BaseQueryBuilder, getQueryIR } from '../src/query/builder/index.js'
import {
  caseWhen,
  eq,
  materialize,
  toArray,
} from '../src/query/builder/functions.js'
import { collectSourceRefs } from '../src/query/ir.js'

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

  it(`binds a nested descriptor when a client-aware builder places it`, () => {
    const descriptor = collectionOptions(`nested-placement-descriptor`, () => ({
      id: `nested-placement-descriptor`,
      getKey: (row: { id: string }) => row.id,
      sync: { sync: ({ markReady }) => markReady() },
    }))
    const standalone = new BaseQueryBuilder().from({ item: descriptor })
    const client = new DbClient()
    let nestedSourceType: string | undefined

    prepareLiveQueryValue(
      {
        query: (builder: BaseQueryBuilder) => {
          const outer = builder.from({ nested: standalone })
          const source = getQueryIR(outer).from
          if (source.type === `queryRef`) {
            nestedSourceType = source.query.from.type
          }
          return outer
        },
      },
      client,
      new Set(),
    )

    expect(nestedSourceType).toBe(`collectionRef`)
  })

  it(`binds descriptor branches when a client-aware builder places a union`, () => {
    const descriptor = collectionOptions(`union-placement-descriptor`, () => ({
      id: `union-placement-descriptor`,
      getKey: (row: { id: string }) => row.id,
      sync: { sync: ({ markReady }) => markReady() },
    }))
    const firstBranch = new BaseQueryBuilder()
      .from({ first: descriptor })
      .select(({ first }) => ({ id: first.id }))
    const secondBranch = new BaseQueryBuilder()
      .from({ second: descriptor })
      .select(({ second }) => ({ id: second.id }))
    const client = new DbClient()
    let sourceTypes: Array<string> = []

    prepareLiveQueryValue((builder: BaseQueryBuilder) => {
      const union = builder.unionAll(firstBranch, secondBranch)
      sourceTypes = collectSourceRefs(getQueryIR(union)).map(
        (source) => source.type,
      )
      return union
    }, client)

    // Placement, before final preparation, must leave no descriptor source.
    expect(sourceTypes).toEqual([`collectionRef`, `collectionRef`])
    expect(collectSourceRefs(getQueryIR(firstBranch))[0]?.type).toBe(
      `descriptorRef`,
    )
    expect(collectSourceRefs(getQueryIR(secondBranch))[0]?.type).toBe(
      `descriptorRef`,
    )
  })

  it(`binds an includes child when a client-aware builder places it`, () => {
    const parentDescriptor = collectionOptions(
      `include-placement-parent`,
      () => ({
        id: `include-placement-parent`,
        getKey: (row: { id: string }) => row.id,
        sync: { sync: ({ markReady }) => markReady() },
      }),
    )
    const childDescriptor = collectionOptions(
      `include-placement-child`,
      () => ({
        id: `include-placement-child`,
        getKey: (row: { id: string; parentId: string }) => row.id,
        sync: { sync: ({ markReady }) => markReady() },
      }),
    )
    const client = new DbClient()
    let sourceTypes: Array<string> = []

    prepareLiveQueryValue((builder: BaseQueryBuilder) => {
      const query = builder
        .from({ parent: parentDescriptor })
        .select(({ parent }) => {
          const childQuery = new BaseQueryBuilder()
            .from({ child: childDescriptor })
            .where(({ child }) => eq(child.parentId, parent.id))
          return {
            id: parent.id,
            children: childQuery,
            nested: { inlineChildren: toArray(childQuery) },
            materializedChildren: materialize(childQuery),
            conditionalChildren: caseWhen(
              eq(parent.id, `parent`),
              childQuery,
              childQuery,
            ),
          }
        })
      sourceTypes = collectSourceRefs(getQueryIR(query)).map(
        (source) => source.type,
      )
      return query
    }, client)

    expect(sourceTypes).toEqual(Array(6).fill(`collectionRef`))
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
