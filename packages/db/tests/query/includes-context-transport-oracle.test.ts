import { describe, expect, test } from 'vitest'
import {
  add,
  count,
  createLiveQueryCollection,
  eq,
  gt,
  lt,
  lte,
  materialize,
  multiply,
  sum,
  toArray,
} from '../../src/query/index.js'
import { createControlledCollection } from './includes-oracle-helpers.js'
import type { Collection } from '../../src/collection/index.js'
import type { Context, QueryBuilder } from '../../src/query/builder/index.js'
import type { ControlledCollection } from './includes-oracle-helpers.js'

type Cleanable = { cleanup: () => Promise<void> }
type MaterializationForm = (typeof materializationForms)[number]

type MaterializedForms<T> = {
  collection: { values: () => Iterable<T> }
  array: Iterable<T>
  materialized: Iterable<T>
}

const materializationForms = [`collection`, `array`, `materialized`] as const
const checkpoints = [`initial`, `parent-update`, `child-update`] as const

const routeContextGrammar = {
  lexicalScope: {
    scopes: [`immediate-parent`, `lexical-ancestor`] as const,
  },
  aggregation: {
    groupings: [`implicit`, `explicit`] as const,
    placements: [`inside-aggregate`, `wrapped-aggregate`] as const,
  },
  recursiveSource: {
    boundaries: [`from-query-ref`, `joined-query-ref`, `union-branch`] as const,
    phases: [
      `filter`,
      `projection`,
      `aggregate`,
      `having`,
      `order-window`,
    ] as const,
  },
  join: {
    keySides: [`main`, `joined`] as const,
    correlationAttachments: [`main`, `joined`] as const,
  },
} as const

type LexicalScopeCell = {
  family: `lexical-scope`
  scope: (typeof routeContextGrammar.lexicalScope.scopes)[number]
}

type AggregationCell = {
  family: `aggregation`
  grouping: (typeof routeContextGrammar.aggregation.groupings)[number]
  placement: (typeof routeContextGrammar.aggregation.placements)[number]
}

type RecursiveSourceCell = {
  family: `recursive-source`
  boundary: (typeof routeContextGrammar.recursiveSource.boundaries)[number]
  phase: (typeof routeContextGrammar.recursiveSource.phases)[number]
}

type JoinCell = {
  family: `join`
  keySide: (typeof routeContextGrammar.join.keySides)[number]
  correlationAttachment: (typeof routeContextGrammar.join.correlationAttachments)[number]
}

type GrammarCell =
  | LexicalScopeCell
  | AggregationCell
  | RecursiveSourceCell
  | JoinCell

const grammarCells: Array<GrammarCell> = [
  ...routeContextGrammar.lexicalScope.scopes.map(
    (scope): LexicalScopeCell => ({ family: `lexical-scope`, scope }),
  ),
  ...routeContextGrammar.aggregation.groupings.flatMap((grouping) =>
    routeContextGrammar.aggregation.placements.map(
      (placement): AggregationCell => ({
        family: `aggregation`,
        grouping,
        placement,
      }),
    ),
  ),
  ...routeContextGrammar.recursiveSource.boundaries.flatMap((boundary) =>
    routeContextGrammar.recursiveSource.phases.map(
      (phase): RecursiveSourceCell => ({
        family: `recursive-source`,
        boundary,
        phase,
      }),
    ),
  ),
  ...routeContextGrammar.join.keySides.flatMap((keySide) =>
    routeContextGrammar.join.correlationAttachments.map(
      (correlationAttachment): JoinCell => ({
        family: `join`,
        keySide,
        correlationAttachment,
      }),
    ),
  ),
]

async function cleanup(
  live: Cleanable,
  sources: Array<{ collection: Cleanable }>,
): Promise<void> {
  await live.cleanup()
  await Promise.all(sources.map(({ collection }) => collection.cleanup()))
}

function createGrammarCollection<T extends { id: number }>(
  name: string,
  rows: ReadonlyArray<T>,
): ControlledCollection<T> {
  return createControlledCollection(name, rows, { autoIndex: `eager` })
}

