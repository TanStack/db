/**
 * An outer predicate on an aggregate subquery's result must run after the
 * aggregate. Moving it to source rows can change or remove the result.
 *
 * Model: recompute the global total from source rows, then apply the outer
 * predicate to the projected aggregate row. A materialized Collection checks
 * this model through the public query API. The production driver nests the
 * same aggregate under a left join so predicate pushdown is eligible. Both
 * queries are observed at the first public snapshot after synchronous sync.
 *
 * Grammar: direct, arithmetic-wrapped, conditional-branch, and
 * conditional-default global aggregates. The nested query crosses each shape
 * with an accepting and rejecting outer predicate; a grouped query is the
 * control. The model's missing `k` field represents the current global
 * aggregate projection, which omits fields that are not group keys. The
 * rejecting predicate distinguishes filtering after aggregation from dropping
 * the predicate altogether.
 * An inner join has a separate boundary: the global aggregate joins when its
 * computed total matches an anchor. A materialized aggregate Collection
 * supplies a second formulation for matching and nonmatching controls.
 * The nested matching cases also reject an all-empty QueryRef implementation.
 */
import { describe, expect, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { optimizeQuery } from '../../src/query/optimizer.js'
import {
  add,
  caseWhen,
  eq,
  isUndefined,
  or,
  sum,
} from '../../src/query/builder/functions.js'
import {
  CollectionRef,
  Func,
  PropRef,
  QueryRef,
  Value,
  createResidualWhere,
} from '../../src/query/ir.js'
import { mockSyncCollectionOptions, stripVirtualProps } from '../utils.js'
import type { CollectionImpl } from '../../src/collection/index.js'
import type {
  BasicExpression,
  From,
  QueryIR,
  Where,
} from '../../src/query/ir.js'

type Row = { id: number; k: number; v: number }

const rows: Array<Row> = [
  { id: 1, k: 1, v: 10 },
  { id: 2, k: 2, v: 20 },
]

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
            k: b.k,
            total: sum(b.v),
          }))
          const joined = q
            .from({ s: summary })
            .innerJoin({ a: anchor }, ({ s, a }) => eq(s.total, a.target))
          if (scenario.filter === `accept`) {
            return joined
              .where(({ s }) => isUndefined(s.k))
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

  for (const shape of [
    `direct`,
    `wrapped`,
    `caseWhenCondition`,
    `caseWhenDefault`,
  ] as const) {
    test(`${shape} global aggregate keeps post-aggregate filtering`, () => {
      const source = createCollection(
        mockSyncCollectionOptions<Row>({
          id: `optimizer-aggregate-source-${shape}`,
          getKey: (row) => row.id,
          initialData: rows,
        }),
      )
      const anchor = createCollection(
        mockSyncCollectionOptions({
          id: `optimizer-aggregate-anchor-${shape}`,
          getKey: (row: { id: number; target: number }) => row.id,
          initialData: [{ id: 1, target: 30 }],
        }),
      )
      const modelTotal = rows.reduce((total, row) => total + row.v, 0)
      const expected = [
        { total: shape === `caseWhenCondition` ? 1 : modelTotal },
      ]

      const aggregate = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q.from({ b: source }).select(({ b }) => ({
            k: b.k,
            total:
              shape === `direct`
                ? sum(b.v)
                : shape === `wrapped`
                  ? add(sum(b.v), 0)
                  : shape === `caseWhenCondition`
                    ? caseWhen(eq(sum(b.v), modelTotal), 1, 0)
                    : caseWhen(eq(1, 2), 0, sum(b.v)),
          })),
      })
      expect(aggregate.toArray.map(stripVirtualProps)).toEqual(expected)

      const materialized = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ s: aggregate })
            .leftJoin({ a: anchor }, ({ s, a }) => eq(s.total, a.target))
            .where(({ s }) => isUndefined(s.k))
            .select(({ s }) => ({ total: s.total })),
      })
      expect(materialized.toArray.map(stripVirtualProps)).toEqual(expected)

      for (const outerPredicate of [`accept`, `reject`] as const) {
        const nested = createLiveQueryCollection({
          startSync: true,
          query: (q) => {
            const summary = q.from({ b: source }).select(({ b }) => ({
              k: b.k,
              total:
                shape === `direct`
                  ? sum(b.v)
                  : shape === `wrapped`
                    ? add(sum(b.v), 0)
                    : shape === `caseWhenCondition`
                      ? caseWhen(eq(sum(b.v), modelTotal), 1, 0)
                      : caseWhen(eq(1, 2), 0, sum(b.v)),
            }))
            return q
              .from({ s: summary })
              .leftJoin({ a: anchor }, ({ s, a }) => eq(s.total, a.target))
              .where(({ s }) =>
                outerPredicate === `accept` ? isUndefined(s.k) : eq(s.k, 1),
              )
              .select(({ s }) => ({ total: s.total }))
          },
        })
        expect(nested.toArray.map(stripVirtualProps)).toEqual(
          outerPredicate === `accept` ? expected : [],
        )
      }
    })
  }

  test('group-key filtering keeps each grouped aggregate under a left join', () => {
    const source = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `optimizer-grouped-source`,
        getKey: (row) => row.id,
        initialData: rows,
      }),
    )
    const anchor = createCollection(
      mockSyncCollectionOptions({
        id: `optimizer-grouped-anchor`,
        getKey: (row: { id: number; target: number }) => row.id,
        initialData: [{ id: 1, target: 1 }],
      }),
    )
    const grouped = createLiveQueryCollection({
      startSync: true,
      query: (q) => {
        const summary = q
          .from({ b: source })
          .groupBy(({ b }) => b.k)
          .select(({ b }) => ({ k: b.k, total: add(sum(b.v), 0) }))
        return q
          .from({ s: summary })
          .leftJoin({ a: anchor }, ({ s, a }) => eq(s.k, a.target))
          .where(({ s }) => eq(s.k, 1))
          .select(({ s }) => ({ k: s.k, total: s.total }))
      },
    })
    expect(grouped.toArray.map(stripVirtualProps)).toEqual([
      {
        k: 1,
        total: rows
          .filter((row) => row.k === 1)
          .reduce((n, row) => n + row.v, 0),
      },
    ])
  })
})

