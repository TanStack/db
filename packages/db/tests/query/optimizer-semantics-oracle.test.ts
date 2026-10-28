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
 * control. A global aggregate cannot select a source field that is not
 * aggregated (that throws), so its `k` field is `max(b.k)`, which is 2 here.
 * A predicate on `k` pushed to source rows would filter them and change the
 * total. The rejecting predicate distinguishes filtering after aggregation
 * from dropping the predicate altogether.
 * An inner join has a separate boundary: the global aggregate joins when its
 * computed total matches an anchor. A materialized aggregate Collection
 * supplies a second formulation for matching and nonmatching controls.
 * The fixed matching and nonmatching scenarios are ordinary tests in
 * optimizer-semantics.test.ts.
 * The nested matching cases also reject an all-empty QueryRef implementation.
 */

import { describe, expect, test } from 'vitest'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { optimizeQuery } from '../../src/query/optimizer.js'
import {
  add,
  caseWhen,
  eq,
  isUndefined,
  max,
  or,
  sum,
} from '../../src/query/builder/functions.js'
import { CollectionRef, Func, PropRef } from '../../src/query/ir.js'
import { declareOracle } from '../oracle-declaration.js'
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
import type { QueryIR, Where } from '../../src/query/ir.js'

describe('optimizer aggregate semantics', () => {
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
      const expected = expectedAggregateTotals(shape, rows)

      const aggregate = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q.from({ b: source }).select(({ b }) => ({
            k: max(b.k),
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
      expect(aggregate.toArray.map(stripVirtualProps)).toEqual(
        expected.map((row) => ({ k: 2, ...row })),
      )

      const materialized = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ s: aggregate })
            .leftJoin({ a: anchor }, ({ s, a }) => eq(s.total, a.target))
            .where(({ s }) => eq(s.k, 2))
            .select(({ s }) => ({ total: s.total })),
      })
      expect(materialized.toArray.map(stripVirtualProps)).toEqual(expected)

      for (const outerPredicate of [`accept`, `reject`] as const) {
        const nested = createLiveQueryCollection({
          startSync: true,
          query: (q) => {
            const summary = q.from({ b: source }).select(({ b }) => ({
              k: max(b.k),
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
                outerPredicate === `accept` ? eq(s.k, 2) : eq(s.k, 1),
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

  // A literal field of an aggregate subquery has one value for every group,
  // but no source row holds it. Under a join the optimizer pushes outer
  // predicates toward sources; one on a literal field must stay outside the
  // aggregate subquery, where it would remove every source row.
  test('literal-field filtering keeps each aggregate whole under a left join', () => {
    const source = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `optimizer-literal-source`,
        getKey: (row) => row.id,
        initialData: rows,
      }),
    )
    const anchor = createCollection(
      mockSyncCollectionOptions({
        id: `optimizer-literal-anchor`,
        getKey: (row: { id: number; target: number }) => row.id,
        initialData: [{ id: 1, target: 1 }],
      }),
    )
    for (const grouped of [false, true]) {
      const query = createLiveQueryCollection({
        startSync: true,
        query: (q) => {
          const base = q.from({ b: source })
          const summary = grouped
            ? base
                .groupBy(({ b }) => b.k)
                .select(({ b }) => ({ k: b.k, tag: `x`, total: sum(b.v) }))
            : base.select(({ b }) => ({ k: 1, tag: `x`, total: sum(b.v) }))
          return q
            .from({ s: summary })
            .leftJoin({ a: anchor }, ({ s, a }) => eq(s.k, a.target))
            .where(({ s }) => eq(s.tag, `x`))
            .select(({ s }) => ({ k: s.k, total: s.total }))
        },
      })
      expect(
        query.toArray
          .map(stripVirtualProps)
          .sort((a: any, b: any) => (a.k < b.k ? -1 : 1)),
        grouped ? `grouped` : `single group`,
      ).toEqual(expectedLiteralFieldRows(grouped, rows))
    }
  })

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
    expect(grouped.toArray.map(stripVirtualProps)).toEqual(
      expectedGroupKeyRows(rows),
    )
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
 * greater-than, nullable-field and namespace-only isUndefined controls; then
 * a LEFT/INNER chain with two distinct pushable sources and chains ending in
 * RIGHT/FULL. A source-free false clause and an ordered QueryRef that declines
 * pushdown check preservation of regular predicates. Re-optimizing output
 * checks the later-pass boundary. The public driver includes matched and
 * unmatched rows, an OR predicate that accepts an unmatched row, and a
 * source-free false predicate that rejects every row. The fixed source-free,
 * namespace, ordered-QueryRef, and later-pass witnesses are ordinary tests in
 * optimizer-semantics.test.ts.
 *
 * The structural checkpoint is `optimizeQuery` return: each source and outer
 * predicate has its expected exact multiplicity and marker, and the extracted
 * source clauses exclude nullable sources. The public
 * checkpoint is the first synchronous live-query Collection snapshot. These
 * checks do not claim incremental histories, arbitrary functions, UNIONs, or
 * a maximum wall-clock runtime.
 */

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
            const teamKeys = [`team.active=true`]
            const memberKeys = [`member.userId=100`]
            const clauses = [
              predicate(`team`, `active`, true),
              predicate(`member`, `userId`, 100),
            ]
            if (twoActive) {
              if (join.type === `right`) {
                memberKeys.push(`member.role="admin"`)
                clauses.push(predicate(`member`, `role`, `admin`))
              } else {
                teamKeys.push(`team.region="west"`)
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
                  on: new Func('eq', [
                    new PropRef([`team`, `id`]),
                    new PropRef([`member`, `teamId`]),
                  ]),
                },
              ],
              where,
            }

            const result = optimizeQuery(query)
            const optimized = result.optimizedQuery
            const shape = expectedPushdownShape(join, teamKeys, memberKeys)
            expect([...result.sourceWhereClauses.keys()].sort()).toEqual(
              shape.sourceAliases,
            )
            for (const [alias, keys] of [
              [`team`, teamKeys],
              [`member`, memberKeys],
            ] as const) {
              const clause = result.sourceWhereClauses.get(alias)
              if (clause) {
                expect(observedTerms([clause])).toEqual(
                  expectedTerms(keys, false),
                )
              }
            }
            const laterPass = optimizeQuery(optimized).optimizedQuery
            for (const actual of [optimized, laterPass]) {
              expect(sourceTerms(actual.from)).toEqual(shape.teamSource)
              expect(sourceTerms(actual.join![0]!.from)).toEqual(
                shape.memberSource,
              )
              expect(observedTerms(actual.where)).toEqual(shape.where)
              expect(actual.where).toHaveLength(shape.whereLength)
            }
          })
        }
      }
    }
  }

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

      const expected = expectedPreservedJoinRows(joinType, teams, members)

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

    const expected = expectedChainRows(teams, members, tags)

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