function includeInEveryForm<TContext extends Context>(
  query: QueryBuilder<TContext>,
) {
  return {
    collection: query,
    array: toArray(query),
    materialized: materialize(query),
  }
}

function readEveryForm<T, U>(
  forms: MaterializedForms<T>,
  project: (rows: Iterable<T>) => U,
): Record<MaterializationForm, U> {
  return {
    collection: project(forms.collection.values()),
    array: project(forms.array),
    materialized: project(forms.materialized),
  }
}

function expectEveryForm<T, U>(
  forms: MaterializedForms<T>,
  project: (rows: Iterable<T>) => U,
  expected: U,
): void {
  expect(readEveryForm(forms, project)).toEqual(
    Object.fromEntries(materializationForms.map((form) => [form, expected])),
  )
}

function ids(rows: Iterable<{ id: number }>): Array<number> {
  return [...rows].map((row) => row.id)
}

function grammarCellName(cell: GrammarCell): string {
  switch (cell.family) {
    case `lexical-scope`:
      return `${cell.family} / ${cell.scope}`
    case `aggregation`:
      return `${cell.family} / ${cell.grouping} / ${cell.placement}`
    case `recursive-source`:
      return `${cell.family} / ${cell.boundary} / ${cell.phase}`
    case `join`:
      return `${cell.family} / ${cell.keySide}-side key / ${cell.correlationAttachment}-side correlation`
  }
}

async function runLexicalScopeCell({ scope }: LexicalScopeCell): Promise<void> {
  const parents = createGrammarCollection(`scope-${scope}-parents`, [
    { id: 1, group: 1, threshold: 2 },
    { id: 2, group: 1, threshold: 4 },
  ])
  const children = createGrammarCollection(`scope-${scope}-children`, [
    { id: 10, parentGroup: 1, group: 10, value: 1 },
    { id: 20, parentGroup: 1, group: 20, value: 3 },
  ])
  const grandchildren = createGrammarCollection(
    `scope-${scope}-grandchildren`,
    [
      { id: 100, parentGroup: 10, value: 1 },
      { id: 200, parentGroup: 10, value: 3 },
    ],
  )

  if (scope === `immediate-parent`) {
    const live = createLiveQueryCollection((q) =>
      q
        .from({ parent: parents.collection })
        .orderBy(({ parent }) => parent.id)
        .select(({ parent }) => {
          const childRows = q
            .from({ child: children.collection })
            .where(({ child }) => eq(child.parentGroup, parent.group))
            .where(({ child }) => lt(child.value, parent.threshold))
            .orderBy(({ child }) => child.id)
            .select(({ child }) => ({ id: child.id }))
          return { id: parent.id, ...includeInEveryForm(childRows) }
        }),
    )

    const expected = (parentId: number) => {
      const parent = parents.collection.get(parentId)!
      return children.collection.toArray
        .filter(
          (child) =>
            child.parentGroup === parent.group &&
            child.value < parent.threshold,
        )
        .map(({ id }) => id)
        .sort((left, right) => left - right)
    }

    try {
      await live.preload()
      for (const parent of parents.collection.toArray) {
        expectEveryForm(live.get(parent.id)!, ids, expected(parent.id))
      }

      parents.write(`update`, { id: 1, group: 1, threshold: 4 })
      expectEveryForm(live.get(1)!, ids, expected(1))

      children.write(`insert`, {
        id: 30,
        parentGroup: 1,
        group: 30,
        value: 2,
      })
      for (const parent of parents.collection.toArray) {
        expectEveryForm(live.get(parent.id)!, ids, expected(parent.id))
      }
    } finally {
      await cleanup(live, [parents, children, grandchildren])
    }
    return
  }

  const live = createLiveQueryCollection((q) =>
    q
      .from({ parent: parents.collection })
      .orderBy(({ parent }) => parent.id)
      .select(({ parent }) => {
        const childRows = q
          .from({ child: children.collection })
          .where(({ child }) => eq(child.parentGroup, parent.group))
          .select(({ child }) => {
            const grandchildRows = q
              .from({ grandchild: grandchildren.collection })
              .where(({ grandchild }) =>
                eq(grandchild.parentGroup, child.group),
              )
              .where(({ grandchild }) => lt(grandchild.value, parent.threshold))
              .orderBy(({ grandchild }) => grandchild.id)
              .select(({ grandchild }) => ({ id: grandchild.id }))

            return {
              id: child.id,
              ...includeInEveryForm(grandchildRows),
            }
          })

        return { id: parent.id, ...includeInEveryForm(childRows) }
      }),
  )

  const expected = (parentId: number, childGroup: number) => {
    const parent = parents.collection.get(parentId)!
    return grandchildren.collection.toArray
      .filter(
        (grandchild) =>
          grandchild.parentGroup === childGroup &&
          grandchild.value < parent.threshold,
      )
      .map(({ id }) => id)
      .sort((left, right) => left - right)
  }

  const projectOuterForm = (
    parentId: number,
    outerForm: MaterializationForm,
  ) => {
    const parentRow = live.get(parentId)!
    const outerRows =
      outerForm === `collection`
        ? parentRow.collection.values()
        : parentRow[outerForm]
    return [...outerRows].map((child) => ({
      id: child.id,
      grandchildren: readEveryForm(child, ids),
    }))
  }

  const assertNestedProduct = (parentId: number) => {
    const expectedRows = children.collection.toArray
      .filter(
        (child) =>
          child.parentGroup === parents.collection.get(parentId)!.group,
      )
      .map((child) => ({
        id: child.id,
        grandchildren: Object.fromEntries(
          materializationForms.map((form) => [
            form,
            expected(parentId, child.group),
          ]),
        ),
      }))
    for (const outerForm of materializationForms) {
      expect(projectOuterForm(parentId, outerForm)).toEqual(expectedRows)
    }
  }

  try {
    await live.preload()
    assertNestedProduct(1)
    assertNestedProduct(2)

    parents.write(`update`, { id: 1, group: 1, threshold: 4 })
    assertNestedProduct(1)

    grandchildren.write(`insert`, { id: 300, parentGroup: 10, value: 2 })
    assertNestedProduct(1)
    assertNestedProduct(2)
  } finally {
    await cleanup(live, [parents, children, grandchildren])
  }
}

