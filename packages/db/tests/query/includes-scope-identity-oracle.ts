import { fc } from '@fast-check/vitest'
import { createCollection } from '../../src/collection/index.js'
import { createFilterFunctionFromExpression } from '../../src/collection/change-events.js'
import {
  and,
  createLiveQueryCollection,
  eq,
  materialize,
  not,
  toArray,
} from '../../src/query/index.js'
import { mockSyncCollectionOptions } from '../utils.js'
import type { Collection } from '../../src/collection/index.js'
import type { LoadSubsetOptions } from '../../src/types.js'

/**
 * Companion module for the `includes alpha-renaming across sibling scopes`
 * owner in `includes-oracle.property.test.ts`. That file states the law and
 * runs the campaigns. This module keeps the other four responsibilities in
 * separate sections: grammar, reference model, production driver, and
 * observation.
 *
 * Vocabulary. A query alias is lexical text. A `SourceId` (ARCHITECTURE.md
 * §Identity) is the opaque identity of one Collection reference in the plan.
 * The model has neither: it names sources by role (`part`, `joined`, `note`,
 * `include`) and computes rows from plain arrays. A slot is a model-only name
 * for one alias position in a query shape.
 */

export type ScopedPart = { id: number; active: boolean }
export type ScopedRef = { id: number; partId: number; clientId: number }

// ## Grammar

/**
 * Four topologies place a source beside a same-named source in a sibling
 * scope. The first three reached a lost-SourceId failure on the unrepaired
 * optimizer:
 *
 * - `fromSubquery`: an outer `from()` subquery and a correlated include.
 * - `unionBranch`: the same subquery as one `unionAll()` branch, beside an
 *   inactive-parts branch, under an outer `from()` and an include.
 * - `wrapper`: a top-level pure wrapper `from({ x: from({ x: parts }) })`
 *   beside a join subquery. Predicate pushdown would restructure the wrapper
 *   first, so this topology has no WHERE clause; it reaches the redundant
 *   subquery collapse.
 * - `unionParent`: an include placed directly on a joined `unionAll()`. A
 *   union row holds projected fields, so the include may reuse a branch
 *   alias but not the anchor join alias.
 */
export type ScopedTopology =
  | `fromSubquery`
  | `unionBranch`
  | `wrapper`
  | `unionParent`

export type ScopedSubquery = {
  /** Joins of the subquery source: none, refs, or refs then notes. */
  joins: `none` | `refs` | `refsThenNotes`
  refsJoin: `left` | `inner`
  predicates: Array<`subActive` | `joinedClient`>
  predicateForm: `separate` | `and`
  /** Clauses after WHERE that change optimizer safety and compiled shape. */
  body: `plain` | `orderedLimit` | `distinct`
  subSelect: `row` | `fields`
}

export type ScopedInclude = {
  /**
   * How the include reads its source. Every body selects the same members:
   * `plain` filters the source directly; `joined` inner-joins each member to
   * its part; `union` splits the source into two `unionAll()` branches and
   * correlates through an anchor join; `nestedFrom` reads a `from()`
   * subquery whose callback reads the parent row.
   */
  body: `plain` | `joined` | `union` | `nestedFrom`
  form: `toArray` | `materialize`
  source: `refs` | `notes`
  clientFilter: boolean
  outerSelect: `spread` | `fields`
}

export type ScopedShape =
  | {
      topology: `fromSubquery` | `unionBranch`
      subquery: ScopedSubquery
      include: ScopedInclude
    }
  | { topology: `wrapper`; wrapperJoin: `left` | `inner` }
  | { topology: `unionParent`; includeSource: `refs` | `notes` }

/**
 * Alias slots. `fromSubquery` and `unionBranch` use `outer`, `sub`,
 * `joined`, `noted`, `include`, (`unionBranch` only) `inactive`, and the
 * include body's extra slots: `includeJoin`, `includeOther` and
 * `includeAnchor`, or `includeOuter`. `wrapper` uses `wrapped`, `joinSub`,
 * and `joinSource`.
 */
export type ScopedAliases = Record<string, string>

export type ScopedSourceMode = `eager` | `onDemand`

