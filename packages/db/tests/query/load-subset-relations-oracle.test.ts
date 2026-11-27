/**
 * # A joined-filter window forwards its filter as a relation hint
 *
 * ## Contract
 *
 * Issue #2124: `LoadSubsetOptions.relations` is an optional hint. An adapter
 * may apply it and return only the root rows that pass, or ignore it and
 * return a superset, and it must never drop a root row that passes. Local
 * evaluation stays authoritative, so both choices publish the same window. A
 * relation-filtered load never shares a demand key with the same load without
 * the hint.
 *
 * A hint is sent only when it carries the whole joined filter. An existence
 * check maps to `some` or `none`. A conjunct that fails on a missing joined
 * row maps to `some(where)`. One that passes on a missing row maps to
 * `none(not where)`, and only when the join is on the joined collection's key,
 * because with several related rows `none(not p)` is not the same filter.
 *
 * An applying adapter keeps its answer current as related rows change. A local
 * write on a joined row is not the provider's, so no load carries the hint
 * while one is pending, and the window reads its prefix again without it.
 *
 * ## Limits
 *
 * The cells cross nine filter kinds with an adapter that applies or ignores the
 * hint, over one window on direct LEFT joins to a collection. One changed
 * owner moves a root row into or out of a window, by a local write before or
 * after the load or a synced change. Joins through
 * subqueries, `or` under a relation and unlimited queries are not hinted.
 *
 * ## Model
 *
 * `passes` evaluates each filter kind over plain fixture rows. `expectedHint`
 * states the relation each kind must send. The adapter applies a hint with its
 * own semi-join over the fixture.
 *
 * ## Production path and observation
 *
 * The driver runs a live query and observes its public rows, the options that
 * reach the root collection's `loadSubset`, and how many root rows it wrote.
 */
import { describe, expect } from 'vitest'
import { D2 } from '@tanstack/db-ivm'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import {
  Query,
  and,
  compileQuery,
  createLiveQueryCollection,
  eq,
  gte,
  isUndefined,
  not,
  or,
} from '../../src/query/index.js'
import { compileSingleRowExpression } from '../../src/query/compiler/evaluators.js'
import { getQueryIR } from '../../src/query/builder/index.js'
import { Func, PropRef, Value } from '../../src/query/ir.js'
import { getLoadSubsetDemandKey } from '../../src/query/ir-stable-identity.js'
import { oracleProperty } from '../oracle-config.js'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../oracle-assertion-adapter.js'
import type { Collection } from '../../src/collection/index.js'
import type { InitialQueryBuilder } from '../../src/query/builder/index.js'
import type { OrderByOptimizationInfo } from '../../src/query/compiler/order-by.js'
import type { BasicExpression, QueryIR } from '../../src/query/ir.js'
import type { LoadSubsetOptions, SyncConfig } from '../../src/types.js'

type Seek = { id: number; rank: number; ownerId: number }
type Owner = { id: number; ref: number; active: boolean; note?: string }
type Relation = {
  quantifier: `some` | `none`
  collectionId: string
  on: { parent: Array<string>; child: Array<string> }
  where?: BasicExpression<boolean>
}
type OptionsWithRelations = LoadSubsetOptions & { relations?: Array<Relation> }

const seeks: Array<Seek> = Array.from({ length: 36 }, (_, id) => ({
  id,
  rank: 100 - id,
  ownerId: id,
}))
const owners: Array<Owner> = seeks
  .filter(({ id }) => id % 3 !== 2)
  .map(({ id }) => ({
    id,
    ref: id,
    active: id % 2 === 0,
    ...(id % 4 === 0 ? { note: `kept` } : {}),
  }))

const kinds = [
  `exists`,
  `missing`,
  `match`,
  `passes-missing`,
  `passes-missing-off-key`,
  `mixed`,
  `partial`,
  `with-root-filter`,
  `field-undefined`,
] as const
const relationCases = kinds.flatMap((kind) =>
  [true, false].map((applied) => ({ kind, applied })),
)
type RelationCase = (typeof relationCases)[number]