async function runAggregationCell({
  grouping,
  placement,
}: AggregationCell): Promise<void> {
  const name = `${grouping}-${placement}`
  const parents = createGrammarCollection(`aggregate-${name}-parents`, [
    { id: 1, group: 1, factor: 2 },
    { id: 2, group: 1, factor: -1 },
  ])
  const children = createGrammarCollection(`aggregate-${name}-children`, [
    { id: 10, parentGroup: 1, value: 1 },
    { id: 20, parentGroup: 1, value: 2 },
  ])
  const live = createLiveQueryCollection((q) =>
    q
      .from({ parent: parents.collection })
      .orderBy(({ parent }) => parent.id)
      .select(({ parent }) => {
        const correlated = q
          .from({ child: children.collection })
          .where(({ child }) => eq(child.parentGroup, parent.group))
        const rows =
          grouping === `explicit`
            ? correlated
                .groupBy(({ child }) => child.parentGroup)
                .select(({ child }) => ({
                  score:
                    placement === `inside-aggregate`
                      ? sum(multiply(child.value, parent.factor))
                      : multiply(sum(child.value), parent.factor),
                }))
            : correlated.select(({ child }) => ({
                score:
                  placement === `inside-aggregate`
                    ? sum(multiply(child.value, parent.factor))
                    : multiply(sum(child.value), parent.factor),
              }))
        return { id: parent.id, ...includeInEveryForm(rows) }
      }),
  )

  const expected = (parentId: number) => {
    const parent = parents.collection.get(parentId)!
    const total = children.collection.toArray
      .filter((child) => child.parentGroup === parent.group)
      .reduce((result, child) => result + child.value, 0)
    return [total * parent.factor]
  }

  const project = (rows: Iterable<{ score: number }>) =>
    [...rows].map(({ score }) => score)

  try {
    await live.preload()
    for (const parent of parents.collection.toArray) {
      expectEveryForm(live.get(parent.id)!, project, expected(parent.id))
    }

    parents.write(`update`, { id: 2, group: 1, factor: 3 })
    expectEveryForm(live.get(2)!, project, expected(2))

    children.write(`insert`, { id: 30, parentGroup: 1, value: 4 })
    for (const parent of parents.collection.toArray) {
      expectEveryForm(live.get(parent.id)!, project, expected(parent.id))
    }
  } finally {
    await cleanup(live, [parents, children])
  }
}