export type ScopedWrite =
  | { source: `parts`; type: `put`; row: ScopedPart }
  | { source: `refs` | `notes`; type: `put`; row: ScopedRef }
  | { source: `parts` | `refs` | `notes`; type: `delete`; id: number }

export type ScopedScenario = {
  shape: ScopedShape
  mode: ScopedSourceMode
  aliases: ScopedAliases
  parts: Array<ScopedPart>
  refs: Array<ScopedRef>
  notes: Array<ScopedRef>
  writes: Array<ScopedWrite>
}

export function scopedSlots(shape: ScopedShape): Array<string> {
  if (shape.topology === `wrapper`) return [`wrapped`, `joinSub`, `joinSource`]
  if (shape.topology === `unionParent`) {
    return [`activeBranch`, `inactiveBranch`, `anchor`, `include`]
  }
  const slots = [`outer`, `sub`, `joined`, `noted`, `include`]
  if (shape.topology === `unionBranch`) slots.push(`inactive`)
  return [...slots, ...includeBodySlots[shape.include.body]]
}

const includeBodySlots: Record<ScopedInclude[`body`], Array<string>> = {
  plain: [],
  joined: [`includeJoin`],
  union: [`includeOther`, `includeAnchor`],
  nestedFrom: [`includeOuter`],
}

export function canonicalScopedAliases(shape: ScopedShape): ScopedAliases {
  return Object.fromEntries(
    scopedSlots(shape).map((slot) => [slot, `canonical_${slot}`]),
  )
}

/**
 * Legality follows the documented lexical rules (ARCHITECTURE.md §Identity),
 * not the builder's validator. One scope keeps its names distinct, and no
 * scope inside an include can reuse an alias its ancestors can see. Sibling
 * scopes are unconstrained. The scopes are:
 *
 * - subquery: `sub`, plus `joined` and `noted` when those joins exist;
 * - outer: `outer`;
 * - a union: every alias of every `unionAll()` branch. The compiler rejects a
 *   name that two branches repeat, so a union's subquery aliases and
 *   `inactive` must all differ. A union row holds projected fields, so the
 *   union's own joins and includes do not see branch aliases;
 * - include: `include` plus its body's level (`includeJoin`, or
 *   `includeOther` and `includeAnchor`); a `nestedFrom` body has the
 *   include level `includeOuter` and the inner body `include`. Every
 *   include slot is inside the outer row's scope, so none may equal `outer`;
 * - wrapper outer: `wrapped` and `joinSub`; wrapped and join bodies:
 *   `wrapped` and `joinSource`.
 *
 * A same-scope repeat must be rejected. A shadowing name must be rejected
 * with `DuplicateAliasInSubqueryError`.
 */
export type ScopedNaming = `legal` | `sameScope` | `shadowing`

export function classifyScopedNaming(
  shape: ScopedShape,
  aliases: ScopedAliases,
): ScopedNaming {
  const repeats = (scope: Array<string | undefined>) =>
    new Set(scope).size !== scope.length
  if (shape.topology === `wrapper`) {
    return aliases.wrapped === aliases.joinSub ? `sameScope` : `legal`
  }
  if (shape.topology === `unionParent`) {
    // Branches share one namespace. The builder's existing rule rejects a
    // branch that reuses the anchor, a parent Collection alias.
    const { activeBranch, inactiveBranch, anchor, include } = aliases
    if (repeats([activeBranch, inactiveBranch, anchor])) return `sameScope`
    return include === anchor ? `shadowing` : `legal`
  }
  const { joins } = shape.subquery
  const subScope = [aliases.sub]
  if (joins !== `none`) subScope.push(aliases.joined)
  if (joins === `refsThenNotes`) subScope.push(aliases.noted)
  if (shape.topology === `unionBranch`) subScope.push(aliases.inactive)
  const includeScopes: Record<
    ScopedInclude[`body`],
    Array<Array<string | undefined>>
  > = {
    plain: [[aliases.include]],
    joined: [[aliases.include, aliases.includeJoin]],
    // The anchor join is a sibling of the branches, but the builder's existing
    // rule rejects a nested query that reuses a parent Collection alias.
    union: [[aliases.include, aliases.includeOther, aliases.includeAnchor]],
    nestedFrom: [[aliases.includeOuter], [aliases.include]],
  }
  const includeSlots = includeScopes[shape.include.body]
  if (repeats(subScope) || includeSlots.some(repeats)) return `sameScope`
  return includeSlots.flat().includes(aliases.outer) ? `shadowing` : `legal`
}