/**
 * A predicate may enter a nonnullable source once. An outer join still applies
 * that predicate to the joined row, so its outer copy stays residual. A
 * nullable-side predicate stays regular and must not enter its source. This
 * follows the optimizer's stated predicate-pushdown and outer-join contract.
 *
 * Model: the table below states each join side's relational role. It does not
 * use the optimizer's nullable-source classifier. `observedTerms` only reads
 * the output IR; it retains duplicate predicates and residual markers. Plain
 * array joins independently compute the expected first public snapshot.
 *
 * Bounded grammar: LEFT, RIGHT, INNER, and FULL joins; one or two pushable
 * equality predicates; separate WHERE clauses or one AND; both clause orders;
 * greater-than and nullable-field isUndefined controls; then a LEFT/INNER
 * chain with two distinct pushable sources. Re-optimizing output checks the
 * later-pass boundary. The public driver includes matched and unmatched rows
 * and an OR predicate that accepts an unmatched row.
 *
 * The structural checkpoint is `optimizeQuery` return: each source and outer
 * predicate has its expected exact multiplicity and marker. The public
 * checkpoint is the first synchronous live-query Collection snapshot. These
 * checks do not claim incremental histories, arbitrary functions, UNIONs, or
 * a maximum wall-clock runtime.
 */
type ObservedTerm = { key: string; residual: boolean }