type CandidateRow = {
  id: number
  parentGroup: number
  value: number
}

async function runRecursiveSourceCell({
  boundary,
  phase,
}: RecursiveSourceCell): Promise<void> {
  const name = `${boundary}-${phase}`
  const initialParameter =
    phase === `order-window`
      ? [1, -1]
      : phase === `projection` || phase === `aggregate`
        ? [10, 20]
        : phase === `having`
          ? [0, 1]
          : [1, 2]
  const parents = createGrammarCollection(`recursive-${name}-parents`, [
    { id: 1, group: 1, parameter: initialParameter[0]! },
    { id: 2, group: 1, parameter: initialParameter[1]! },
  ])
  const initialCandidates: Array<CandidateRow> = [
    { id: 10, parentGroup: 1, value: 1 },
    { id: 20, parentGroup: 1, value: 2 },
    { id: 30, parentGroup: 1, value: 3 },
    { id: 40, parentGroup: 1, value: 4 },
  ]
  const candidates = createGrammarCollection(
    `recursive-${name}-candidates`,
    initialCandidates,
  )
  const left = createGrammarCollection(
    `recursive-${name}-left`,
    initialCandidates.filter(({ id }) => id % 20 === 10),
  )
  const right = createGrammarCollection(
    `recursive-${name}-right`,
    initialCandidates.filter(({ id }) => id % 20 === 0),
  )
  const anchors = createGrammarCollection(`recursive-${name}-anchors`, [
    ...initialCandidates.map(({ id, parentGroup }) => ({ id, parentGroup })),
    { id: 50, parentGroup: 1 },
  ])

  const live = createLiveQueryCollection((q) =>
    q
      .from({ parent: parents.collection })
      .orderBy(({ parent }) => parent.id)
      .select(({ parent }) => {
        const buildCandidates = (source: Collection<CandidateRow>) => {
          const correlated = q
            .from({ candidate: source })
            .where(({ candidate }) => eq(candidate.parentGroup, parent.group))
          switch (phase) {
            case `filter`:
              return correlated
                .where(({ candidate }) =>
                  lte(candidate.value, parent.parameter),
                )
                .select(({ candidate }) => ({
                  id: candidate.id,
                  parentGroup: candidate.parentGroup,
                  value: candidate.id,
                }))
            case `projection`:
              return correlated.select(({ candidate }) => ({
                id: candidate.id,
                parentGroup: candidate.parentGroup,
                value: add(candidate.value, parent.parameter),
              }))
            case `aggregate`:
              return correlated
                .groupBy(({ candidate }) => [
                  candidate.id,
                  candidate.parentGroup,
                ])
                .select(({ candidate }) => ({
                  id: candidate.id,
                  parentGroup: candidate.parentGroup,
                  value: add(count(candidate.id), parent.parameter),
                }))
            case `having`:
              return correlated
                .groupBy(({ candidate }) => [
                  candidate.id,
                  candidate.parentGroup,
                ])
                .having(({ candidate }) =>
                  gt(count(candidate.id), parent.parameter),
                )
                .select(({ candidate }) => ({
                  id: candidate.id,
                  parentGroup: candidate.parentGroup,
                  value: count(candidate.id),
                }))
            case `order-window`:
              return correlated
                .orderBy(({ candidate }) =>
                  multiply(candidate.value, parent.parameter),
                )
                .orderBy(({ candidate }) => candidate.id)
                .limit(1)
                .select(({ candidate }) => ({
                  id: candidate.id,
                  parentGroup: candidate.parentGroup,
                  value: candidate.id,
                }))
          }
        }

        // unionAll branches must use distinct lexical aliases. Keep these two
        // adapters explicit so the grammar exercises the public builder rules
        // without erasing their types behind a cast.
        const buildLeftCandidates = () => {
          const correlated = q
            .from({ leftCandidate: left.collection })
            .where(({ leftCandidate }) =>
              eq(leftCandidate.parentGroup, parent.group),
            )
          switch (phase) {
            case `filter`:
              return correlated
                .where(({ leftCandidate }) =>
                  lte(leftCandidate.value, parent.parameter),
                )
                .select(({ leftCandidate }) => ({
                  id: leftCandidate.id,
                  parentGroup: leftCandidate.parentGroup,
                  value: leftCandidate.id,
                }))
            case `projection`:
              return correlated.select(({ leftCandidate }) => ({
                id: leftCandidate.id,
                parentGroup: leftCandidate.parentGroup,
                value: add(leftCandidate.value, parent.parameter),
              }))
            case `aggregate`:
              return correlated
                .groupBy(({ leftCandidate }) => [
                  leftCandidate.id,
                  leftCandidate.parentGroup,
                ])
                .select(({ leftCandidate }) => ({
                  id: leftCandidate.id,
                  parentGroup: leftCandidate.parentGroup,
                  value: add(count(leftCandidate.id), parent.parameter),
                }))
            case `having`:
              return correlated
                .groupBy(({ leftCandidate }) => [
                  leftCandidate.id,
                  leftCandidate.parentGroup,
                ])
                .having(({ leftCandidate }) =>
                  gt(count(leftCandidate.id), parent.parameter),
                )
                .select(({ leftCandidate }) => ({
                  id: leftCandidate.id,
                  parentGroup: leftCandidate.parentGroup,
                  value: count(leftCandidate.id),
                }))
            case `order-window`:
              return correlated
                .orderBy(({ leftCandidate }) =>
                  multiply(leftCandidate.value, parent.parameter),
                )
                .orderBy(({ leftCandidate }) => leftCandidate.id)
                .limit(1)
                .select(({ leftCandidate }) => ({
                  id: leftCandidate.id,
                  parentGroup: leftCandidate.parentGroup,
                  value: leftCandidate.id,
                }))
          }
        }

        const buildRightCandidates = () => {
          const correlated = q
            .from({ rightCandidate: right.collection })
            .where(({ rightCandidate }) =>
              eq(rightCandidate.parentGroup, parent.group),
            )
          switch (phase) {
            case `filter`:
              return correlated
                .where(({ rightCandidate }) =>
                  lte(rightCandidate.value, parent.parameter),
                )
                .select(({ rightCandidate }) => ({
                  id: rightCandidate.id,
                  parentGroup: rightCandidate.parentGroup,
                  value: rightCandidate.id,
                }))
            case `projection`:
              return correlated.select(({ rightCandidate }) => ({
                id: rightCandidate.id,
                parentGroup: rightCandidate.parentGroup,
                value: add(rightCandidate.value, parent.parameter),
              }))
            case `aggregate`:
              return correlated
                .groupBy(({ rightCandidate }) => [
                  rightCandidate.id,
                  rightCandidate.parentGroup,
                ])
                .select(({ rightCandidate }) => ({
                  id: rightCandidate.id,
                  parentGroup: rightCandidate.parentGroup,
                  value: add(count(rightCandidate.id), parent.parameter),
                }))
            case `having`:
              return correlated
                .groupBy(({ rightCandidate }) => [
                  rightCandidate.id,
                  rightCandidate.parentGroup,
                ])
                .having(({ rightCandidate }) =>
                  gt(count(rightCandidate.id), parent.parameter),
                )
                .select(({ rightCandidate }) => ({
                  id: rightCandidate.id,
                  parentGroup: rightCandidate.parentGroup,
                  value: count(rightCandidate.id),
                }))
            case `order-window`:
              return correlated
                .orderBy(({ rightCandidate }) =>
                  multiply(rightCandidate.value, parent.parameter),
                )
                .orderBy(({ rightCandidate }) => rightCandidate.id)
                .limit(1)
                .select(({ rightCandidate }) => ({
                  id: rightCandidate.id,
                  parentGroup: rightCandidate.parentGroup,
                  value: rightCandidate.id,
                }))
          }
        }

        switch (boundary) {
          case `from-query-ref`: {
            const routed = q
              .from({ result: buildCandidates(candidates.collection) })
              .where(({ result }) => eq(result.parentGroup, parent.group))
              .select(({ result }) => ({
                id: result.id,
                value: result.value,
              }))
            return { id: parent.id, ...includeInEveryForm(routed) }
          }
          case `joined-query-ref`: {
            const routed = q
              .from({ anchor: anchors.collection })
              .innerJoin(
                { result: buildCandidates(candidates.collection) },
                ({ anchor, result }) => eq(anchor.id, result.id),
              )
              .where(({ anchor }) => eq(anchor.parentGroup, parent.group))
              .select(({ result }) => ({
                id: result.id,
                value: result.value,
              }))
            return { id: parent.id, ...includeInEveryForm(routed) }
          }
          case `union-branch`: {
            const routed = q
              .unionAll(buildLeftCandidates(), buildRightCandidates())
              .innerJoin({ anchor: anchors.collection }, ({ id, anchor }) =>
                eq(id, anchor.id),
              )
              .where(({ anchor }) => eq(anchor.parentGroup, parent.group))
              .select(({ id, value }) => ({ id, value }))
            return { id: parent.id, ...includeInEveryForm(routed) }
          }
        }
      }),
  )

  const modelRows = new Map(initialCandidates.map((row) => [row.id, row]))
  const leftModelIds = new Set(left.collection.toArray.map(({ id }) => id))
  const expected = (parentId: number) => {
    const parent = parents.collection.get(parentId)!
    const correlated = [...modelRows.values()].filter(
      (candidate) => candidate.parentGroup === parent.group,
    )
    switch (phase) {
      case `filter`:
        return correlated
          .filter((candidate) => candidate.value <= parent.parameter)
          .map((candidate) => ({ id: candidate.id, value: candidate.id }))
      case `projection`:
        return correlated.map((candidate) => ({
          id: candidate.id,
          value: candidate.value + parent.parameter,
        }))
      case `aggregate`:
        return correlated.map((candidate) => ({
          id: candidate.id,
          value: 1 + parent.parameter,
        }))
      case `having`:
        return parent.parameter < 1
          ? correlated.map((candidate) => ({ id: candidate.id, value: 1 }))
          : []
      case `order-window`: {
        const partitions =
          boundary === `union-branch`
            ? [
                correlated.filter(({ id }) => leftModelIds.has(id)),
                correlated.filter(({ id }) => !leftModelIds.has(id)),
              ]
            : [correlated]
        return partitions.flatMap((partition) =>
          partition
            .sort(
              (leftRow, rightRow) =>
                leftRow.value * parent.parameter -
                  rightRow.value * parent.parameter || leftRow.id - rightRow.id,
            )
            .slice(0, 1)
            .map((candidate) => ({ id: candidate.id, value: candidate.id })),
        )
      }
    }
  }

  const project = (rows: Iterable<{ id: number; value: number }>) =>
    [...rows]
      .map(({ id, value }) => ({ id, value }))
      .sort((leftRow, rightRow) => leftRow.id - rightRow.id)
  const assertParents = () => {
    for (const parent of parents.collection.toArray) {
      expectEveryForm(live.get(parent.id)!, project, expected(parent.id))
    }
  }

  try {
    await live.preload()
    assertParents()

    const updatedParameter =
      phase === `order-window`
        ? -1
        : phase === `projection` || phase === `aggregate`
          ? 30
          : phase === `having`
            ? 0
            : 4
    parents.write(`update`, { id: 1, group: 1, parameter: updatedParameter })
    assertParents()

    const inserted = {
      id: 50,
      parentGroup: 1,
      value: phase === `filter` ? 1 : 5,
    }
    modelRows.set(inserted.id, inserted)
    if (boundary === `union-branch`) right.write(`insert`, inserted)
    else candidates.write(`insert`, inserted)
    assertParents()
  } finally {
    await cleanup(live, [parents, candidates, left, right, anchors])
  }
}