function passes(kind: RelationCase[`kind`], seek: Seek): boolean {
  const owner = owners.find(({ id }) => id === seek.ownerId)
  switch (kind) {
    case `exists`:
      return owner !== undefined
    case `missing`:
      return owner === undefined
    case `match`:
      return owner?.active === true
    case `passes-missing`:
    case `passes-missing-off-key`:
      return owner === undefined || owner.active
    case `mixed`:
      return seek.id === 0 || owner?.active === true
    case `partial`:
    case `with-root-filter`:
      return owner?.active === true
    case `field-undefined`:
      return owner === undefined || owner.note === undefined
  }
}

function expectedHint(kind: RelationCase[`kind`]) {
  const on = { parent: [`ownerId`], child: [`id`] }
  switch (kind) {
    case `exists`:
      return { quantifier: `some`, on, filtered: false }
    case `missing`:
      return { quantifier: `none`, on, filtered: false }
    case `match`:
    case `with-root-filter`:
      return { quantifier: `some`, on, filtered: true }
    case `passes-missing`:
    case `field-undefined`:
      return { quantifier: `none`, on, filtered: true }
    default:
      return undefined
  }
}

// The adapter's own semi-join: keeps a root row when the hint's related rows
// satisfy its quantifier.
function satisfies(
  seek: Seek,
  relation: Relation,
  ownerRows: ReadonlyArray<Owner> = owners,
): boolean {
  const where = relation.where
    ? compileSingleRowExpression(relation.where)
    : undefined
  const related = ownerRows.filter(
    (owner) =>
      owner[relation.on.child[0] as keyof Owner] ===
        seek[relation.on.parent[0] as keyof Seek] &&
      (!where || where(owner) === true),
  )
  return relation.quantifier === `some`
    ? related.length > 0
    : related.length === 0
}

