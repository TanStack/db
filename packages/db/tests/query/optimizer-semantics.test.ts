// Ordinary optimizer tests: fixed aggregate-join scenarios and residual
// predicate witnesses with hand-written expectations. The aggregate, pushdown,
// and join laws are owned by optimizer-semantics-oracle.test.ts.
import { describe, expect, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { optimizeQuery } from '../../src/query/optimizer.js'
import { eq, max, sum } from '../../src/query/builder/functions.js'
import {
  CollectionRef,
  Func,
  PropRef,
  QueryRef,
  Value,
  createResidualWhere,
} from '../../src/query/ir.js'
import { mockSyncCollectionOptions, stripVirtualProps } from '../utils.js'
import {
  expectedTerms,
  inertCollection,
  members,
  observedTerms,
  predicate,
  rows,
  sourceTerms,
  teams,
} from './optimizer-semantics-support.js'
import type { Member, Row, Team } from './optimizer-semantics-support.js'
import type { QueryIR } from '../../src/query/ir.js'

describe('optimizer aggregate semantics', () => {
  for (const scenario of [
    {
      name: `matching without outer filter`,
      target: 30,
      filter: `none`,
      expected: [{ total: 30 }],
    },
    {
      name: `matching with accepting outer filter`,
      target: 30,
      filter: `accept`,
      expected: [{ total: 30 }],
    },
    {
      name: `matching with rejecting outer filter`,
      target: 30,
      filter: `reject`,
      expected: [],
    },
    {
      name: `nonmatching without outer filter`,
      target: 31,
      filter: `none`,
      expected: [],
    },
  ] as const) {
    test(`inner join of a global aggregate ${scenario.name}`, () => {
      const source = createCollection(
        mockSyncCollectionOptions<Row>({
          id: `optimizer-inner-source-${scenario.name}`,
          getKey: (row) => row.id,
          initialData: rows,
        }),
      )
      const anchor = createCollection(
        mockSyncCollectionOptions({
          id: `optimizer-inner-anchor-${scenario.name}`,
          getKey: (row: { id: number; target: number }) => row.id,
          initialData: [{ id: 1, target: scenario.target }],
        }),
      )
      const result = createLiveQueryCollection({
        startSync: true,
        query: (q) => {
          const summary = q.from({ b: source }).select(({ b }) => ({
            k: max(b.k),
            total: sum(b.v),
          }))
          const joined = q
            .from({ s: summary })
            .innerJoin({ a: anchor }, ({ s, a }) => eq(s.total, a.target))
          if (scenario.filter === `accept`) {
            return joined
              .where(({ s }) => eq(s.k, 2))
              .select(({ s }) => ({ total: s.total }))
          }
          if (scenario.filter === `reject`) {
            return joined
              .where(({ s }) => eq(s.k, 1))
              .select(({ s }) => ({ total: s.total }))
          }
          return joined.select(({ s }) => ({ total: s.total }))
        },
      })

      // The first synchronous public snapshot must follow aggregate, join,
      // then outer-filter semantics. This compares complete rows, not counts.
      const actual = result.toArray.map(stripVirtualProps)
      expect(actual).toEqual(scenario.expected)

      if (scenario.filter === `none`) {
        const aggregate = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q.from({ b: source }).select(({ b }) => ({ total: sum(b.v) })),
        })
        const materialized = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ s: aggregate })
              .innerJoin({ a: anchor }, ({ s, a }) => eq(s.total, a.target))
              .select(({ s }) => ({ total: s.total })),
        })
        expect(materialized.toArray.map(stripVirtualProps)).toEqual(
          scenario.expected,
        )
      }
    })
  }
})