async function runJoinCell({
  keySide,
  correlationAttachment,
}: JoinCell): Promise<void> {
  const name = `${keySide}-${correlationAttachment}`
  const parents = createGrammarCollection(`join-${name}-parents`, [
    { id: 1, group: 1, offset: 0 },
    { id: 2, group: 2, offset: 1 },
  ])
  const children = createGrammarCollection(`join-${name}-children`, [
    { id: 10, parentGroup: 1, tagId: 2 },
    { id: 20, parentGroup: 2, tagId: 2 },
  ])
  const tags = createGrammarCollection(`join-${name}-tags`, [
    { id: 1, parentGroup: 2, label: `one` },
    { id: 2, parentGroup: 1, label: `two` },
    { id: 3, parentGroup: 2, label: `three` },
  ])
  const live = createLiveQueryCollection((q) =>
    q
      .from({ parent: parents.collection })
      .orderBy(({ parent }) => parent.id)
      .select(({ parent }) => {
        const joined =
          keySide === `main`
            ? q
                .from({ child: children.collection })
                .innerJoin({ tag: tags.collection }, ({ child, tag }) =>
                  eq(tag.id, add(child.tagId, parent.offset)),
                )
            : q
                .from({ child: children.collection })
                .innerJoin({ tag: tags.collection }, ({ child, tag }) =>
                  eq(add(tag.id, parent.offset), child.tagId),
                )
        const routed = (
          correlationAttachment === `main`
            ? joined.where(({ child }) => eq(child.parentGroup, parent.group))
            : joined.where(({ tag }) => eq(tag.parentGroup, parent.group))
        )
          .orderBy(({ child }) => child.id)
          .select(({ child, tag }) => ({ id: child.id, value: tag.label }))
        return { id: parent.id, ...includeInEveryForm(routed) }
      }),
  )

  const expected = (parentId: number) => {
    const parent = parents.collection.get(parentId)!
    return children.collection.toArray
      .flatMap((child) =>
        tags.collection.toArray
          .filter((tag) => {
            const keyMatches =
              keySide === `main`
                ? tag.id === child.tagId + parent.offset
                : tag.id + parent.offset === child.tagId
            const routeMatches =
              correlationAttachment === `main`
                ? child.parentGroup === parent.group
                : tag.parentGroup === parent.group
            return keyMatches && routeMatches
          })
          .map((tag) => ({ id: child.id, value: tag.label })),
      )
      .sort((leftRow, rightRow) => leftRow.id - rightRow.id)
  }

  const project = (rows: Iterable<{ id: number; value: string }>) =>
    [...rows].map(({ id, value }) => ({ id, value }))
  const assertParents = () => {
    for (const parent of parents.collection.toArray) {
      expectEveryForm(live.get(parent.id)!, project, expected(parent.id))
    }
  }

  try {
    await live.preload()
    assertParents()

    parents.write(`update`, { id: 1, group: 1, offset: 1 })
    assertParents()

    children.write(`insert`, { id: 30, parentGroup: 1, tagId: 2 })
    assertParents()
  } finally {
    await cleanup(live, [parents, children, tags])
  }
}