export function isLegalScopedNaming(
  shape: ScopedShape,
  aliases: ScopedAliases,
): boolean {
  return classifyScopedNaming(shape, aliases) === `legal`
}

const aliasPool = [`a`, `b`, `c`] as const

const partArbitrary = fc.record({
  id: fc.integer({ min: 1, max: 3 }),
  active: fc.boolean(),
})
const refArbitrary = fc.record({
  id: fc.integer({ min: 1, max: 4 }),
  partId: fc.integer({ min: 1, max: 3 }),
  clientId: fc.integer({ min: 1, max: 2 }),
})

const subqueryArbitrary: fc.Arbitrary<ScopedSubquery> = fc
  .record({
    joins: fc.constantFrom(
      `none` as const,
      `refs` as const,
      `refsThenNotes` as const,
    ),
    refsJoin: fc.constantFrom(`left` as const, `inner` as const),
    predicates: fc.uniqueArray(
      fc.constantFrom(`subActive` as const, `joinedClient` as const),
      { maxLength: 2 },
    ),
    predicateForm: fc.constantFrom(`separate` as const, `and` as const),
    body: fc.constantFrom(
      `plain` as const,
      `orderedLimit` as const,
      `distinct` as const,
    ),
    subSelect: fc.constantFrom(`row` as const, `fields` as const),
  })
  .filter(
    (subquery) =>
      subquery.joins !== `none` ||
      !subquery.predicates.includes(`joinedClient`),
  )

const includeArbitrary: fc.Arbitrary<ScopedInclude> = fc.record({
  body: fc.constantFrom(
    `plain` as const,
    `joined` as const,
    `union` as const,
    `nestedFrom` as const,
  ),
  form: fc.constantFrom(`toArray` as const, `materialize` as const),
  source: fc.constantFrom(`refs` as const, `notes` as const),
  clientFilter: fc.boolean(),
  outerSelect: fc.constantFrom(`spread` as const, `fields` as const),
})

export const scopedShapeArbitrary: fc.Arbitrary<ScopedShape> = fc.oneof(
  fc.record({
    topology: fc.constantFrom(`fromSubquery` as const, `unionBranch` as const),
    subquery: subqueryArbitrary,
    include: includeArbitrary,
  }),
  fc.record({
    topology: fc.constant(`wrapper` as const),
    wrapperJoin: fc.constantFrom(`left` as const, `inner` as const),
  }),
  fc.record({
    topology: fc.constant(`unionParent` as const),
    includeSource: fc.constantFrom(`refs` as const, `notes` as const),
  }),
)

const writeArbitrary: fc.Arbitrary<ScopedWrite> = fc.oneof(
  fc.record({
    source: fc.constant(`parts` as const),
    type: fc.constant(`put` as const),
    row: partArbitrary,
  }),
  fc.record({
    source: fc.constantFrom(`refs` as const, `notes` as const),
    type: fc.constant(`put` as const),
    row: refArbitrary,
  }),
  fc.record({
    source: fc.constantFrom(
      `parts` as const,
      `refs` as const,
      `notes` as const,
    ),
    type: fc.constant(`delete` as const),
    id: fc.integer({ min: 1, max: 4 }),
  }),
)

const scenarioCandidateArbitrary = scopedShapeArbitrary.chain((shape) =>
  fc.record({
    shape: fc.constant(shape),
    mode: fc.constantFrom(`eager` as const, `onDemand` as const),
    aliases: fc.record(
      Object.fromEntries(
        scopedSlots(shape).map((slot) => [slot, fc.constantFrom(...aliasPool)]),
      ) as Record<string, fc.Arbitrary<string>>,
    ),
    parts: fc.uniqueArray(partArbitrary, {
      selector: (row) => row.id,
      maxLength: 3,
    }),
    refs: fc.uniqueArray(refArbitrary, {
      selector: (row) => row.id,
      maxLength: 4,
    }),
    notes: fc.uniqueArray(refArbitrary, {
      selector: (row) => row.id,
      maxLength: 4,
    }),
    writes: fc.array(writeArbitrary, { maxLength: 4 }),
  }),
)

