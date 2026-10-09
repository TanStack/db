import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { DbClient, collectionOptions } from '../src/client.js'
import {
  getLiveQueryHash,
  getPreparedLiveQueryIdentity,
  getPreparedLiveQuerySources,
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
import type { DeferredLiveQueryCollections } from '../src/live-query-options.js'

describe(`live query preparation`, () => {
  it(`collects the same concrete source from a bare builder and a config`, async () => {
    const source = createCollection({
      id: `prepared-source-shapes`,
      getKey: (row: { id: string }) => row.id,
      sync: { sync: ({ markReady }) => markReady() },
    })
    const query = new BaseQueryBuilder().from({ item: source })

    try {
      const bareSources = getPreparedLiveQuerySources(query)
      const configSources = getPreparedLiveQuerySources({ query })
      expect(bareSources).toHaveLength(1)
      expect(configSources).toHaveLength(1)
      expect(bareSources[0]).toBe(source)
      expect(configSources[0]).toBe(source)
    } finally {
      await source.cleanup()
    }
  })

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

  it(`binds a later descriptor only when the continued query is consumed`, async () => {
    let starts = 0
    let materializations = 0
    const sourceDescriptor = collectionOptions(`continuation-source`, () => ({
      id: `continuation-source`,
      getKey: (row: { id: string }) => row.id,
      sync: { sync: ({ markReady }) => markReady() },
    }))
    const laterDescriptor = collectionOptions(`continuation-later`, () => {
      materializations++
      return {
        id: `continuation-later`,
        getKey: (row: { id: string }) => row.id,
        startSync: true,
        sync: {
          sync: ({ markReady }) => {
            starts++
            markReady()
          },
        },
      }
    })
    const client = new DbClient()
    const renderDeferrals: DeferredLiveQueryCollections = new Set()
    const original = new BaseQueryBuilder().from({ source: sourceDescriptor })
    const prepared = prepareLiveQueryValue(
      original,
      client,
      renderDeferrals,
    ) as typeof original
    for (const collection of renderDeferrals) collection._resumeSyncStart()
    renderDeferrals.clear()

    const continued = prepared.join(
      { later: laterDescriptor },
      ({ source, later }) => eq(source.id, later.id),
    )
    expect(
      collectSourceRefs(getQueryIR(continued)).map((ref) => ref.type),
    ).toEqual([`collectionRef`, `descriptorRef`])
    expect(materializations).toBe(0)
    expect(starts).toBe(0)
    expect(() => resolveLiveQueryValue(continued, { pool: false })).toThrow(
      /requires a DbClient/,
    )

    await client.preloadLiveQuery({ query: continued })
    expect(materializations).toBe(1)
    expect(starts).toBe(1)
  })

  it(`defers a continued descriptor until its render preparation is released`, () => {
    let starts = 0
    const sourceDescriptor = collectionOptions(`before-release-source`, () => ({
      id: `before-release-source`,
      getKey: (row: { id: string }) => row.id,
      sync: { sync: ({ markReady }) => markReady() },
    }))
    const laterDescriptor = collectionOptions(`before-release-later`, () => ({
      id: `before-release-later`,
      getKey: (row: { id: string }) => row.id,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          starts++
          markReady()
        },
      },
    }))
    const client = new DbClient()
    const deferrals: DeferredLiveQueryCollections = new Set()
    const base = new BaseQueryBuilder().from({ source: sourceDescriptor })
    const prepared = prepareLiveQueryValue(
      base,
      client,
      deferrals,
    ) as typeof base
    const continued = prepared.join(
      { later: laterDescriptor },
      ({ source, later }) => eq(source.id, later.id),
    )

    expect(starts).toBe(0)
    const consumed = prepareLiveQueryValue(
      continued,
      client,
      deferrals,
    ) as typeof continued
    expect(
      collectSourceRefs(getQueryIR(consumed)).map((ref) => ref.type),
    ).toEqual([`collectionRef`, `collectionRef`])
    expect(starts).toBe(0)
    for (const collection of deferrals) collection._resumeSyncStart()
    expect(starts).toBe(1)
  })

  it(`does not retain a render resolver on a builder captured in the query callback`, () => {
    const sourceDescriptor = collectionOptions(
      `captured-builder-source`,
      () => ({
        id: `captured-builder-source`,
        getKey: (row: { id: string }) => row.id,
        sync: { sync: ({ markReady }) => markReady() },
      }),
    )
    const laterDescriptor = collectionOptions(`captured-builder-later`, () => ({
      id: `captured-builder-later`,
      getKey: (row: { id: string }) => row.id,
      sync: { sync: ({ markReady }) => markReady() },
    }))
    const example = new BaseQueryBuilder().from({ source: sourceDescriptor })
    expect(getQueryIR(example).from.type).toBe(`descriptorRef`)
    let captured: typeof example | undefined
    const client = new DbClient()
    prepareLiveQueryValue(
      (builder: BaseQueryBuilder) => {
        captured = builder.from({ source: sourceDescriptor })
        return captured
      },
      client,
      new Set(),
    )

    const continued = captured!.join(
      { later: laterDescriptor },
      ({ source, later }) => eq(source.id, later.id),
    )
    expect(
      collectSourceRefs(getQueryIR(continued)).map((ref) => ref.type),
    ).toEqual([`descriptorRef`, `descriptorRef`])
  })

  it(`binds a nested descriptor after query construction`, () => {
    const descriptor = collectionOptions(`nested-placement-descriptor`, () => ({
      id: `nested-placement-descriptor`,
      getKey: (row: { id: string }) => row.id,
      sync: { sync: ({ markReady }) => markReady() },
    }))
    const standalone = new BaseQueryBuilder().from({ item: descriptor })
    const client = new DbClient()
    let nestedSourceType: string | undefined

    const prepared = prepareLiveQueryValue(
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
    ) as { query: BaseQueryBuilder }

    expect(nestedSourceType).toBe(`descriptorRef`)
    expect(collectSourceRefs(getQueryIR(prepared.query))[0]?.type).toBe(
      `collectionRef`,
    )
  })

  it(`binds descriptor union branches after query construction`, () => {
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

    const prepared = prepareLiveQueryValue((builder: BaseQueryBuilder) => {
      const union = builder.unionAll(firstBranch, secondBranch)
      sourceTypes = collectSourceRefs(getQueryIR(union)).map(
        (source) => source.type,
      )
      return union
    }, client) as BaseQueryBuilder

    expect(sourceTypes).toEqual([`descriptorRef`, `descriptorRef`])
    expect(
      collectSourceRefs(getQueryIR(prepared)).map((ref) => ref.type),
    ).toEqual([`collectionRef`, `collectionRef`])
    expect(collectSourceRefs(getQueryIR(firstBranch))[0]?.type).toBe(
      `descriptorRef`,
    )
    expect(collectSourceRefs(getQueryIR(secondBranch))[0]?.type).toBe(
      `descriptorRef`,
    )
  })

  it(`binds includes children after query construction`, () => {
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

    const prepared = prepareLiveQueryValue((builder: BaseQueryBuilder) => {
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
    }, client) as BaseQueryBuilder

    expect(sourceTypes).toEqual(Array(6).fill(`descriptorRef`))
    expect(
      collectSourceRefs(getQueryIR(prepared)).map((ref) => ref.type),
    ).toEqual(Array(6).fill(`collectionRef`))
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