async function runRelationCell(cell: RelationCase): Promise<void> {
  const name = `load-subset-relations-${cell.kind}-${cell.applied}`
  const loads: Array<OptionsWithRelations> = []
  const delivered = new Set<number>()
  const root = createCollection<Seek>({
    id: `${name}-root`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        markReady()
        return {
          loadSubset: (options: OptionsWithRelations) => {
            loads.push(options)
            const where = options.where
              ? compileSingleRowExpression(options.where)
              : undefined
            const from = options.cursor
              ? compileSingleRowExpression(options.cursor.whereFrom)
              : undefined
            const hints = cell.applied ? (options.relations ?? []) : []
            const offset = from ? 0 : (options.offset ?? 0)
            const answer = [...seeks]
              .sort((a, b) => b.rank - a.rank)
              .filter(
                (row) =>
                  (!where || where(row) === true) &&
                  (!from || from(row) === true) &&
                  hints.every((hint) => satisfies(row, hint)),
              )
              .slice(
                offset,
                options.limit === undefined
                  ? undefined
                  : offset + options.limit,
              )
            begin()
            for (const row of answer) {
              if (delivered.has(row.id)) continue
              delivered.add(row.id)
              write({ type: `insert`, value: { ...row } })
            }
            const receipt = commit()
            return receipt === true ? Promise.resolve() : receipt
          },
        }
      },
    },
  })
  const joined = createCollection<Owner>({
    id: `${name}-owners`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        const written = new Set<number>()
        markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            const where = options.where
              ? compileSingleRowExpression(options.where)
              : undefined
            begin()
            for (const row of owners) {
              if ((where && where(row) !== true) || written.has(row.id))
                continue
              written.add(row.id)
              write({ type: `insert`, value: { ...row } })
            }
            const receipt = commit()
            return receipt === true ? Promise.resolve() : receipt
          },
        }
      },
    },
  })
  const live = createLiveQueryCollection({
    query: ((query: InitialQueryBuilder) =>
      query
        .from({ seek: root })
        .leftJoin({ owner: joined }, ({ seek, owner }) =>
          cell.kind === `passes-missing-off-key`
            ? eq(seek.ownerId, owner.ref)
            : eq(seek.ownerId, owner.id),
        )
        .where(({ seek, owner }) => {
          switch (cell.kind) {
            case `exists`:
              return not(isUndefined(owner.id))
            case `missing`:
              return isUndefined(owner.id)
            case `match`:
              return eq(owner.active, true)
            case `mixed`:
              return or(eq(seek.id, 0), eq(owner.active, true))
            case `partial`:
              return and(
                eq(owner.active, true),
                or(eq(seek.id, 0), eq(owner.active, true)),
              )
            case `with-root-filter`:
              return and(eq(owner.active, true), gte(seek.rank, 0))
            case `field-undefined`:
              return isUndefined(owner.note)
            default:
              return or(isUndefined(owner.active), eq(owner.active, true))
          }
        })
        .orderBy(({ seek }) => seek.rank, `desc`)
        .limit(4)
        .select(({ seek }) => ({ id: seek.id }))) as never,
  }) as unknown as Collection<{ id: number }>
  try {
    await live.preload()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(
      Array.from(live.values(), ({ id }) => id),
      `published window`,
    ).toEqual(
      seeks
        .filter((seek) => passes(cell.kind, seek))
        .slice(0, 4)
        .map(({ id }) => id),
    )

    const expected = expectedHint(cell.kind)
    for (const load of loads) {
      if (!expected) {
        expect(load.relations, `no hint`).toBeUndefined()
        continue
      }
      expect(load.relations, `one relation on every load`).toHaveLength(1)
      const relation = load.relations![0]!
      expect(relation.quantifier, `quantifier`).toBe(expected.quantifier)
      expect(relation.collectionId, `related collection`).toBe(joined.id)
      expect(relation.on, `join key`).toEqual(expected.on)
      expect(relation.where !== undefined, `related filter`).toBe(
        expected.filtered,
      )
      const { relations: _relations, ...withoutHint } = load
      expect(
        getLoadSubsetDemandKey(load),
        `the hint is part of the demand key`,
      ).not.toEqual(getLoadSubsetDemandKey(withoutHint))
    }
    if (expected && cell.applied) {
      const passing = seeks.filter((seek) => passes(cell.kind, seek))
      expect(
        [...delivered].every((id) => passing.some((seek) => seek.id === id)),
        `an applied hint delivers only passing rows`,
      ).toBe(true)
    }
  } finally {
    await live.cleanup()
    await root.cleanup()
    await joined.cleanup()
  }
}

// A joined row changes after, or before, the window loads: a local write the
// provider has not seen, or a synced change that an applying adapter keeps its
// answer current with. The change moves a root row into or out of the window.
const joinedChangeCases = (
  [`local write`, `local write before load`, `synced change`] as const
).flatMap((write) =>
  ([`enters`, `leaves`] as const).flatMap((move) =>
    [true, false].map((applied) => ({ write, move, applied })),
  ),
)
type JoinedChangeCase = (typeof joinedChangeCases)[number]