async function runGrammarCell(cell: GrammarCell): Promise<void> {
  switch (cell.family) {
    case `lexical-scope`:
      return runLexicalScopeCell(cell)
    case `aggregation`:
      return runAggregationCell(cell)
    case `recursive-source`:
      return runRecursiveSourceCell(cell)
    case `join`:
      return runJoinCell(cell)
  }
}

describe(`correlated include route-context transport grammar`, () => {
  test(`expands every declared product without duplicate cells`, () => {
    const expectedCellCount =
      routeContextGrammar.lexicalScope.scopes.length +
      routeContextGrammar.aggregation.groupings.length *
        routeContextGrammar.aggregation.placements.length +
      routeContextGrammar.recursiveSource.boundaries.length *
        routeContextGrammar.recursiveSource.phases.length +
      routeContextGrammar.join.keySides.length *
        routeContextGrammar.join.correlationAttachments.length
    const names = grammarCells.map(grammarCellName)

    expect(grammarCells).toHaveLength(expectedCellCount)
    expect(new Set(names)).toHaveLength(expectedCellCount)
    expect(
      grammarCells.length * materializationForms.length * checkpoints.length,
    ).toBe(225)
  })

  for (const cell of grammarCells) {
    test(`${grammarCellName(cell)} × every materialization form × parent/child updates`, () =>
      runGrammarCell(cell))
  }
})