function observedTerms(where: Array<Where> | undefined): Array<ObservedTerm> {
  const terms: Array<ObservedTerm> = []
  for (const clause of where ?? []) {
    const residual = `expression` in clause && clause.residual === true
    const expression = `expression` in clause ? clause.expression : clause
    const visit = (current: BasicExpression): void => {
      if (current instanceof Func && current.name === `and`) {
        current.args.forEach(visit)
        return
      }
      if (current instanceof Func && current.name === `or`) {
        const keys = current.args.map((arg) => {
          if (
            !(arg instanceof Func) ||
            arg.name !== `eq` ||
            !(arg.args[0] instanceof PropRef)
          ) {
            throw new Error(`Unexpected OR term in residual oracle`)
          }
          return arg.args[0].path.join(`.`)
        })
        terms.push({ key: `or(${keys.join(`,`)})`, residual })
        return
      }
      if (
        !(current instanceof Func) ||
        ![`eq`, `gt`, `isUndefined`].includes(current.name) ||
        !(current.args[0] instanceof PropRef)
      ) {
        throw new Error(`Unexpected optimizer predicate in residual oracle`)
      }
      const key = current.args[0].path.join(`.`)
      const comparedRef = current.args[1]
      terms.push({
        key:
          current.name !== `eq`
            ? `${current.name}(${key})`
            : comparedRef instanceof PropRef
              ? `${key}=${comparedRef.path.join(`.`)}`
              : key,
        residual,
      })
    }
    visit(expression)
  }
  return terms.sort(
    (a, b) =>
      a.key.localeCompare(b.key) || Number(a.residual) - Number(b.residual),
  )
}

function sourceTerms(source: From): Array<ObservedTerm> {
  if (source.type === `collectionRef`) return []
  if (source.type !== `queryRef`) {
    throw new Error(`Unexpected optimizer source in residual oracle`)
  }
  return observedTerms(source.query.where)
}

function predicate(
  alias: string,
  field: string,
  value: unknown,
): Func<boolean> {
  return new Func(`eq`, [new PropRef([alias, field]), new Value(value)])
}

function inertCollection(id: string): CollectionImpl {
  // The optimizer uses Collection identity but does not read Collection methods.
  return { id } as unknown as CollectionImpl
}