async function runJoinedChangeCell(cell: JoinedChangeCase): Promise<void> {
  const name = `load-subset-relations-change-${cell.write}-${cell.move}-${cell.applied}`
  // Owner 1 is inactive and owner 0 active, so the change moves seek 1 into
  // the window or seek 0 out of it.
  const changed =
    cell.move === `enters` ? { id: 1, active: true } : { id: 0, active: false }
  const after = owners.map((owner) =>
    owner.id === changed.id ? { ...owner, active: changed.active } : owner,
  )
  let provided: ReadonlyArray<Owner> = owners
  let pendingWrite = false
  const hintedDuringWrite: Array<OptionsWithRelations> = []
  const served: Array<OptionsWithRelations> = []
  const delivered = new Set<number>()
  let rootSync!: Parameters<SyncConfig<Seek>[`sync`]>[0]
  let ownerSync!: Parameters<SyncConfig<Owner>[`sync`]>[0]
  const serve = (options: OptionsWithRelations) => {
    const where = options.where
      ? compileSingleRowExpression(options.where)
      : undefined
    const from = options.cursor
      ? compileSingleRowExpression(options.cursor.whereFrom)
      : undefined
    const hints = cell.applied ? (options.relations ?? []) : []
    const offset = from ? 0 : (options.offset ?? 0)
    const answer = [...seeks]
      .sort((a, b) => b.rank - a.rank)
      .filter(
        (row) =>
          (!where || where(row) === true) &&
          (!from || from(row) === true) &&
          hints.every((hint) => satisfies(row, hint, provided)),
      )
      .slice(
        offset,
        options.limit === undefined ? undefined : offset + options.limit,
      )
    for (const row of answer) {
      if (delivered.has(row.id)) continue
      delivered.add(row.id)
      rootSync.write({ type: `insert`, value: { ...row } })
    }
  }
  const root = createCollection<Seek>({
    id: `${name}-root`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (params) => {
        rootSync = params
        params.markReady()
        return {
          loadSubset: (options: OptionsWithRelations) => {
            if (pendingWrite && options.relations) {
              hintedDuringWrite.push(options)
            }
            served.push(options)
            params.begin()
            serve(options)
            const receipt = params.commit()
            return receipt === true ? Promise.resolve() : receipt
          },
        }
      },
    },
  })
  const joined = createCollection<Owner>({
    id: `${name}-owners`,
    getKey: (row) => row.id,
    startSync: true,
    // The write stays pending, so the provider never sees it.
    onUpdate: () => new Promise(() => {}),
    sync: {
      sync: (params) => {
        ownerSync = params
        params.begin()
        for (const owner of owners) {
          params.write({ type: `insert`, value: { ...owner } })
        }
        params.commit()
        params.markReady()
      },
    },
  })
  const change = () => {
    if (cell.write === `synced change`) {
      provided = after
      ownerSync.begin()
      ownerSync.write({
        type: `update`,
        value: { ...after.find(({ id }) => id === changed.id)! },
      })
      ownerSync.commit()
      // An applying adapter keeps its answer current with the related rows.
      rootSync.begin()
      for (const options of served) serve(options)
      rootSync.commit()
    } else {
      pendingWrite = true
      joined.update(changed.id, (draft) => {
        draft.active = changed.active
      })
    }
  }
  const live = createLiveQueryCollection({
    query: ((query: InitialQueryBuilder) =>
      query
        .from({ seek: root })
        .leftJoin({ owner: joined }, ({ seek, owner }) =>
          eq(seek.ownerId, owner.id),
        )
        .where(({ owner }) => eq(owner.active, true))
        .orderBy(({ seek }) => seek.rank, `desc`)
        .limit(4)
        .select(({ seek }) => ({ id: seek.id }))) as never,
  }) as unknown as Collection<{ id: number }>
  try {
    if (cell.write === `local write before load`) change()
    await live.preload()
    await new Promise((resolve) => setTimeout(resolve, 5))
    if (cell.write !== `local write before load`) change()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(
      Array.from(live.values(), ({ id }) => id),
      `published window`,
    ).toEqual(
      seeks
        .filter((seek) =>
          after.some((owner) => owner.id === seek.ownerId && owner.active),
        )
        .slice(0, 4)
        .map(({ id }) => id),
    )
    expect(
      hintedDuringWrite,
      `no hint while a joined row has a local write`,
    ).toEqual([])
  } finally {
    await live.cleanup()
    await root.cleanup()
    await joined.cleanup()
  }
}

// A hint narrows a demand, so two demands that differ only in a hint, or in a
// hint's related filter, are different demands.
const relationOn = { parent: [`ownerId`], child: [`id`] }
const relatedWhere = (active: boolean) =>
  new Func(`eq`, [new PropRef([`active`]), new Value(active)])
const identityCases = [
  { name: `a hint on an otherwise unconstrained load`, pair: `hint` },
  { name: `two hints that differ only in their related filter`, pair: `where` },
] as const