/**
 * The aggregate law: a nested global aggregate publishes one total row, and an
 * accepting outer predicate keeps it. The caseWhenCondition shape publishes the
 * condition's value, 1, rather than the total.
 */
function expectedAggregateTotals(shape: string, sourceRows: Array<Row>) {
  const modelTotal = sourceRows.reduce((total, row) => total + row.v, 0)
  return [{ total: shape === `caseWhenCondition` ? 1 : modelTotal }]
}

/**
 * The literal-field law: a literal select field has one value per group, so a
 * predicate on it stays outside the aggregate. Ungrouped, the one row sums the
 * whole source.
 */
function expectedLiteralFieldRows(grouped: boolean, sourceRows: Array<Row>) {
  const total = (filter: (row: Row) => boolean) =>
    sourceRows.filter(filter).reduce((n, row) => n + row.v, 0)
  const keys = [...new Set(sourceRows.map((row) => row.k))].sort((a, b) =>
    a < b ? -1 : 1,
  )
  return grouped
    ? keys.map((k) => ({ k, total: total((row) => row.k === k) }))
    : [{ k: 1, total: total(() => true) }]
}

/** The group-key law: filtering on the grouping key keeps that group's total. */
function expectedGroupKeyRows(sourceRows: Array<Row>) {
  return [
    {
      k: 1,
      total: sourceRows
        .filter((row) => row.k === 1)
        .reduce((n, row) => n + row.v, 0),
    },
  ]
}

type JoinRole = {
  readonly type: string
  readonly teamPush: boolean
  readonly memberPush: boolean
  readonly residual: boolean
}

/**
 * The pushdown law: a side's predicates enter its source only when that side
 * is nonnullable. A residual copy stays in the outer WHERE where the join keeps
 * it. The predicate multiset is the same before and after each pass.
 */
function expectedPushdownShape(
  join: JoinRole,
  teamKeys: Array<string>,
  memberKeys: Array<string>,
) {
  return {
    sourceAliases: [
      ...(join.teamPush ? [`team`] : []),
      ...(join.memberPush ? [`member`] : []),
    ].sort(),
    teamSource: join.teamPush ? expectedTerms(teamKeys, false) : [],
    memberSource: join.memberPush ? expectedTerms(memberKeys, false) : [],
    where: [
      ...(!join.teamPush || join.residual
        ? expectedTerms(teamKeys, join.teamPush)
        : []),
      ...(!join.memberPush || join.residual
        ? expectedTerms(memberKeys, join.memberPush)
        : []),
    ].sort((a, b) => a.key.localeCompare(b.key)),
    whereLength: join.type === `inner` ? 0 : join.type === `full` ? 1 : 2,
  }
}

/**
 * The preserved-join law: the model joins the arrays fully, including the
 * unmatched preserved side, then applies the WHERE rule to each joined occurrence.
 */
function expectedPreservedJoinRows(
  joinType: `left` | `right`,
  teamRows: Array<Team>,
  memberRows: Array<Member>,
) {
  const pairs: Array<{ team?: Team; member?: Member }> = []
  for (const team of teamRows) {
    const matching = memberRows.filter((member) => member.teamId === team.id)
    for (const member of matching) pairs.push({ team, member })
    if (matching.length === 0 && joinType === `left`) pairs.push({ team })
  }
  if (joinType === `right`) {
    for (const member of memberRows) {
      if (teamRows.every((team) => team.id !== member.teamId)) {
        pairs.push({ member })
      }
    }
  }
  return pairs
    .filter(({ team, member }) =>
      joinType === `left`
        ? team?.active === true &&
          (member === undefined || member.userId === 100)
        : member?.userId === 100 &&
          (team === undefined || team.active === true),
    )
    .map(({ team, member }) => [team?.id ?? null, member?.id ?? null])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

/**
 * The chain law: a left join of memberRows and an inner join of tags keep a team
 * with no accepted member as one row with a null member.
 */
function expectedChainRows(
  teamRows: Array<Team>,
  memberRows: Array<Member>,
  tags: Array<{ id: number; teamId: number; region: string }>,
) {
  return teamRows
    .flatMap((team) => {
      if (!team.active) return []
      const matchingMembers = memberRows.filter(
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
}

declareOracle({
  model: [
    expectedAggregateTotals,
    expectedLiteralFieldRows,
    expectedGroupKeyRows,
    expectedPushdownShape,
    expectedPreservedJoinRows,
    expectedChainRows,
  ],
})