describe(`optimizer residual convergence`, () => {
  test(`structural recorder distinguishes changed predicate values`, () => {
    expect(observedTerms([predicate(`team`, `active`, true)])).not.toEqual(
      observedTerms([predicate(`team`, `active`, false)]),
    )
    expect(
      observedTerms([
        new Func(`gt`, [new PropRef([`team`, `score`]), new Value(5)]),
      ]),
    ).not.toEqual(
      observedTerms([
        new Func(`gt`, [new PropRef([`team`, `score`]), new Value(6)]),
      ]),
    )
  })

  test(`two active sources retain both residual predicates across passes`, () => {
    const collection = inertCollection(`residual-multi-source`)
    const query: QueryIR = {
      from: new CollectionRef(collection, `team`),
      join: [
        {
          type: `left`,
          from: new CollectionRef(collection, `member`),
          on: new Func('eq', [
            new PropRef([`team`, `id`]),
            new PropRef([`member`, `teamId`]),
          ]),
        },
        {
          type: `inner`,
          from: new CollectionRef(collection, `tag`),
          on: new Func('eq', [
            new PropRef([`team`, `id`]),
            new PropRef([`tag`, `teamId`]),
          ]),
        },
      ],
      where: [
        predicate(`member`, `userId`, 100),
        predicate(`team`, `active`, true),
        predicate(`tag`, `region`, `west`),
      ],
    }
    const optimized = optimizeQuery(query).optimizedQuery
    for (const actual of [optimized, optimizeQuery(optimized).optimizedQuery]) {
      expect(sourceTerms(actual.from)).toEqual(
        expectedTerms([`team.active=true`], false),
      )
      expect(sourceTerms(actual.join![0]!.from)).toEqual([])
      expect(sourceTerms(actual.join![1]!.from)).toEqual(
        expectedTerms([`tag.region="west"`], false),
      )
      expect(observedTerms(actual.where)).toEqual([
        { key: `member.userId=100`, residual: false },
        { key: `tag.region="west"`, residual: true },
        { key: `team.active=true`, residual: true },
      ])
    }
  })

  for (const joinType of [`left`, `right`] as const) {
    test(`${joinType} keeps an OR clause residual and a cross-source clause regular`, () => {
      const collection = inertCollection(`residual-clause-forms`)
      const activeAlias = joinType === `left` ? `team` : `member`
      const active = new Func(`or`, [
        predicate(activeAlias, `active`, true),
        predicate(activeAlias, `region`, `west`),
      ])
      const cross = new Func(`eq`, [
        new PropRef([`team`, `id`]),
        new PropRef([`member`, `teamId`]),
      ])
      const query: QueryIR = {
        from: new CollectionRef(collection, `team`),
        join: [
          {
            type: joinType,
            from: new CollectionRef(collection, `member`),
            on: new Func('eq', [
              new PropRef([`team`, `id`]),
              new PropRef([`member`, `teamId`]),
            ]),
          },
        ],
        where: [cross, active],
      }
      const optimized = optimizeQuery(query).optimizedQuery
      const activeKey = `or(${activeAlias}.active=true,${activeAlias}.region="west")`
      const activeSource =
        joinType === `left` ? optimized.from : optimized.join![0]!.from
      expect(sourceTerms(activeSource)).toEqual(
        expectedTerms([activeKey], false),
      )
      expect(observedTerms(optimized.where)).toEqual(
        [
          { key: activeKey, residual: true },
          { key: `team.id=member.teamId`, residual: false },
        ].sort((a, b) => a.key.localeCompare(b.key)),
      )
    })
  }

  test(`non-equality pushdown retains its residual while nullable checks remain regular`, () => {
    const collection = inertCollection(`residual-predicate-kinds`)
    const query: QueryIR = {
      from: new CollectionRef(collection, `team`),
      join: [
        {
          type: `left`,
          from: new CollectionRef(collection, `member`),
          on: new Func('eq', [
            new PropRef([`team`, `id`]),
            new PropRef([`member`, `teamId`]),
          ]),
        },
      ],
      where: [
        new Func(`gt`, [new PropRef([`team`, `score`]), new Value(5)]),
        new Func(`isUndefined`, [new PropRef([`member`, `optional`])]),
      ],
    }

    const optimized = optimizeQuery(query).optimizedQuery
    for (const actual of [optimized, optimizeQuery(optimized).optimizedQuery]) {
      expect(sourceTerms(actual.from)).toEqual(
        expectedTerms([`gt(team.score,5)`], false),
      )
      expect(sourceTerms(actual.join![0]!.from)).toEqual([])
      expect(observedTerms(actual.where)).toEqual([
        { key: `gt(team.score,5)`, residual: true },
        { key: `isUndefined(member.optional)`, residual: false },
      ])
    }
  })

  test(`a source-free false predicate survives optimization passes`, () => {
    const collection = inertCollection(`residual-constant`)
    const query: QueryIR = {
      from: new CollectionRef(collection, `team`),
      join: [
        {
          type: `left`,
          from: new CollectionRef(collection, `member`),
          on: new Func('eq', [
            new PropRef([`team`, `id`]),
            new PropRef([`member`, `teamId`]),
          ]),
        },
      ],
      where: [predicate(`team`, `active`, true), new Value(false)],
    }

    for (const actual of [
      optimizeQuery(query).optimizedQuery,
      optimizeQuery(optimizeQuery(query).optimizedQuery).optimizedQuery,
    ]) {
      expect(
        actual.where?.some(
          (clause) => clause instanceof Value && clause.value === false,
        ),
      ).toBe(true)
    }
  })

  test(`a namespace predicate stays outside a nullable source`, () => {
    const collection = inertCollection(`residual-namespace`)
    const query: QueryIR = {
      from: new CollectionRef(collection, `team`),
      join: [
        {
          type: `left`,
          from: new CollectionRef(collection, `member`),
          on: new Func('eq', [
            new PropRef([`team`, `id`]),
            new PropRef([`member`, `teamId`]),
          ]),
        },
      ],
      where: [
        predicate(`team`, `active`, true),
        new Func(`isUndefined`, [new PropRef([`member`])]),
      ],
    }

    const result = optimizeQuery(query)
    expect([...result.sourceWhereClauses.keys()]).toEqual([`team`])
    for (const actual of [
      result.optimizedQuery,
      optimizeQuery(result.optimizedQuery).optimizedQuery,
    ]) {
      expect(sourceTerms(actual.from)).toEqual(
        expectedTerms([`team.active=true`], false),
      )
      expect(sourceTerms(actual.join![0]!.from)).toEqual([])
      expect(observedTerms(actual.where)).toEqual([
        { key: `isUndefined(member)`, residual: false },
        { key: `team.active=true`, residual: true },
      ])
    }
  })

  for (const laterJoin of [`right`, `full`] as const) {
    test(`a later ${laterJoin} join keeps earlier aliases nullable`, () => {
      const collection = inertCollection(`residual-later-${laterJoin}`)
      const query: QueryIR = {
        from: new CollectionRef(collection, `team`),
        join: [
          {
            type: `left`,
            from: new CollectionRef(collection, `member`),
            on: new Func('eq', [
              new PropRef([`team`, `id`]),
              new PropRef([`member`, `teamId`]),
            ]),
          },
          {
            type: laterJoin,
            from: new CollectionRef(collection, `tag`),
            on: new Func('eq', [
              new PropRef([`team`, `id`]),
              new PropRef([`tag`, `teamId`]),
            ]),
          },
        ],
        where: [
          predicate(`team`, `active`, true),
          predicate(`member`, `userId`, 100),
          predicate(`tag`, `region`, `west`),
        ],
      }

      const result = optimizeQuery(query)
      expect([...result.sourceWhereClauses.keys()]).toEqual(
        laterJoin === `right` ? [`tag`] : [],
      )
      for (const actual of [
        result.optimizedQuery,
        optimizeQuery(result.optimizedQuery).optimizedQuery,
      ]) {
        expect(sourceTerms(actual.from)).toEqual([])
        expect(sourceTerms(actual.join![0]!.from)).toEqual([])
        expect(sourceTerms(actual.join![1]!.from)).toEqual(
          laterJoin === `right`
            ? expectedTerms([`tag.region="west"`], false)
            : [],
        )
        expect(observedTerms(actual.where)).toEqual([
          { key: `member.userId=100`, residual: false },
          { key: `tag.region="west"`, residual: laterJoin === `right` },
          { key: `team.active=true`, residual: false },
        ])
      }
    })
  }

  test(`an ordered QueryRef that declines pushdown keeps its outer predicate`, () => {
    const collection = inertCollection(`residual-declined-queryref`)
    const query: QueryIR = {
      from: new QueryRef(
        {
          from: new CollectionRef(collection, `team`),
          orderBy: [
            {
              expression: new PropRef([`team`, `id`]),
              compareOptions: {
                direction: `desc`,
                nulls: `first`,
                stringSort: `locale`,
              },
            },
          ],
          limit: 1,
        },
        `team`,
      ),
      join: [
        {
          type: `left`,
          from: new CollectionRef(collection, `member`),
          on: new Func('eq', [
            new PropRef([`team`, `id`]),
            new PropRef([`member`, `teamId`]),
          ]),
        },
      ],
      where: [
        predicate(`team`, `active`, true),
        predicate(`member`, `userId`, 100),
      ],
    }

    const result = optimizeQuery(query)
    expect(result.sourceWhereClauses.size).toBe(0)
    for (const actual of [
      result.optimizedQuery,
      optimizeQuery(result.optimizedQuery).optimizedQuery,
    ]) {
      expect(sourceTerms(actual.from)).toEqual([])
      expect(observedTerms(actual.where)).toEqual(
        expectedTerms([`member.userId=100`, `team.active=true`], false),
      )
    }
  })

  test(`a later pass keeps existing residuals while pushing a new predicate`, () => {
    const collection = inertCollection(`residual-later-pass`)
    const prior = predicate(`team`, `region`, `west`)
    const newlyPushable = predicate(`team`, `active`, true)
    const nullable = predicate(`member`, `userId`, 100)
    const query: QueryIR = {
      from: new QueryRef(
        { from: new CollectionRef(collection, `team`), where: [prior] },
        `team`,
      ),
      join: [
        {
          type: `left`,
          from: new CollectionRef(collection, `member`),
          on: new Func('eq', [
            new PropRef([`team`, `id`]),
            new PropRef([`member`, `teamId`]),
          ]),
        },
      ],
      where: [createResidualWhere(prior), nullable, newlyPushable],
    }
    const optimized = optimizeQuery(query).optimizedQuery
    for (const actual of [optimized, optimizeQuery(optimized).optimizedQuery]) {
      expect(sourceTerms(actual.from)).toEqual(
        expectedTerms([`team.active=true`, `team.region="west"`], false),
      )
      expect(observedTerms(actual.where)).toEqual([
        { key: `member.userId=100`, residual: false },
        { key: `team.active=true`, residual: true },
        { key: `team.region="west"`, residual: true },
      ])
      expect(actual.where).toHaveLength(2)
    }
  })

  test(`a source-free false predicate publishes no joined rows`, () => {
    const teamCollection = createCollection(
      mockSyncCollectionOptions<Team>({
        id: `optimizer-residual-constant-team`,
        getKey: (row) => row.id,
        initialData: teams,
      }),
    )
    const memberCollection = createCollection(
      mockSyncCollectionOptions<Member>({
        id: `optimizer-residual-constant-member`,
        getKey: (row) => row.id,
        initialData: members,
      }),
    )
    const result = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ team: teamCollection })
          .leftJoin({ member: memberCollection }, ({ team, member }) =>
            eq(team.id, member.teamId),
          )
          .where(({ team }) => eq(team.active, true))
          .where(() => new Value(false)),
    })

    expect(result.toArray).toEqual([])
  })
})