function demandPair(
  pair: (typeof identityCases)[number][`pair`],
): [OptionsWithRelations, OptionsWithRelations] {
  const relation = (where?: BasicExpression<boolean>) => ({
    relations: [
      {
        quantifier: `some` as const,
        collectionId: `owners`,
        on: relationOn,
        ...(where ? { where } : {}),
      },
    ],
  })
  return pair === `hint`
    ? [relation(), {}]
    : [relation(relatedWhere(true)), relation(relatedWhere(false))]
}

// One subscription serves every window compiled over a source, so a hint may
// narrow it only when every window asks for the same joined filter.
const sharedWindowCases = [
  { name: `the same joined filter`, same: true },
  { name: `different joined filters`, same: false },
]

function runSharedWindowCell({ same }: (typeof sharedWindowCases)[number]) {
  const inert = { sync: { sync: () => {} } }
  const root = createCollection<Seek>({
    id: `load-subset-relations-shared-${same}-root`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: { sync: () => ({ loadSubset: () => true }) },
  })
  const joined = createCollection<Owner>({
    id: `load-subset-relations-shared-${same}-owners`,
    getKey: (row) => row.id,
    ...inert,
  })
  const first = getQueryIR(
    new Query()
      .from({ seek: root })
      .leftJoin({ owner: joined }, ({ seek, owner }) =>
        eq(seek.ownerId, owner.id),
      )
      .where(({ owner }) => eq(owner.active, true))
      .orderBy(({ seek }) => seek.rank)
      .limit(2)
      .select(({ seek }) => ({ id: seek.id })),
  )
  const second: QueryIR = same
    ? { ...first }
    : {
        ...first,
        where: [
          new Func(`eq`, [new PropRef([`owner`, `active`]), new Value(false)]),
        ],
      }
  const graph = new D2()
  const inputs = { seek: graph.newInput(), owner: graph.newInput() }
  const plans: Record<string, OrderByOptimizationInfo> = {}
  for (const query of [first, second]) {
    compileQuery(
      query,
      inputs as never,
      { [root.id]: root, [joined.id]: joined } as never,
      {},
      {},
      new Set(),
      plans,
      () => {},
      new WeakMap(),
    )
  }
  const plan = Object.values(plans)[0]!
  expect(plan.relations !== undefined, `shared window hint`).toBe(same)
}

// A root that is itself a subquery can rename the join key, so its fields are
// not the source's. It sends no hint, and its window is still right.
async function runSubqueryRootCell(): Promise<void> {
  const loads: Array<OptionsWithRelations> = []
  const answer = <T extends object>(data: ReadonlyArray<T>) => ({
    sync: {
      sync: ({ begin, write, commit, markReady }: any) => {
        begin()
        for (const row of data) write({ type: `insert`, value: { ...row } })
        commit()
        markReady()
        return {
          loadSubset: (options: OptionsWithRelations) => {
            loads.push(options)
            return true as const
          },
        }
      },
    },
  })
  const root = createCollection<Seek>({
    id: `load-subset-relations-subquery-root`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    ...answer(seeks),
  })
  const joined = createCollection<Owner>({
    id: `load-subset-relations-subquery-owners`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    ...answer(owners),
  })
  const renamed = new Query().from({ seek: root }).select(({ seek }) => ({
    id: seek.id,
    rank: seek.rank,
    renamedOwner: seek.ownerId,
  }))
  const live = createLiveQueryCollection({
    query: ((query: InitialQueryBuilder) =>
      query
        .from({ seek: renamed })
        .leftJoin({ owner: joined }, ({ seek, owner }: any) =>
          eq(seek.renamedOwner, owner.id),
        )
        .where(({ owner }: any) => eq(owner.active, true))
        .orderBy(({ seek }: any) => seek.rank, `desc`)
        .limit(4)
        .select(({ seek }: any) => ({ id: seek.id }))) as never,
  }) as unknown as Collection<{ id: number }>
  try {
    await live.preload()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(
      Array.from(live.values(), ({ id }) => id),
      `published window`,
    ).toEqual(
      seeks
        .filter((seek) => passes(`match`, seek))
        .slice(0, 4)
        .map(({ id }) => id),
    )
    expect(
      loads.filter((load) => load.relations !== undefined),
      `a subquery root sends no hint`,
    ).toEqual([])
  } finally {
    await live.cleanup()
    await root.cleanup()
    await joined.cleanup()
  }
}