function expectedTerms(
  keys: Array<string>,
  residual: boolean,
): Array<ObservedTerm> {
  return keys
    .map((key) => ({ key, residual }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

describe(`optimizer residual convergence`, () => {
  const joins = [
    { type: `left`, teamPush: true, memberPush: false, residual: true },
    { type: `right`, teamPush: false, memberPush: true, residual: true },
    { type: `inner`, teamPush: true, memberPush: true, residual: false },
    { type: `full`, teamPush: false, memberPush: false, residual: false },
  ] as const

  for (const join of joins) {
    for (const form of [`separate`, `and`] as const) {
      for (const reversed of [false, true]) {
        for (const twoActive of [false, true]) {
          test(`${join.type} ${form} reversed=${reversed} twoActive=${twoActive} preserves each predicate once`, () => {
            const teamKeys = [`team.active`]
            const memberKeys = [`member.userId`]
            const clauses = [
              predicate(`team`, `active`, true),
              predicate(`member`, `userId`, 100),
            ]
            if (twoActive) {
              if (join.type === `right`) {
                memberKeys.push(`member.role`)
                clauses.push(predicate(`member`, `role`, `admin`))
              } else {
                teamKeys.push(`team.region`)
                clauses.push(predicate(`team`, `region`, `west`))
              }
            }
            const ordered = reversed ? [...clauses].reverse() : clauses
            const where: Array<Where> =
              form === `and` ? [new Func(`and`, ordered)] : ordered
            const collection = inertCollection(`residual-oracle`)
            const query: QueryIR = {
              from: new CollectionRef(collection, `team`),
              join: [
                {
                  type: join.type,
                  from: new CollectionRef(collection, `member`),
                  left: new PropRef([`team`, `id`]),
                  right: new PropRef([`member`, `teamId`]),
                },
              ],
              where,
            }

            const optimized = optimizeQuery(query).optimizedQuery
            const laterPass = optimizeQuery(optimized).optimizedQuery
            for (const actual of [optimized, laterPass]) {
              expect(sourceTerms(actual.from)).toEqual(
                join.teamPush ? expectedTerms(teamKeys, false) : [],
              )
              expect(sourceTerms(actual.join![0]!.from)).toEqual(
                join.memberPush ? expectedTerms(memberKeys, false) : [],
              )
              expect(observedTerms(actual.where)).toEqual(
                [
                  ...(!join.teamPush || join.residual
                    ? expectedTerms(teamKeys, join.teamPush)
                    : []),
                  ...(!join.memberPush || join.residual
                    ? expectedTerms(memberKeys, join.memberPush)
                    : []),
                ].sort((a, b) => a.key.localeCompare(b.key)),
              )
              expect(actual.where).toHaveLength(
                join.type === `inner` ? 0 : join.type === `full` ? 1 : 2,
              )
            }
          })
        }
      }
    }
  }

  test(`two active sources retain both residual predicates across passes`, () => {
    const collection = inertCollection(`residual-multi-source`)
    const query: QueryIR = {
      from: new CollectionRef(collection, `team`),
      join: [
        {
          type: `left`,
          from: new CollectionRef(collection, `member`),
          left: new PropRef([`team`, `id`]),
          right: new PropRef([`member`, `teamId`]),
        },
        {
          type: `inner`,
          from: new CollectionRef(collection, `tag`),
          left: new PropRef([`team`, `id`]),
          right: new PropRef([`tag`, `teamId`]),
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
        expectedTerms([`team.active`], false),
      )
      expect(sourceTerms(actual.join![0]!.from)).toEqual([])
      expect(sourceTerms(actual.join![1]!.from)).toEqual(
        expectedTerms([`tag.region`], false),
      )
      expect(observedTerms(actual.where)).toEqual([
        { key: `member.userId`, residual: false },
        { key: `tag.region`, residual: true },
        { key: `team.active`, residual: true },
      ])
      expect(actual.where).toHaveLength(2)
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
            left: new PropRef([`team`, `id`]),
            right: new PropRef([`member`, `teamId`]),
          },
        ],
        where: [cross, active],
      }
      const optimized = optimizeQuery(query).optimizedQuery
      const activeKey = `or(${activeAlias}.active,${activeAlias}.region)`
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
      expect(optimized.where).toHaveLength(2)
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
          left: new PropRef([`team`, `id`]),
          right: new PropRef([`member`, `teamId`]),
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
        expectedTerms([`gt(team.score)`], false),
      )
      expect(sourceTerms(actual.join![0]!.from)).toEqual([])
      expect(observedTerms(actual.where)).toEqual([
        { key: `gt(team.score)`, residual: true },
        { key: `isUndefined(member.optional)`, residual: false },
      ])
      expect(actual.where).toHaveLength(2)
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
          left: new PropRef([`team`, `id`]),
          right: new PropRef([`member`, `teamId`]),
        },
      ],
      where: [createResidualWhere(prior), nullable, newlyPushable],
    }
    const optimized = optimizeQuery(query).optimizedQuery
    for (const actual of [optimized, optimizeQuery(optimized).optimizedQuery]) {
      expect(sourceTerms(actual.from)).toEqual(
        expectedTerms([`team.active`, `team.region`], false),
      )
      expect(observedTerms(actual.where)).toEqual([
        { key: `member.userId`, residual: false },
        { key: `team.active`, residual: true },
        { key: `team.region`, residual: true },
      ])
      expect(actual.where).toHaveLength(2)
    }
  })

  type Team = { id: number; active: boolean }
  type Member = { id: number; teamId: number; userId: number }
  const teams: Array<Team> = [
    { id: 1, active: true },
    { id: 2, active: false },
    { id: 3, active: true },
  ]
  const members: Array<Member> = [
    { id: 10, teamId: 1, userId: 100 },
    { id: 11, teamId: 1, userId: 200 },
    { id: 12, teamId: 2, userId: 100 },
    { id: 13, teamId: 4, userId: 100 },
  ]

  for (const joinType of [`left`, `right`] as const) {
    test(`${joinType} join publishes the independently joined rows`, () => {
      const teamCollection = createCollection(
        mockSyncCollectionOptions<Team>({
          id: `optimizer-residual-${joinType}-teams`,
          getKey: (row) => row.id,
          initialData: teams,
        }),
      )
      const memberCollection = createCollection(
        mockSyncCollectionOptions<Member>({
          id: `optimizer-residual-${joinType}-members`,
          getKey: (row) => row.id,
          initialData: members,
        }),
      )

      // The model fully joins arrays, including the unmatched preserved side,
      // then applies the WHERE rule to each joined occurrence.
      const pairs: Array<{ team?: Team; member?: Member }> = []
      for (const team of teams) {
        const matching = members.filter((member) => member.teamId === team.id)
        for (const member of matching) pairs.push({ team, member })
        if (matching.length === 0 && joinType === `left`) pairs.push({ team })
      }
      if (joinType === `right`) {
        for (const member of members) {
          if (teams.every((team) => team.id !== member.teamId)) {
            pairs.push({ member })
          }
        }
      }
      const expected = pairs
        .filter(({ team, member }) =>
          joinType === `left`
            ? team?.active === true &&
              (member === undefined || member.userId === 100)
            : member?.userId === 100 &&
              (team === undefined || team.active === true),
        )
        .map(({ team, member }) => [team?.id ?? null, member?.id ?? null])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))

      const result =
        joinType === `left`
          ? createLiveQueryCollection({
              startSync: true,
              query: (q) =>
                q
                  .from({ team: teamCollection })
                  .leftJoin({ member: memberCollection }, ({ team, member }) =>
                    eq(team.id, member.teamId),
                  )
                  .where(({ team }) => eq(team.active, true))
                  .where(({ member }) =>
                    or(isUndefined(member.id), eq(member.userId, 100)),
                  )
                  .select(({ team, member }) => ({
                    teamId: team.id,
                    memberId: member.id,
                  })),
            })
          : createLiveQueryCollection({
              startSync: true,
              query: (q) =>
                q
                  .from({ team: teamCollection })
                  .rightJoin({ member: memberCollection }, ({ team, member }) =>
                    eq(team.id, member.teamId),
                  )
                  .where(({ member }) => eq(member.userId, 100))
                  .where(({ team }) =>
                    or(isUndefined(team.id), eq(team.active, true)),
                  )
                  .select(({ team, member }) => ({
                    teamId: team.id,
                    memberId: member.id,
                  })),
            })
      const actual = result.toArray
        .map(stripVirtualProps)
        .map((row) => {
          if (row === undefined) throw new Error(`Missing joined result row`)
          return [row.teamId ?? null, row.memberId ?? null]
        })
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      expect(actual).toEqual(expected)
    })
  }

  test(`two active sources publish the independently joined rows`, () => {
    const tags = [
      { id: 20, teamId: 1, region: `west` },
      { id: 21, teamId: 2, region: `west` },
      { id: 22, teamId: 3, region: `west` },
      { id: 23, teamId: 3, region: `east` },
    ]
    const teamCollection = createCollection(
      mockSyncCollectionOptions<Team>({
        id: `optimizer-residual-chain-teams`,
        getKey: (row) => row.id,
        initialData: teams,
      }),
    )
    const memberCollection = createCollection(
      mockSyncCollectionOptions<Member>({
        id: `optimizer-residual-chain-members`,
        getKey: (row) => row.id,
        initialData: members,
      }),
    )
    const tagCollection = createCollection(
      mockSyncCollectionOptions({
        id: `optimizer-residual-chain-tags`,
        getKey: (row: (typeof tags)[number]) => row.id,
        initialData: tags,
      }),
    )

    const expected = teams
      .flatMap((team) => {
        if (!team.active) return []
        const matchingMembers = members.filter(
          (member) => member.teamId === team.id,
        )
        const acceptedMembers = matchingMembers.length
          ? matchingMembers.filter((member) => member.userId === 100)
          : [undefined]
        return tags
          .filter((tag) => tag.teamId === team.id && tag.region === `west`)
          .flatMap((tag) =>
            acceptedMembers.map((member) => [
              team.id,
              member?.id ?? null,
              tag.id,
            ]),
          )
      })
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))

    const result = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ team: teamCollection })
          .leftJoin({ member: memberCollection }, ({ team, member }) =>
            eq(team.id, member.teamId),
          )
          .innerJoin({ tag: tagCollection }, ({ team, tag }) =>
            eq(team.id, tag.teamId),
          )
          .where(({ member }) =>
            or(isUndefined(member.id), eq(member.userId, 100)),
          )
          .where(({ team }) => eq(team.active, true))
          .where(({ tag }) => eq(tag.region, `west`))
          .select(({ team, member, tag }) => ({
            teamId: team.id,
            memberId: member.id,
            tagId: tag.id,
          })),
    })
    const actual = result.toArray
      .map(stripVirtualProps)
      .map((row) => {
        return [row.teamId, row.memberId ?? null, row.tagId]
      })
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    expect(actual).toEqual(expected)
  })
})