/**
 * Three in four scenarios use a legal naming and check the law. The rest use
 * any naming, so illegal ones check that the builder rejects them.
 */
export const scopedScenarioArbitrary: fc.Arbitrary<ScopedScenario> = fc.oneof(
  {
    arbitrary: scenarioCandidateArbitrary.filter(({ shape, aliases }) =>
      isLegalScopedNaming(shape, aliases),
    ),
    weight: 3,
  },
  { arbitrary: scenarioCandidateArbitrary, weight: 1 },
)

// ## Reference model

type ModelState = {
  parts: Map<number, ScopedPart>
  refs: Map<number, ScopedRef>
  notes: Map<number, ScopedRef>
}

export type ScopedResultRow = Record<string, unknown>

/**
 * Plain recomputation of the public rows. It reads the current source rows
 * and never consults the plan, aliases, or SourceIds, so it judges every
 * naming, including the canonical one.
 *
 * Joins multiply rows: one subquery row exists per surviving join
 * combination, and duplicates remain. An absent LEFT match is `undefined`,
 * and `eq()` on it is unknown, which a WHERE clause rejects. `orderedLimit`
 * keeps the first row by part id; tied rows carry identical part fields.
 */
export function recomputeScopedRows(
  shape: ScopedShape,
  state: ModelState,
): Array<ScopedResultRow> {
  const parts = [...state.parts.values()]
  const refs = [...state.refs.values()]
  const notes = [...state.notes.values()]

  if (shape.topology === `unionParent`) {
    // The branches partition parts by `active`; the anchor matches each once.
    const members = shape.includeSource === `refs` ? refs : notes
    return parts.map((part) => ({
      id: part.id,
      active: part.active,
      members: members
        .filter((member) => member.partId === part.id)
        .map((member) => ({ id: member.id, clientId: member.clientId })),
    }))
  }

  if (shape.topology === `wrapper`) {
    const clientOne = refs.filter((ref) => ref.clientId === 1)
    return parts.flatMap((part): Array<ScopedResultRow> => {
      const matches = clientOne.filter((ref) => ref.partId === part.id)
      if (matches.length === 0) {
        return shape.wrapperJoin === `left`
          ? [{ id: part.id, active: part.active, refId: null }]
          : []
      }
      return matches.map((ref) => ({
        id: part.id,
        active: part.active,
        refId: ref.id,
      }))
    })
  }

  const { subquery, include } = shape
  type Combination = { part: ScopedPart; joined?: ScopedRef }
  const leftMatches = <T>(rows: Array<T>, inner: boolean) =>
    rows.length > 0 ? rows : inner ? [] : [undefined]

  let combinations: Array<Combination> = parts.map((part) => ({ part }))
  if (subquery.joins !== `none`) {
    combinations = combinations.flatMap((combination) =>
      leftMatches(
        refs.filter((ref) => ref.partId === combination.part.id),
        subquery.refsJoin === `inner`,
      ).map((joined) => ({ ...combination, joined })),
    )
  }
  if (subquery.joins === `refsThenNotes`) {
    combinations = combinations.flatMap((combination) =>
      leftMatches(
        notes.filter((note) => note.partId === combination.part.id),
        false,
      ).map(() => combination),
    )
  }
  combinations = combinations.filter((combination) =>
    subquery.predicates.every((predicate) =>
      predicate === `subActive`
        ? combination.part.active === true
        : combination.joined?.clientId === 1,
    ),
  )

  let subRows = combinations.map(({ part }) => ({
    id: part.id,
    active: part.active,
  }))
  if (subquery.body === `distinct`) {
    subRows = [
      ...new Map(subRows.map((row) => [JSON.stringify(row), row])).values(),
    ]
  } else if (subquery.body === `orderedLimit`) {
    subRows = [...subRows].sort((left, right) => left.id - right.id).slice(0, 1)
  }

  const outerRows =
    shape.topology === `unionBranch`
      ? [
          ...subRows,
          ...parts
            .filter((part) => part.active !== true)
            .map((part) => ({ id: part.id, active: part.active })),
        ]
      : subRows

  const includeRows = include.source === `refs` ? refs : notes
  return outerRows.map((row) => ({
    id: row.id,
    active: row.active,
    members: includeRows
      .filter(
        (member) =>
          member.partId === row.id &&
          (!include.clientFilter || member.clientId === 1),
      )
      .map((member) => ({ id: member.id, clientId: member.clientId })),
  }))
}