describe(`loadSubset relation hints`, () => {
  oracleProperty({
    id: `load-subset-relations.subquery-root`,
    law: {
      statement: `A window whose root is a subquery sends no relation hint and publishes the window local evaluation gives.`,
      authority: `Issue #2124: an adapter must never drop a root row that passes.`,
      limits: `One root subquery that renames the join key.`,
    },
    owns: ['src/query/compiler/order-by.ts#processOrderBy'],
    histories: [{ root: `renamed` }],
    label: ({ root }) => `${root} subquery root`,
    resolve: (cell) => ({ cell }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`subquery root hint`, plan, observe, () =>
        runSubqueryRootCell(),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `load-subset-relations.demand-key`,
    law: {
      statement: `A load with a relation hint never shares a demand key with a load whose hint is absent or has a different related filter.`,
      authority: `Issue #2124.`,
      limits: `Two pairs of demands at getLoadSubsetDemandKey.`,
    },
    owns: ['src/query/ir-stable-identity.ts#getLoadSubsetDemandKey'],
    histories: identityCases,
    label: ({ name }) => name,
    resolve: (cell) => ({ cell }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`relation demand key`, plan, observe, () => {
        const [left, right] = demandPair(plan.cell.pair)
        expect(getLoadSubsetDemandKey(left)).not.toEqual(
          getLoadSubsetDemandKey(right),
        )
      }),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `load-subset-relations.shared-window`,
    law: {
      statement: `Windows compiled over one source send a relation hint only when they ask for the same joined filter.`,
      authority: `Issue #2124: an adapter must never drop a root row that passes.`,
      limits: `Two roots compiled over one source at the compiler boundary.`,
    },
    owns: ['src/query/compiler/order-by.ts#processOrderBy'],
    histories: sharedWindowCases,
    label: ({ name }) => `compiled over ${name}`,
    resolve: (cell) => ({ cell }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`shared window hint`, plan, observe, () =>
        runSharedWindowCell(plan.cell),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `load-subset-relations.joined-change`,
    law: {
      statement: `After a joined row changes, a joined-filter window publishes the window local evaluation gives, and no load sent while a joined row has a local write carries a relation hint.`,
      authority: `Issue #2124: an adapter must never drop a root row that passes; query/live/ARCHITECTURE.md: Ordered requests, continuation, and recovery.`,
      limits: `One changed owner that moves a root row into or out of one window, by a local write before or after the load or a synced change, with an applying or ignoring adapter.`,
    },
    owns: [
      'src/query/live/collection-subscriber.ts#subscribeToOrderedChanges',
      'src/query/live/ordered-source-loader.ts#loadMore',
    ],
    histories: joinedChangeCases,
    label: ({ write, move, applied }) =>
      `a ${write} that a root row ${move} with the hint ${applied ? `applied` : `ignored`}`,
    resolve: (cell) => ({ cell }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`joined change window`, plan, observe, () =>
        runJoinedChangeCell(plan.cell),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `load-subset-relations.window`,
    law: {
      statement: `A joined-filter window sends a relation hint only when it carries the whole joined filter, and publishes the same window whether the adapter applies or ignores it.`,
      authority: `Issue #2124; query/live/ARCHITECTURE.md: Ordered requests, continuation, and recovery.`,
      limits: `Nine filter kinds by an applying or ignoring adapter over one window on direct LEFT joins to a collection.`,
    },
    owns: ['src/query/compiler/order-by.ts#processOrderBy'],
    histories: relationCases,
    label: ({ kind, applied }) =>
      `${kind} with the hint ${applied ? `applied` : `ignored`}`,
    resolve: (cell) => ({ cell }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`relation hint window`, plan, observe, () =>
        runRelationCell(plan.cell),
      ),
    check: forwardAssertionJudgment,
  })
})