// ## Production driver

/**
 * One source fixture per Collection. `eager` installs every row through a
 * mock sync. `onDemand` is a finite provider: it installs only rows that
 * match a `loadSubset` WHERE clause, records each request, and later
 * forwards a write for an installed row or a row that matches a recorded
 * request. A request routed to the wrong Collection therefore changes the
 * public rows, not only the request log.
 */
export type ScopedSource<T extends { id: number }> = {
  collection: Collection<T>
  requests: Array<string>
  put: (row: T) => void
  remove: (id: number) => void
}

let nextScopedSourceId = 0

export function createScopedSource<T extends { id: number }>(
  name: string,
  rows: Array<T>,
  mode: ScopedSourceMode,
): ScopedSource<T> {
  const requests: Array<string> = []
  if (mode === `eager`) {
    const options = mockSyncCollectionOptions<T>({
      id: `scoped-${name}-${nextScopedSourceId++}`,
      getKey: (row) => row.id,
      initialData: rows.map((row) => ({ ...row })),
    })
    const collection = createCollection(options)
    const send = (type: `insert` | `update` | `delete`, value: T) => {
      options.utils.begin()
      options.utils.write({ type, value: { ...value } })
      options.utils.commit()
    }
    return {
      collection,
      requests,
      put: (row) => send(collection.has(row.id) ? `update` : `insert`, row),
      remove: (id) => {
        const current = collection.get(id)
        if (current) send(`delete`, current)
      },
    }
  }

  const backing = new Map(rows.map((row) => [row.id, { ...row }]))
  const installed = new Set<number>()
  const predicates: Array<(row: T) => boolean> = []
  let sync:
    | {
        begin: () => void
        write: (change: {
          type: `insert` | `update` | `delete`
          value: T
        }) => void
        commit: () => void
      }
    | undefined
  const collection = createCollection<T>({
    id: `scoped-${name}-${nextScopedSourceId++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        sync = { begin, write, commit }
        markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            requests.push(JSON.stringify(options.where ?? null))
            const matches = options.where
              ? createFilterFunctionFromExpression(options.where)
              : () => true
            predicates.push(matches)
            begin()
            for (const row of backing.values()) {
              if (installed.has(row.id) || !matches(row)) continue
              installed.add(row.id)
              write({ type: `insert`, value: { ...row } })
            }
            commit()
            return Promise.resolve()
          },
        }
      },
    },
  })
  const send = (type: `insert` | `update` | `delete`, value: T) => {
    sync!.begin()
    sync!.write({ type, value: { ...value } })
    sync!.commit()
  }
  return {
    collection,
    requests,
    put: (row) => {
      backing.set(row.id, { ...row })
      if (installed.has(row.id)) {
        send(`update`, row)
      } else if (predicates.some((matches) => matches(row))) {
        installed.add(row.id)
        send(`insert`, row)
      }
    },
    remove: (id) => {
      const current = backing.get(id)
      backing.delete(id)
      if (current && installed.delete(id)) send(`delete`, current)
    },
  }
}

export type ScopedSources = {
  parts: ScopedSource<ScopedPart>
  refs: ScopedSource<ScopedRef>
  notes: ScopedSource<ScopedRef>
}

type Context = Record<string, any>

/**
 * Builds the live query for one shape and one naming. Alias names are data,
 * so callbacks read the namespaced context by key. Every naming of one shape
 * builds the same plan up to alias text.
 */
export function createScopedQuery(
  shape: ScopedShape,
  aliases: ScopedAliases,
  sources: ScopedSources,
) {
  const n = aliases
  return createLiveQueryCollection((q) => {
    if (shape.topology === `unionParent`) {
      const branch = (alias: string, active: boolean) =>
        q
          .from({ [alias]: sources.parts.collection })
          .where((c: Context) =>
            active ? eq(c[alias].active, true) : not(eq(c[alias].active, true)),
          )
          .select((c: Context) => ({
            id: c[alias].id,
            active: c[alias].active,
          }))
      const members =
        shape.includeSource === `refs`
          ? sources.refs.collection
          : sources.notes.collection
      return q
        .unionAll(
          branch(n.activeBranch!, true),
          branch(n.inactiveBranch!, false),
        )
        .innerJoin({ [n.anchor!]: sources.parts.collection }, (c: Context) =>
          eq(c.id, c[n.anchor!].id),
        )
        .select((c: Context) => ({
          id: c.id,
          active: c.active,
          members: toArray(
            q
              .from({ [n.include!]: members })
              .where((cc: Context) =>
                eq(cc[n.include!].partId, c[n.anchor!].id),
              )
              .select((cc: Context) => ({
                id: cc[n.include!].id,
                clientId: cc[n.include!].clientId,
              })),
          ),
        }))
    }

    if (shape.topology === `wrapper`) {
      const clientOne = q
        .from({ [n.joinSource!]: sources.refs.collection })
        .where((c: Context) => eq(c[n.joinSource!].clientId, 1))
        .select((c: Context) => ({
          partId: c[n.joinSource!].partId,
          refId: c[n.joinSource!].id,
        }))
      return (
        q.from({
          [n.wrapped!]: q.from({ [n.wrapped!]: sources.parts.collection }),
        } as any) as any
      )
        .join(
          { [n.joinSub!]: clientOne },
          (c: Context) => eq(c[n.joinSub!].partId, c[n.wrapped!].id),
          shape.wrapperJoin,
        )
        .select((c: Context) => ({
          id: c[n.wrapped!].id,
          active: c[n.wrapped!].active,
          refId: c[n.joinSub!].refId,
        }))
    }

    const { subquery, include } = shape
    let sub: any = q.from({ [n.sub!]: sources.parts.collection })
    if (subquery.joins !== `none`) {
      sub = sub.join(
        { [n.joined!]: sources.refs.collection },
        (c: Context) => eq(c[n.joined!].partId, c[n.sub!].id),
        subquery.refsJoin,
      )
    }
    if (subquery.joins === `refsThenNotes`) {
      sub = sub.join(
        { [n.noted!]: sources.notes.collection },
        (c: Context) => eq(c[n.noted!].partId, c[n.sub!].id),
        `left`,
      )
    }
    const predicates = subquery.predicates.map((predicate) =>
      predicate === `subActive`
        ? (c: Context) => eq(c[n.sub!].active, true)
        : (c: Context) => eq(c[n.joined!].clientId, 1),
    )
    if (subquery.predicateForm === `and` && predicates.length > 1) {
      sub = sub.where((c: Context) => and(predicates[0]!(c), predicates[1]!(c)))
    } else {
      for (const predicate of predicates) sub = sub.where(predicate)
    }
    if (subquery.body === `orderedLimit`) {
      sub = sub.orderBy((c: Context) => c[n.sub!].id).limit(1)
    }
    sub = sub.select((c: Context) =>
      subquery.subSelect === `row`
        ? c[n.sub!]
        : { id: c[n.sub!].id, active: c[n.sub!].active },
    )
    if (subquery.body === `distinct`) sub = sub.distinct()

    const outerSource =
      shape.topology === `unionBranch`
        ? q.unionAll(
            sub,
            q
              .from({ [n.inactive!]: sources.parts.collection })
              .where((c: Context) => not(eq(c[n.inactive!].active, true)))
              .select((c: Context) => ({
                id: c[n.inactive!].id,
                active: c[n.inactive!].active,
              })),
          )
        : sub
    const includeCollection =
      include.source === `refs`
        ? sources.refs.collection
        : sources.notes.collection

    return (q.from({ [n.outer!]: outerSource } as any) as any).select(
      (c: Context) => {
        const outer = c[n.outer!]
        const clientOne = (member: any) => eq(member.clientId, 1)
        let child: any
        if (include.body === `union`) {
          const branch = (alias: string, keep: (member: any) => any) =>
            q
              .from({ [alias]: includeCollection })
              .where((cc: Context) => keep(cc[alias]))
              .select((cc: Context) => ({ memberId: cc[alias].id }))
          child = q
            .unionAll(
              branch(n.include!, clientOne),
              branch(n.includeOther!, (member) => not(clientOne(member))),
            )
            .innerJoin(
              { [n.includeAnchor!]: includeCollection },
              (cc: Context) => eq(cc.memberId, cc[n.includeAnchor!].id),
            )
            .where((cc: Context) => eq(cc[n.includeAnchor!].partId, outer.id))
          if (include.clientFilter) {
            child = child.where((cc: Context) =>
              clientOne(cc[n.includeAnchor!]),
            )
          }
          child = child.select((cc: Context) => ({
            id: cc[n.includeAnchor!].id,
            clientId: cc[n.includeAnchor!].clientId,
          }))
        } else {
          // `member` is the alias whose row the include selects.
          const member =
            include.body === `nestedFrom` ? n.includeOuter! : n.include!
          child =
            include.body === `nestedFrom`
              ? q.from({
                  [member]: q
                    .from({ [n.include!]: includeCollection })
                    .select((cc: Context) => ({
                      id: cc[n.include!].id,
                      partId: cc[n.include!].partId,
                      clientId: cc[n.include!].clientId,
                      parentId: outer.id,
                    })),
                })
              : q.from({ [member]: includeCollection })
          if (include.body === `joined`) {
            child = child.join(
              { [n.includeJoin!]: sources.parts.collection },
              (cc: Context) => eq(cc[n.includeJoin!].id, cc[member].partId),
              `inner`,
            )
          }
          child = child.where((cc: Context) => eq(cc[member].partId, outer.id))
          if (include.clientFilter) {
            child = child.where((cc: Context) => clientOne(cc[member]))
          }
          child = child.select((cc: Context) => ({
            id: cc[member].id,
            clientId: cc[member].clientId,
          }))
        }
        const members =
          include.form === `toArray` ? toArray(child) : materialize(child)
        return include.outerSelect === `spread`
          ? { ...outer, members }
          : { id: outer.id, active: outer.active, members }
      },
    )
  })
}

// ## Observation

/**
 * Neither query promises an order, so rows and include members are compared
 * as bags of complete values. Virtual `$` fields are delivery metadata and
 * are removed; an absent LEFT-joined field is compared as `null`.
 */
export function normalizeScopedRows(rows: Array<unknown>): Array<string> {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map((entry) => JSON.stringify(normalize(entry))).sort()
    }
    if (!value || typeof value !== `object`) return value ?? null
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !key.startsWith(`$`))
        .map(([key, entry]) => [key, normalize(entry)]),
    )
  }
  return rows.map((row) => JSON.stringify(normalize(row))).sort()
}

export function createScopedSources(scenario: ScopedScenario): ScopedSources {
  return {
    parts: createScopedSource(`parts`, scenario.parts, scenario.mode),
    refs: createScopedSource(`refs`, scenario.refs, scenario.mode),
    notes: createScopedSource(`notes`, scenario.notes, scenario.mode),
  }
}

export function createModelState(scenario: ScopedScenario): ModelState {
  return {
    parts: new Map(scenario.parts.map((row) => [row.id, { ...row }])),
    refs: new Map(scenario.refs.map((row) => [row.id, { ...row }])),
    notes: new Map(scenario.notes.map((row) => [row.id, { ...row }])),
  }
}

export function applyScopedWrite(
  sourceSets: Array<ScopedSources>,
  state: ModelState,
  write: ScopedWrite,
): void {
  if (write.type === `delete`) {
    state[write.source].delete(write.id)
    for (const sources of sourceSets) sources[write.source].remove(write.id)
    return
  }
  if (write.source === `parts`) {
    state.parts.set(write.row.id, { ...write.row })
    for (const sources of sourceSets) sources.parts.put(write.row)
  } else {
    state[write.source].set(write.row.id, { ...write.row })
    for (const sources of sourceSets) sources[write.source].put(write.row)
  }
}

export function sortedRequests(sources: ScopedSources) {
  return {
    parts: [...sources.parts.requests].sort(),
    refs: [...sources.refs.requests].sort(),
    notes: [...sources.notes.requests].sort(),
  }
}
