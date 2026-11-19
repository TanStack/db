import { describe, expect } from 'vitest'
import { expectRowSnapshot } from '../conformance/row-snapshot-oracle.js'
import {
  expectedPublicField,
  expectedSelectedPublicField,
  fieldStages,
  publicFieldSymbol,
  runPublicFieldOverlapCell,
} from '../conformance/public-field-oracle.js'
import { createCollection } from '../../src/collection/index.js'
import { mockSyncCollectionOptions } from '../utils.js'
import {
  add,
  and,
  coalesce,
  count,
  createLiveQueryCollection,
  eq,
  groupKeys,
  gt,
  lt,
  lte,
  materialize,
  multiply,
  sum,
  toArray,
} from '../../src/query/index.js'
import { oracleProperty } from '../oracle-config.js'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../oracle-assertion-adapter.js'
import { requiredIncludesObservations } from './includes-state-observations.js'
import {
  checkMaterializedInputRows,
  checkOuterJoinKeyRows,
  expectedMaterializedInputRows,
  expectedOuterJoinKeyRows,
  grammarCellName,
  grammarCells,
  materializedInputCells,
  materializedInputGrammar,
  outerJoinKeyGrammar,
} from './includes-context-transport-model-oracle.js'
import { createControlledCollection } from './includes-oracle-helpers.js'
import {
  createGrammarCollection,
  expectEveryForm,
  expectNoPrivateSymbolsDeep,
  ids,
  includeInEveryForm,
  materializationForms,
  readEveryForm,
  runWithCleanup,
} from './includes-context-transport-helpers.js'
import type {
  AggregationCell,
  CorrelationDomainCell,
  DerivedResultCell,
  GrammarCell,
  JoinCell,
  LexicalScopeCell,
  MaterializedInputCell,
  MaterializedInputChild,
  MaterializedInputGrandchild,
  MaterializedInputRow,
  NamespaceCollisionCell,
  OuterKeyRow,
  ParentProjectionCell,
  PublicSurfaceCell,
  RecursiveSourceCell,
  UnionIdentityCell,
  routeContextGrammar,
} from './includes-context-transport-model-oracle.js'
import type {
  PublicFieldCell,
  PublicFieldOverlapCell,
  PublicFieldOverlapHost,
  PublicFieldOverlapRow,
  PublicFieldRow,
} from '../conformance/public-field-oracle.js'
import type { RefLeaf } from '../../src/query/builder/types.js'
import type { InitialQueryBuilder } from '../../src/query/builder/index.js'
import type { Collection } from '../../src/collection/index.js'
import type { ControlledCollection } from './includes-oracle-helpers.js'
import type {
  MaterializationForm,
  MaterializedForms,
} from './includes-context-transport-helpers.js'

/**
 * # How can a parent value cross a nested query without becoming user data?
 *
 * Contract authority: `packages/db/src/query/live/ARCHITECTURE.md`, especially
 * Route-context transport and normative route, nested-propagation, and
 * publication laws.
 *
 * A correlated include needs values from its lexical parent. The compiler
 * carries that route context through filters, projections, joins, aggregates,
 * unions, query references, and windows. The context is internal compiler
 * metadata. User callbacks and query results must never see it.
 *
 * This oracle states five laws:
 *
 * 1. Every supported query boundary preserves the parent correlation.
 * 2. Different parents keep different routes, even when they share child rows.
 * 3. Collection, `toArray`, and `materialize` produce the same public values.
 * 4. Parent and child updates recompute only from the current public sources.
 * 5. Private route metadata never leaks through rows, callbacks, symbols,
 *    opaque objects, cycles, or adversarial property names.
 *
 * One reference compiler would repeat the production compiler and risk the
 * same bugs. This file instead declares a grammar of transport boundaries.
 * Each grammar family has a small JavaScript model for its own result. The
 * production side compiles the matching live query and crosses the full
 * boundary. The suite expands the grammar across three materialization forms
 * and three checkpoints for 819 explicit observations. The public-field family
 * adds 1200 observations across five admission stages and four receiving paths.
 * This finite matrix does
 * not establish arbitrary query structures, values, or update histories.
 *
 * This suite owns route-context transport and public-data hygiene. The temporal
 * oracle owns demand lifetime. The publication oracle owns coherent callbacks.
 * The Collection oracle owns facade identity and retirement.
 *
 * The fixed path witnesses, which check dotted and nested parent fields and
 * distinct include result paths, are unit tests in
 * `includes-context-transport.test.ts`. They model a property path as its
 * sequence of segments: a parent field named `a.b` and a nested field `a.b`
 * are distinct values, as are a dotted ancestor alias and two ordinary path
 * segments. These fixed fixtures do not claim arbitrary path segments or
 * materialization forms beyond the displayed `toArray` queries.
 */

// The route-context grammar (checkpoints, routeContextGrammar, grammarCells,
// and grammarCellName) lives in includes-context-transport-model-oracle.ts.

// Law: a child row carries each parent snapshot in the form its projection
// selected, read from the current parent row, so a parent update changes every
// form.
function expectedParentSnapshots(
  parents: ControlledCollection<{ id: number; group: number; token: string }>,
  children: ControlledCollection<{ id: number; parentGroup: number }>,
  shape: (typeof routeContextGrammar.parentProjection.shapes)[number],
  parentId: number,
) {
  const parent = parents.collection.get(parentId)!
  return children.collection.toArray
    .filter((child) => child.parentGroup === parent.group)
    .map(({ id }) => ({
      id,
      parentSnapshot:
        shape === `field` ? { token: parent.token } : { ...parent },
    }))
}

async function runParentProjectionCell({
  shape,
}: ParentProjectionCell): Promise<void> {
  type ParentRow = { id: number; group: number; token: string }
  const parentRows: Array<ParentRow> = [
    { id: 1, group: 1, token: `one` },
    { id: 2, group: 1, token: `two` },
  ]
  const parents = createGrammarCollection(
    `projection-${shape}-parents`,
    parentRows,
  )
  const children = createGrammarCollection(`projection-${shape}-children`, [
    { id: 10, parentGroup: 1 },
    { id: 20, parentGroup: 1 },
  ])
  const live = createLiveQueryCollection((q) =>
    q
      .from({ parent: parents.collection })
      .orderBy(({ parent }) => parent.id)
      .select(({ parent }) => {
        const correlated = q
          .from({ child: children.collection })
          .where(({ child }) => eq(child.parentGroup, parent.group))
        const rows = correlated
          .orderBy(({ child }) => child.id)
          .select(({ child }) => ({
            id: child.id,
            parentSnapshot:
              shape === `field`
                ? { token: parent.token }
                : coalesce(parent, null),
          }))
        return { id: parent.id, ...includeInEveryForm(rows) }
      }),
  )

  const project = (rows: Iterable<{ id: number; parentSnapshot: unknown }>) =>
    [...rows].map(({ id, parentSnapshot }) => ({ id, parentSnapshot }))
  const assertParents = () => {
    for (const parent of parents.collection.toArray) {
      expectEveryForm(
        live.get(parent.id)!,
        project,
        expectedParentSnapshots(parents, children, shape, parent.id),
      )
    }
  }

  await runWithCleanup(live, [parents, children], async () => {
    await live.preload()
    assertParents()

    const updatedParent = { id: 1, group: 1, token: `updated` }
    parents.write(`update`, updatedParent)
    assertParents()

    children.write(`insert`, { id: 30, parentGroup: 1 })
    assertParents()
  })
}

// Law: a child correlates with a parent only when both correlation values are
// equal and non-null; a null value on either side matches no child.
function expectedCorrelatedIds(
  parents: ControlledCollection<{ id: number; group: number | null }>,
  children: ControlledCollection<{ id: number; parentGroup: number | null }>,
) {
  const parentGroup = parents.collection.get(1)!.group
  return children.collection.toArray
    .filter(
      (child) =>
        parentGroup != null &&
        child.parentGroup != null &&
        child.parentGroup === parentGroup,
    )
    .map(({ id }) => id)
}

async function runCorrelationDomainCell({
  state,
}: CorrelationDomainCell): Promise<void> {
  type ParentRow = { id: number; group: number | null }
  type ChildRow = { id: number; parentGroup: number | null }
  const parents = createGrammarCollection<ParentRow>(
    `correlation-${state}-parents`,
    [{ id: 1, group: state === `null` ? null : 999 }],
  )
  const children = createGrammarCollection<ChildRow>(
    `correlation-${state}-children`,
    [
      { id: 10, parentGroup: null },
      { id: 20, parentGroup: 1 },
    ],
  )
  const live = createLiveQueryCollection((q) =>
    q.from({ parent: parents.collection }).select(({ parent }) => {
      const rows = q
        .from({ child: children.collection })
        .where(({ child }) => eq(child.parentGroup, parent.group))
        .orderBy(({ child }) => child.id)
        .select(({ child }) => ({ id: child.id }))
      return { id: parent.id, ...includeInEveryForm(rows) }
    }),
  )

  const assertResult = () =>
    expectEveryForm(live.get(1)!, ids, expectedCorrelatedIds(parents, children))

  await runWithCleanup(live, [parents, children], async () => {
    await live.preload()
    assertResult()

    parents.write(`update`, { id: 1, group: 1 })
    assertResult()

    children.write(`insert`, { id: 30, parentGroup: 1 })
    assertResult()
  })
}

// Law: an immediate parent includes the children of its group whose value is
// below that parent threshold, in ascending id order.
function expectedThresholdChildIds(
  parents: ControlledCollection<{
    id: number
    group: number
    threshold: number
  }>,
  children: ControlledCollection<{
    id: number
    parentGroup: number
    group: number
    value: number
  }>,
  parentId: number,
) {
  const parent = parents.collection.get(parentId)!
  return children.collection.toArray
    .filter(
      (child) =>
        child.parentGroup === parent.group && child.value < parent.threshold,
    )
    .map(({ id }) => id)
    .sort((left, right) => left - right)
}

// Law: a lexical ancestor's threshold filters the grandchildren whose parent
// group equals the given child group.
function expectedGrandchildIds(
  parents: ControlledCollection<{
    id: number
    group: number
    threshold: number
  }>,
  grandchildren: ControlledCollection<{
    id: number
    parentGroup: number
    value: number
  }>,
  parentId: number,
  childGroup: number,
) {
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

// Law: each child of the parent carries the grandchild ids of its group,
// computed by the grandchild model, in every public form.
function expectedNestedRows(
  parents: ControlledCollection<{
    id: number
    group: number
    threshold: number
  }>,
  children: ControlledCollection<{
    id: number
    parentGroup: number
    group: number
    value: number
  }>,
  grandchildren: ControlledCollection<{
    id: number
    parentGroup: number
    value: number
  }>,
  parentId: number,
) {
  return children.collection.toArray
    .filter(
      (child) => child.parentGroup === parents.collection.get(parentId)!.group,
    )
    .map((child) => ({
      id: child.id,
      grandchildren: Object.fromEntries(
        materializationForms.map((form) => [
          form,
          expectedGrandchildIds(parents, grandchildren, parentId, child.group),
        ]),
      ),
    }))
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

    await runWithCleanup(live, [parents, children, grandchildren], async () => {
      await live.preload()
      for (const parent of parents.collection.toArray) {
        expectEveryForm(
          live.get(parent.id)!,
          ids,
          expectedThresholdChildIds(parents, children, parent.id),
        )
      }

      parents.write(`update`, { id: 1, group: 1, threshold: 4 })
      expectEveryForm(
        live.get(1)!,
        ids,
        expectedThresholdChildIds(parents, children, 1),
      )
      expectEveryForm(
        live.get(2)!,
        ids,
        expectedThresholdChildIds(parents, children, 2),
      )

      children.write(`insert`, {
        id: 30,
        parentGroup: 1,
        group: 30,
        value: 2,
      })
      for (const parent of parents.collection.toArray) {
        expectEveryForm(
          live.get(parent.id)!,
          ids,
          expectedThresholdChildIds(parents, children, parent.id),
        )
      }
    })
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
    const expectedRows = expectedNestedRows(
      parents,
      children,
      grandchildren,
      parentId,
    )
    for (const outerForm of materializationForms) {
      expect(projectOuterForm(parentId, outerForm)).toEqual(expectedRows)
    }
  }

  await runWithCleanup(live, [parents, children, grandchildren], async () => {
    await live.preload()
    assertNestedProduct(1)
    assertNestedProduct(2)

    parents.write(`update`, { id: 1, group: 1, threshold: 4 })
    assertNestedProduct(1)
    assertNestedProduct(2)

    grandchildren.write(`insert`, { id: 300, parentGroup: 10, value: 2 })
    assertNestedProduct(1)
    assertNestedProduct(2)
  })
}

// Law: an aggregate score is the children values plus the parent factor, added
// once per child inside the aggregate or once in total outside it.
function expectedAggregateScores(
  parents: ControlledCollection<{ id: number; group: number; factor: number }>,
  children: ControlledCollection<{
    id: number
    parentGroup: number
    value: number
  }>,
  placement: (typeof routeContextGrammar.aggregation.placements)[number],
  parentId: number,
) {
  const parent = parents.collection.get(parentId)!
  const total = children.collection.toArray
    .filter((child) => child.parentGroup === parent.group)
    .reduce((result, child) => result + child.value, 0)
  const childCount = children.collection.toArray.filter(
    (child) => child.parentGroup === parent.group,
  ).length
  return [
    placement === `inside-aggregate`
      ? total + childCount * parent.factor
      : total + parent.factor,
  ]
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
                .groupBy(groupKeys(({ child }) => child.parentGroup))
                .select(({ child }) => ({
                  score:
                    placement === `inside-aggregate`
                      ? sum(add(child.value, parent.factor))
                      : add(sum(child.value), parent.factor),
                }))
            : correlated.select(({ child }) => ({
                score:
                  placement === `inside-aggregate`
                    ? sum(add(child.value, parent.factor))
                    : add(sum(child.value), parent.factor),
              }))
        return { id: parent.id, ...includeInEveryForm(rows) }
      }),
  )

  const project = (rows: Iterable<{ score: number }>) =>
    [...rows].map(({ score }) => score)

  await runWithCleanup(live, [parents, children], async () => {
    await live.preload()
    for (const parent of parents.collection.toArray) {
      expectEveryForm(
        live.get(parent.id)!,
        project,
        expectedAggregateScores(parents, children, placement, parent.id),
      )
    }

    parents.write(`update`, { id: 2, group: 1, factor: 3 })
    expectEveryForm(
      live.get(2)!,
      project,
      expectedAggregateScores(parents, children, placement, 2),
    )
    expectEveryForm(
      live.get(1)!,
      project,
      expectedAggregateScores(parents, children, placement, 1),
    )

    children.write(`insert`, { id: 30, parentGroup: 1, value: 4 })
    for (const parent of parents.collection.toArray) {
      expectEveryForm(
        live.get(parent.id)!,
        project,
        expectedAggregateScores(parents, children, placement, parent.id),
      )
    }
  })
}

type CandidateRow = {
  id: number
  parentGroup: number
  value: number
}

// Law: each phase selects, for each parent, the candidate rows of its
// correlated group that the phase admits; the phase value uses the parent
// parameter.
function expectedCandidateRows(
  parents: ControlledCollection<{
    id: number
    group: number
    parameter: number
  }>,
  modelRows: ReadonlyMap<number, CandidateRow>,
  leftModelIds: ReadonlySet<number>,
  { boundary, phase }: Pick<RecursiveSourceCell, `boundary` | `phase`>,
  parentId: number,
) {
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

async function runRecursiveSourceCell({
  boundary,
  phase,
}: RecursiveSourceCell): Promise<void> {
  const name = `${boundary}-${phase}`
  // The order-window cell gives two parents opposite sort directions over the
  // same candidates. Routing only after the window would select the same rows
  // for both parents and fail the initial public-result comparison.
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
                .groupBy(
                  groupKeys(({ candidate }) => [
                    candidate.id,
                    candidate.parentGroup,
                  ]),
                )
                .select(({ candidate }) => ({
                  id: candidate.id,
                  parentGroup: candidate.parentGroup,
                  value: add(count(candidate.id), parent.parameter),
                }))
            case `having`:
              return correlated
                .groupBy(
                  groupKeys(({ candidate }) => [
                    candidate.id,
                    candidate.parentGroup,
                  ]),
                )
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
                .groupBy(
                  groupKeys(({ leftCandidate }) => [
                    leftCandidate.id,
                    leftCandidate.parentGroup,
                  ]),
                )
                .select(({ leftCandidate }) => ({
                  id: leftCandidate.id,
                  parentGroup: leftCandidate.parentGroup,
                  value: add(count(leftCandidate.id), parent.parameter),
                }))
            case `having`:
              return correlated
                .groupBy(
                  groupKeys(({ leftCandidate }) => [
                    leftCandidate.id,
                    leftCandidate.parentGroup,
                  ]),
                )
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
                .groupBy(
                  groupKeys(({ rightCandidate }) => [
                    rightCandidate.id,
                    rightCandidate.parentGroup,
                  ]),
                )
                .select(({ rightCandidate }) => ({
                  id: rightCandidate.id,
                  parentGroup: rightCandidate.parentGroup,
                  value: add(count(rightCandidate.id), parent.parameter),
                }))
            case `having`:
              return correlated
                .groupBy(
                  groupKeys(({ rightCandidate }) => [
                    rightCandidate.id,
                    rightCandidate.parentGroup,
                  ]),
                )
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
  const leftModelIds = new Set(
    initialCandidates.filter(({ id }) => id % 20 === 10).map(({ id }) => id),
  )

  const project = (rows: Iterable<{ id: number; value: number }>) =>
    [...rows]
      .map(({ id, value }) => ({ id, value }))
      .sort((leftRow, rightRow) => leftRow.id - rightRow.id)
  const assertParents = () => {
    for (const parent of parents.collection.toArray) {
      expectEveryForm(
        live.get(parent.id)!,
        project,
        expectedCandidateRows(
          parents,
          modelRows,
          leftModelIds,
          { boundary, phase },
          parent.id,
        ),
      )
    }
  }

  await runWithCleanup(
    live,
    [parents, candidates, left, right, anchors],
    async () => {
      await live.preload()
      assertParents()

      const updatedParameter =
        phase === `order-window`
          ? -1
          : phase === `projection` || phase === `aggregate`
            ? 30
            : phase === `having`
              ? 1
              : 4
      parents.write(`update`, { id: 1, group: 1, parameter: updatedParameter })
      assertParents()

      if (phase === `having`) {
        // Keep the rejected cut above, then make the child continuation visible.
        parents.write(`update`, { id: 1, group: 1, parameter: 0 })
        assertParents()
      }

      const inserted = {
        id: 50,
        parentGroup: 1,
        value: phase === `filter` ? 1 : 5,
      }
      modelRows.set(inserted.id, inserted)
      if (boundary === `union-branch`) right.write(`insert`, inserted)
      else candidates.write(`insert`, inserted)
      assertParents()
    },
  )
}

// Law: a unionAll of two candidate branches yields each correlated candidate
// value plus the parent parameter, sorted by id.
function expectedUnionRows(
  parents: ControlledCollection<{
    id: number
    group: number
    parameter: number
  }>,
  left: ControlledCollection<CandidateRow>,
  right: ControlledCollection<CandidateRow>,
  parentId: number,
) {
  const parent = parents.collection.get(parentId)!
  return [...left.collection.toArray, ...right.collection.toArray]
    .filter((candidate) => candidate.parentGroup === parent.group)
    .map((candidate) => ({
      id: candidate.id,
      value: candidate.value + parent.parameter,
    }))
    .sort((leftRow, rightRow) => leftRow.id - rightRow.id)
}

async function runUnionIdentityCell({
  form,
}: UnionIdentityCell): Promise<void> {
  const parents = createGrammarCollection(`identity-${form}-parents`, [
    { id: 1, group: 1, parameter: 10 },
    { id: 2, group: 1, parameter: 20 },
  ])
  const left = createGrammarCollection<CandidateRow>(`identity-${form}-left`, [
    { id: 10, parentGroup: 1, value: 1 },
  ])
  const right = createGrammarCollection<CandidateRow>(
    `identity-${form}-right`,
    [{ id: 20, parentGroup: 1, value: 2 }],
  )
  const anchors = createGrammarCollection(`identity-${form}-anchors`, [
    { id: 10, parentGroup: 1 },
    { id: 20, parentGroup: 1 },
  ])
  const live = createLiveQueryCollection((q) =>
    q
      .from({ parent: parents.collection })
      .orderBy(({ parent }) => parent.id)
      .select(({ parent }) => {
        const unionAllRows = () => {
          const leftRows = q
            .from({ leftCandidate: left.collection })
            .select(({ leftCandidate }) => ({
              id: leftCandidate.id,
              value: add(leftCandidate.value, parent.parameter),
            }))
          const rightRows = q
            .from({ rightCandidate: right.collection })
            .select(({ rightCandidate }) => ({
              id: rightCandidate.id,
              value: add(rightCandidate.value, parent.parameter),
            }))
          return q
            .unionAll(leftRows, rightRows)
            .innerJoin({ anchor: anchors.collection }, ({ id, anchor }) =>
              eq(id, anchor.id),
            )
            .where(({ anchor }) => eq(anchor.parentGroup, parent.group))
            .select(({ id, value }) => ({ id, value }))
        }
        const unionFromRows = () =>
          q
            .unionAll({
              leftCandidate: left.collection,
              rightCandidate: right.collection,
            })
            .innerJoin(
              { anchor: anchors.collection },
              ({ leftCandidate, rightCandidate, anchor }) =>
                eq(coalesce(leftCandidate.id, rightCandidate.id), anchor.id),
            )
            .where(({ anchor }) => eq(anchor.parentGroup, parent.group))
            .select(({ leftCandidate, rightCandidate }) => ({
              id: coalesce(leftCandidate.id, rightCandidate.id),
              value: add(
                coalesce(leftCandidate.value, rightCandidate.value),
                parent.parameter,
              ),
            }))
        return form === `union-all`
          ? { id: parent.id, ...includeInEveryForm(unionAllRows()) }
          : { id: parent.id, ...includeInEveryForm(unionFromRows()) }
      }),
  )

  const project = (rows: Iterable<{ id: number; value: number }>) =>
    [...rows]
      .map(({ id, value }) => ({ id, value }))
      .sort((leftRow, rightRow) => leftRow.id - rightRow.id)
  const keys = (parentId: number) => {
    const collection = live.get(parentId)!.collection
    return new Map(
      collection.toArray.map((row) => [row.id, collection.getKeyFromItem(row)]),
    )
  }
  const assertParents = () => {
    for (const parent of parents.collection.toArray) {
      expectEveryForm(
        live.get(parent.id)!,
        project,
        expectedUnionRows(parents, left, right, parent.id),
      )
    }
  }
  const assertRouteIndependentKeys = () => expect(keys(2)).toEqual(keys(1))

  await runWithCleanup(live, [parents, left, right, anchors], async () => {
    await live.preload()
    assertParents()
    assertRouteIndependentKeys()
    const initialKeys = keys(1)

    parents.write(`update`, { id: 1, group: 1, parameter: 30 })
    assertParents()
    expect(keys(1)).toEqual(initialKeys)
    assertRouteIndependentKeys()

    right.write(`update`, { id: 20, parentGroup: 1, value: 5 })
    assertParents()
    expect(keys(1)).toEqual(initialKeys)
    assertRouteIndependentKeys()
  })
}

type DerivedCandidateRow = {
  id: number
  value: number | null
}

// Law: a derived value joins each anchor whose value equals a non-null
// candidate value and whose parent group is the parent group.
function expectedDerivedRows(
  parents: ControlledCollection<{ id: number; group: number }>,
  modelRows: ReadonlyMap<number, DerivedCandidateRow>,
  anchors: ControlledCollection<{
    id: number
    parentGroup: number
    value: number
  }>,
  parentId: number,
) {
  const parent = parents.collection.get(parentId)!
  return [...modelRows.values()]
    .flatMap((candidate) =>
      anchors.collection.toArray
        .filter(
          (anchor) =>
            candidate.value != null &&
            anchor.value === candidate.value &&
            anchor.parentGroup === parent.group,
        )
        .map((anchor) => ({ id: anchor.id, value: candidate.value })),
    )
    .sort((leftRow, rightRow) => leftRow.id - rightRow.id)
}

async function runDerivedResultCell({
  boundary,
  selection,
  domain,
}: DerivedResultCell): Promise<void> {
  const name = `${boundary}-${selection}-${domain}`
  const parents = createGrammarCollection(`derived-${name}-parents`, [
    { id: 1, group: 1 },
    { id: 2, group: 2 },
  ])
  const initialCandidates: Array<DerivedCandidateRow> = [
    { id: 10, value: 10 },
    { id: 15, value: domain === `nullable` ? null : 15 },
    { id: 20, value: 20 },
  ]
  const candidates = createGrammarCollection(
    `derived-${name}-candidates`,
    initialCandidates,
  )
  const left = createGrammarCollection(
    `derived-${name}-left`,
    initialCandidates.filter(({ id }) => id !== 20),
  )
  const right = createGrammarCollection(
    `derived-${name}-right`,
    initialCandidates.filter(({ id }) => id === 20),
  )
  const anchors = createGrammarCollection(`derived-${name}-anchors`, [
    { id: 100, parentGroup: 1, value: 10 },
    { id: 200, parentGroup: 2, value: 20 },
    { id: 300, parentGroup: 2, value: 30 },
  ])

  const live = createLiveQueryCollection((q) =>
    q
      .from({ parent: parents.collection })
      .orderBy(({ parent }) => parent.id)
      .select(({ parent }) => {
        if (boundary === `union-all`) {
          const leftRows = q.from({ leftCandidate: left.collection })
          const rightRows = q.from({ rightCandidate: right.collection })
          const values =
            selection === `expression`
              ? q.unionAll(
                  leftRows.select(({ leftCandidate }) =>
                    coalesce(leftCandidate.value, null),
                  ),
                  rightRows.select(({ rightCandidate }) =>
                    coalesce(rightCandidate.value, null),
                  ),
                )
              : q.unionAll(
                  leftRows.fn.select(
                    ({ leftCandidate }) => leftCandidate.value,
                  ),
                  rightRows.fn.select(
                    ({ rightCandidate }) => rightCandidate.value,
                  ),
                )
          const rows = q
            .from({ anchor: anchors.collection })
            .innerJoin({ value: values }, ({ anchor, value }) =>
              eq(anchor.value, value),
            )
            .where(({ anchor }) => eq(anchor.parentGroup, parent.group))
            .select(({ anchor, value }) => ({ id: anchor.id, value }))
          return { id: parent.id, ...includeInEveryForm(rows) }
        }

        if (selection === `expression`) {
          const values = q
            .from({ candidate: candidates.collection })
            .select(({ candidate }) => coalesce(candidate.value, null))
          if (boundary === `from-query-ref`) {
            const rows = q
              .from({ value: values })
              .innerJoin({ anchor: anchors.collection }, ({ value, anchor }) =>
                eq(value, anchor.value),
              )
              .where(({ anchor }) => eq(anchor.parentGroup, parent.group))
              .select(({ anchor, value }) => ({ id: anchor.id, value }))
            return { id: parent.id, ...includeInEveryForm(rows) }
          }

          const rows = q
            .from({ anchor: anchors.collection })
            .innerJoin({ value: values }, ({ anchor, value }) =>
              eq(anchor.value, value),
            )
            .where(({ anchor }) => eq(anchor.parentGroup, parent.group))
            .select(({ anchor, value }) => ({ id: anchor.id, value }))
          return { id: parent.id, ...includeInEveryForm(rows) }
        }

        const values = q
          .from({ candidate: candidates.collection })
          .fn.select(({ candidate }) => candidate.value)
        if (boundary === `from-query-ref`) {
          const rows = q
            .from({ value: values })
            .innerJoin({ anchor: anchors.collection }, ({ value, anchor }) =>
              eq(value, anchor.value),
            )
            .where(({ anchor }) => eq(anchor.parentGroup, parent.group))
            .select(({ anchor, value }) => ({ id: anchor.id, value }))
          return { id: parent.id, ...includeInEveryForm(rows) }
        }

        const rows = q
          .from({ anchor: anchors.collection })
          .innerJoin({ value: values }, ({ anchor, value }) =>
            eq(anchor.value, value),
          )
          .where(({ anchor }) => eq(anchor.parentGroup, parent.group))
          .select(({ anchor, value }) => ({ id: anchor.id, value }))
        return { id: parent.id, ...includeInEveryForm(rows) }
      }),
  )

  const modelRows = new Map(initialCandidates.map((row) => [row.id, row]))
  const project = (
    rows: Iterable<{ id: number; value: number | null | undefined }>,
  ) =>
    [...rows]
      .map(({ id, value }) => ({ id, value }))
      .sort((leftRow, rightRow) => leftRow.id - rightRow.id)
  const assertParents = () => {
    for (const parent of parents.collection.toArray) {
      expectEveryForm(
        live.get(parent.id)!,
        project,
        expectedDerivedRows(parents, modelRows, anchors, parent.id),
      )
    }
  }

  await runWithCleanup(
    live,
    [parents, candidates, left, right, anchors],
    async () => {
      await live.preload()
      assertParents()

      parents.write(`update`, { id: 1, group: 2 })
      assertParents()

      const updated = { id: 20, value: 30 }
      modelRows.set(updated.id, updated)
      if (boundary === `union-all`) right.write(`update`, updated)
      else candidates.write(`update`, updated)
      assertParents()
    },
  )
}

// Law: a join pairs a child with each tag whose key matches under the join side
// and whose route attachment matches the parent group.
function expectedJoinRows(
  parents: ControlledCollection<{ id: number; group: number; offset: number }>,
  children: ControlledCollection<{
    id: number
    parentGroup: number
    tagId: number
  }>,
  tags: ControlledCollection<{
    id: number
    parentGroup: number
    label: string
  }>,
  {
    keySide,
    correlationAttachment,
  }: Pick<JoinCell, `keySide` | `correlationAttachment`>,
  parentId: number,
) {
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

  const project = (rows: Iterable<{ id: number; value: string }>) =>
    [...rows].map(({ id, value }) => ({ id, value }))
  const assertParents = () => {
    for (const parent of parents.collection.toArray) {
      expectEveryForm(
        live.get(parent.id)!,
        project,
        expectedJoinRows(
          parents,
          children,
          tags,
          { keySide, correlationAttachment },
          parent.id,
        ),
      )
    }
  }

  await runWithCleanup(live, [parents, children, tags], async () => {
    await live.preload()
    assertParents()

    parents.write(`update`, { id: 1, group: 1, offset: 1 })
    assertParents()

    children.write(`insert`, { id: 30, parentGroup: 1, tagId: 2 })
    assertParents()
  })
}

// Law: the parent group and token select the children whose label is the
// included value under the parent alias or field name.
function expectedCollisionRows(
  parents: ControlledCollection<{ id: number; group: number; token: string }>,
  children: ControlledCollection<{
    id: number
    parentGroup: number
    token: string
    label: string
  }>,
) {
  const group = parents.collection.get(1)!.group
  return children.collection.toArray
    .filter(
      (child) =>
        child.parentGroup === group &&
        child.token === parents.collection.get(1)!.token,
    )
    .map((child) => ({ id: child.id, value: child.label }))
}

async function runNamespaceCollisionCell({
  location,
  boundary,
  name,
}: NamespaceCollisionCell): Promise<void> {
  const cellName = `collision-${location}-${boundary}-${name}`
  const parents = createGrammarCollection(`${cellName}-parents`, [
    { id: 1, group: 1, token: `one` },
  ])
  const children = createGrammarCollection(`${cellName}-children`, [
    { id: 10, parentGroup: 1, token: `one`, label: `one` },
    { id: 20, parentGroup: 2, token: `two`, label: `two` },
    { id: 11, parentGroup: 1, token: `two`, label: `group-only` },
    { id: 21, parentGroup: 2, token: `one`, label: `token-only` },
  ])
  const tags = createGrammarCollection(`${cellName}-tags`, [
    { id: 10 },
    { id: 20 },
    { id: 11 },
    { id: 21 },
  ])
  const live =
    location === `parent-alias`
      ? createLiveQueryCollection((q) =>
          q.from({ [name]: parents.collection }).select((sources) => {
            // This computed alias names the sole, non-optional main source.
            const parent = sources[name]!
            const correlated = q
              .from({ child: children.collection })
              .where(({ child }) =>
                and(
                  eq(child.parentGroup, parent.group),
                  eq(child.token, parent.token),
                ),
              )
            const forms = (() => {
              switch (boundary) {
                case `direct`:
                  return includeInEveryForm(
                    correlated.select(({ child }) => ({
                      id: child.id,
                      value: child.label,
                    })),
                  )
                case `query-ref`: {
                  const projected = correlated.select(({ child }) => ({
                    id: child.id,
                    parentGroup: child.parentGroup,
                    label: child.label,
                  }))
                  return includeInEveryForm(
                    q
                      .from({ result: projected })
                      .where(({ result }) =>
                        eq(result.parentGroup, parent.group),
                      )
                      .select(({ result }) => ({
                        id: result.id,
                        value: result.label,
                      })),
                  )
                }
                case `join`:
                  return includeInEveryForm(
                    correlated
                      .innerJoin({ tag: tags.collection }, ({ child, tag }) =>
                        eq(child.id, tag.id),
                      )
                      .select(({ child }) => ({
                        id: child.id,
                        value: child.label,
                      })),
                  )
                case `group`:
                  return includeInEveryForm(
                    correlated
                      .groupBy(
                        groupKeys(({ child }) => [child.id, child.label]),
                      )
                      .select(({ child }) => ({
                        id: child.id,
                        value: child.label,
                      })),
                  )
              }
            })()
            return { id: parent.id, ...forms }
          }),
        )
      : createLiveQueryCollection((q) =>
          q.from({ parent: parents.collection }).select(({ parent }) => {
            const correlated = q
              .from({ child: children.collection })
              .where(({ child }) =>
                and(
                  eq(child.parentGroup, parent.group),
                  eq(child.token, parent.token),
                ),
              )
            const forms = (() => {
              switch (boundary) {
                case `direct`:
                  return includeInEveryForm(
                    correlated.select(({ child }) => ({
                      id: child.id,
                      [name]: child.label,
                    })),
                  )
                case `query-ref`: {
                  const projected = correlated.select(({ child }) => ({
                    id: child.id,
                    parentGroup: child.parentGroup,
                    label: child.label,
                  }))
                  return includeInEveryForm(
                    q
                      .from({ result: projected })
                      .where(({ result }) =>
                        eq(result.parentGroup, parent.group),
                      )
                      .select(({ result }) => ({
                        id: result.id,
                        [name]: result.label,
                      })),
                  )
                }
                case `join`:
                  return includeInEveryForm(
                    correlated
                      .innerJoin({ tag: tags.collection }, ({ child, tag }) =>
                        eq(child.id, tag.id),
                      )
                      .select(({ child }) => ({
                        id: child.id,
                        [name]: child.label,
                      })),
                  )
                case `group`:
                  return includeInEveryForm(
                    correlated
                      .groupBy(
                        groupKeys(({ child }) => [child.id, child.label]),
                      )
                      .select(({ child }) => ({
                        id: child.id,
                        [name]: child.label,
                      })),
                  )
              }
            })()
            return { id: parent.id, ...forms }
          }),
        )

  const project = (rows: Iterable<Record<string, unknown>>) =>
    [...rows].map((row) => ({
      id: row.id,
      value: location === `parent-alias` ? row.value : row[name],
    }))
  const assertCurrent = () =>
    expectEveryForm(
      live.get(1)! as MaterializedForms<Record<string, unknown>>,
      project,
      expectedCollisionRows(parents, children),
    )

  await runWithCleanup(live, [parents, children, tags], async () => {
    await live.preload()
    assertCurrent()

    parents.write(`update`, { id: 1, group: 2, token: `two` })
    assertCurrent()

    children.write(`update`, {
      id: 20,
      parentGroup: 2,
      token: `two`,
      label: `updated`,
    })
    assertCurrent()
  })
}

class PublicSurfaceBox {
  readonly map: Map<string, unknown>
  readonly set: Set<unknown>

  constructor(readonly row: unknown) {
    this.map = new Map([[`row`, row]])
    this.set = new Set([row])
  }
}

async function runPublicSurfaceCell({
  shape,
}: PublicSurfaceCell): Promise<void> {
  const callbackRows: Array<unknown> = []
  const parents = createGrammarCollection(`surface-${shape}-parents`, [
    { id: 1, group: 1 },
  ])
  const first = new Date(`2026-01-01T00:00:00.000Z`)
  const second = new Date(`2026-01-02T00:00:00.000Z`)
  const third = new Date(`2026-01-03T00:00:00.000Z`)
  const firstPayload = { token: `first` }
  const secondPayload = { token: `second` }
  const userSymbol = Symbol(`user-owned`)
  const createAdversarialPayload = (marker: string) => {
    const value: {
      safe: string
      __proto__: { marker: string }
      row?: unknown
    } = { safe: marker, [`__proto__`]: { marker } }
    return value
  }
  const firstAdversarial = createAdversarialPayload(`first`)
  const secondAdversarial = createAdversarialPayload(`second`)
  const children = createGrammarCollection(`surface-${shape}-children`, [
    {
      id: 10,
      parentGroup: 1,
      value: first,
      payload: firstPayload,
      adversarial: firstAdversarial,
      symbols: { [userSymbol]: `first` },
      label: `ten`,
    },
    {
      id: 20,
      parentGroup: 2,
      value: second,
      payload: secondPayload,
      adversarial: secondAdversarial,
      symbols: { [userSymbol]: `second` },
      label: `twenty`,
    },
  ])
  const candidates = createGrammarCollection(`surface-${shape}-candidates`, [
    { id: 10, value: first },
    { id: 20, value: second },
  ])
  const anchors = createGrammarCollection(`surface-${shape}-anchors`, [
    { id: 100, parentGroup: 1, value: first },
    { id: 200, parentGroup: 2, value: second },
    { id: 300, parentGroup: 2, value: third },
  ])
  const tags = createGrammarCollection(`surface-${shape}-tags`, [
    { id: 1000, childId: 10, label: `first` },
    { id: 2000, childId: 20, label: `second` },
  ])

  const live = createLiveQueryCollection((q) =>
    q.from({ parent: parents.collection }).select(({ parent }) => {
      if (shape === `object-query-ref-scalar`) {
        const values = q
          .from({ candidate: candidates.collection })
          .fn.select(({ candidate }) => candidate.value)
        const rows = q
          .from({ anchor: anchors.collection })
          .innerJoin({ value: values }, ({ anchor, value }) =>
            eq(anchor.value, value),
          )
          .where(({ anchor }) => eq(anchor.parentGroup, parent.group))
          .select(({ anchor, value }) => ({ id: anchor.id, value }))
        return { id: parent.id, ...includeInEveryForm(rows) }
      }

      const correlated = q
        .from({ child: children.collection })
        .where(({ child }) => eq(child.parentGroup, parent.group))
      if (shape === `nested-functional-spread`) {
        const rows = correlated.fn.select((row) => ({
          id: row.child.id,
          nested: { ...row },
        }))
        return { id: parent.id, ...includeInEveryForm(rows) }
      }

      if (shape === `opaque-wrapper`) {
        const rows = correlated.fn
          .where((row) => {
            callbackRows.push(row)
            return true
          })
          .fn.select((row) => ({
            id: row.child.id,
            box: new PublicSurfaceBox(row),
          }))
        return { id: parent.id, ...includeInEveryForm(rows) }
      }

      if (shape === `functional-having-input`) {
        const rows = correlated
          .groupBy(groupKeys(({ child }) => child.parentGroup))
          .select(({ child }) => ({
            parentGroup: child.parentGroup,
            total: count(child.id),
          }))
          .fn.having((row) => {
            callbackRows.push(row)
            return true
          })
        return { id: parent.id, ...includeInEveryForm(rows) }
      }

      if (shape === `nested-reference`) {
        const rows = correlated.select(({ child }) => ({
          id: child.id,
          payload: child.payload,
        }))
        return { id: parent.id, ...includeInEveryForm(rows) }
      }

      if (shape === `adversarial-key`) {
        const rows = correlated.fn.select((row) => {
          const payload = createAdversarialPayload(row.child.adversarial.safe)
          payload.row = row
          return { id: row.child.id, payload }
        })
        return { id: parent.id, ...includeInEveryForm(rows) }
      }

      if (shape === `user-symbol`) {
        const rows = correlated.fn.select((row) => ({
          id: row.child.id,
          payload: { ...row.child.symbols, row },
        }))
        return { id: parent.id, ...includeInEveryForm(rows) }
      }

      const rows = correlated.innerJoin(
        { tag: tags.collection },
        ({ child, tag }) => eq(child.id, tag.childId),
      )
      return { id: parent.id, ...includeInEveryForm(rows) }
    }),
  )

  const assertCurrent = () => {
    expect(live.toArray.map(({ id }) => id)).toEqual([1])
    const forms = live.get(1)!
    const rowsByForm = [
      [...forms.collection.values()],
      [...forms.array],
      [...forms.materialized],
    ]
    for (const rows of rowsByForm) {
      expect(rows).toHaveLength(1)
      for (const row of rows) {
        expectNoPrivateSymbolsDeep(row, new Set([userSymbol]))
      }
    }
    // Retain earlier callback values: later graph work must not contaminate
    // objects already handed to user code with private route metadata.
    for (const row of callbackRows) {
      expectNoPrivateSymbolsDeep(row, new Set([userSymbol]))
    }

    if (shape === `object-query-ref-scalar`) {
      const expected =
        parents.collection.get(1)!.group === 1
          ? [{ id: 100, value: first }]
          : candidates.collection.get(20)!.value === second
            ? [{ id: 200, value: second }]
            : [{ id: 300, value: third }]
      for (const rows of rowsByForm) {
        expect(rows).toHaveLength(1)
        expect((rows[0] as any).id).toBe(expected[0]!.id)
        expect((rows[0] as any).value).toBe(expected[0]!.value)
      }
      return
    }

    if (shape === `nested-functional-spread`) {
      const child =
        parents.collection.get(1)!.group === 1
          ? children.collection.get(10)!
          : children.collection.get(20)!
      for (const rows of rowsByForm) {
        expect(
          rows.map((row: any) => ({
            id: row.id,
            child: row.nested.child,
          })),
        ).toEqual([{ id: child.id, child }])
      }
      return
    }

    const child =
      parents.collection.get(1)!.group === 1
        ? children.collection.get(10)!
        : children.collection.get(20)!

    if (shape === `opaque-wrapper`) {
      for (const rows of rowsByForm) {
        expect(rows).toHaveLength(1)
        const row = rows[0] as any
        expect(row.box).toBeInstanceOf(PublicSurfaceBox)
        expect(row.box.row.child.id).toBe(child.id)
        expect(row.box.row.child.label).toBe(child.label)
        expect(row.box.map.get(`row`)).toBe(row.box.row)
        expect(row.box.set.has(row.box.row)).toBe(true)
      }
      return
    }

    if (shape === `nested-reference`) {
      for (const rows of rowsByForm) {
        expect((rows[0] as any).payload).toBe(child.payload)
      }
      return
    }

    if (shape === `functional-having-input`) {
      const total = children.collection.toArray.filter(
        ({ parentGroup }) => parentGroup === parents.collection.get(1)!.group,
      ).length
      for (const rows of rowsByForm) {
        expect(
          rows.map((row: any) => ({
            parentGroup: row.parentGroup,
            total: row.total,
          })),
        ).toEqual([{ parentGroup: child.parentGroup, total }])
      }
      return
    }

    if (shape === `adversarial-key`) {
      for (const rows of rowsByForm) {
        const payload = (rows[0] as any).payload
        expect(Object.prototype.hasOwnProperty.call(payload, `__proto__`)).toBe(
          true,
        )
        expect(Object.getPrototypeOf(payload)).toBe(Object.prototype)
        expect(payload.__proto__).toEqual({
          marker: child.adversarial.__proto__.marker,
        })
        expect(payload.row.child.id).toBe(child.id)
      }
      return
    }

    if (shape === `user-symbol`) {
      for (const [index, rows] of rowsByForm.entries()) {
        expect(
          (rows[0] as any).payload[userSymbol],
          materializationForms[index],
        ).toBe(child.symbols[userSymbol])
        expect((rows[0] as any).payload.row.child.id).toBe(child.id)
      }
      return
    }

    const tag = tags.collection.toArray.find(
      ({ childId }) => childId === child.id,
    )!
    for (const rows of rowsByForm) {
      expect(
        rows.map((row: any) => ({ child: row.child, tag: row.tag })),
      ).toEqual([{ child, tag }])
    }
  }

  await runWithCleanup(
    live,
    [parents, children, candidates, anchors, tags],
    async () => {
      await live.preload()
      assertCurrent()

      parents.write(`update`, { id: 1, group: 2 })
      assertCurrent()

      if (shape === `object-query-ref-scalar`) {
        candidates.write(`update`, { id: 20, value: third })
      } else if (shape === `functional-having-input`) {
        children.write(`insert`, {
          id: 30,
          parentGroup: 2,
          value: third,
          payload: { token: `third` },
          adversarial: createAdversarialPayload(`third`),
          symbols: { [userSymbol]: `third` },
          label: `thirty`,
        })
      } else if (shape === `nested-reference`) {
        children.write(`update`, {
          ...children.collection.get(20)!,
          payload: { token: `updated` },
        })
      } else if (shape === `adversarial-key`) {
        children.write(`update`, {
          ...children.collection.get(20)!,
          adversarial: createAdversarialPayload(`updated`),
        })
      } else if (shape === `user-symbol`) {
        children.write(`update`, {
          ...children.collection.get(20)!,
          symbols: { [userSymbol]: `updated` },
        })
      } else {
        children.write(`update`, {
          ...children.collection.get(20)!,
          label: `updated`,
        })
      }
      assertCurrent()
    },
  )
}

/**
 * Whole-row and spread selection preserve enumerable own source data fields,
 * including inherited-name shadows and user symbols. Authority: live-queries.md's
 * "Include all user fields" and ARCHITECTURE.md's public-boundary preservation.
 * Authored alias paths retain their separate restrictions. These keys are data.
 *
 * The independent model constructs immutable scalar-version rows. Every key
 * crosses absent, admitted, own undefined, omitted, and readmitted stages at
 * both root and nested locations. A version field forces every stage through
 * change-event equality. The source assertion proves admission before querying.
 * Root Collections and all three correlated forms use the same comparison at
 * the synchronous source-write cut. No asynchronous or descriptor claim is
 * added by this finite field-data family.
 */
function selectPublicFields(
  q: InitialQueryBuilder,
  source: Collection<PublicFieldRow>,
  cell: PublicFieldCell,
  group: number | RefLeaf<number> = 1,
) {
  const base = q
    .from({ row: source })
    .where(({ row }) => eq(row.parentGroup, group))
  if (cell.selection === `implicit`) return base
  if (cell.selection === `functional`)
    return base.fn.select(({ row }) => ({
      ...row,
      ...(cell.location === `nested` ? { payload: { ...row.payload } } : {}),
    }))
  if (cell.selection === `whole-row`)
    return cell.location === `root`
      ? base.select(({ row }) => row)
      : base.select(({ row }) => ({
          id: row.id,
          parentGroup: row.parentGroup,
          version: row.version,
          payload: row.payload,
        }))
  return cell.location === `root`
    ? base.select(({ row }) => ({ ...row }))
    : base.select(({ row }) => ({
        id: row.id,
        parentGroup: row.parentGroup,
        version: row.version,
        ...(cell.destination === `wrapper.toString`
          ? { wrapper: { toString: { ...row.payload } } }
          : { [cell.destination]: { ...row.payload } }),
      }))
}
async function runPublicFieldCell(cell: PublicFieldCell): Promise<void> {
  const paths = [`root`, ...materializationForms] as const
  const stages = [
    `initial-absence`,
    `admission`,
    `own-undefined`,
    `omission`,
    `readmission`,
  ]
  const reach = requiredIncludesObservations(grammarCellName(cell), [
    ...paths,
    ...stages,
  ])
  reach.beginHistory()
  const source = createControlledCollection(
    `public-field`,
    [expectedPublicField(cell, 0)],
    { rowUpdateMode: `full` },
  )
  const parents = createGrammarCollection(`public-field-parent`, [
    { id: 1, group: 1 },
  ])
  const root = createLiveQueryCollection((q) =>
    selectPublicFields(q, source.collection, cell),
  )
  const nested = createLiveQueryCollection((q) =>
    q.from({ parent: parents.collection }).select(({ parent }) => ({
      id: parent.id,
      ...includeInEveryForm(
        selectPublicFields(q, source.collection, cell, parent.group),
      ),
    })),
  )
  await runWithCleanup(root, [source, parents], () =>
    runWithCleanup(nested, [], async () => {
      await Promise.all([root.preload(), nested.preload()])
      const failures: Array<Error> = []
      for (const version of fieldStages) {
        if (version > 0)
          source.write(`update`, expectedPublicField(cell, version))
        const expected = expectedSelectedPublicField(cell, version)
        expectRowSnapshot(
          source.collection.get(10),
          expectedPublicField(cell, version),
          `source admitted fields`,
        )
        const compare = (rows: Iterable<unknown>, path: string) => {
          const values = [...rows]
          reach.reach(path)
          // A root mismatch must not prevent the correlated receiving paths
          // from reaching their own comparisons in this same history.
          try {
            expect(values, `complete ${path} result`).toHaveLength(1)
            expectRowSnapshot(values[0], expected, `${path} own data`)
            expectNoPrivateSymbolsDeep(values[0], new Set([publicFieldSymbol]))
          } catch (cause) {
            failures.push(new Error(`${path}, stage ${version}`, { cause }))
          }
        }
        compare(root.toArray, `root`)
        const forms = nested.get(1)!
        compare(forms.collection.values(), `collection`)
        compare(forms.array, `array`)
        compare(forms.materialized, `materialized`)
        reach.reach(stages[version]!)
      }
      if (failures.length)
        throw new AggregateError(failures, `Public source fields were lost`)
    }),
  )
  reach.assertReached()
}

// Each receiving path gets a fresh source. Sharing one source across four
// queries could let one corrupting projection supply another query's premise.
// The common history/checker owns scalar expectations and retained references;
// this driver supplies only real Core source writes and the selected public form.
async function runPublicFieldOverlapPaths(cell: PublicFieldOverlapCell) {
  const failures: Array<Error> = []
  for (const path of [`root`, ...materializationForms] as const) {
    const parents = createGrammarCollection(`overlap-parent`, [
      { id: 1, group: 1 },
    ])
    const host: PublicFieldOverlapHost = {
      name: `core.${path}`,
      makeSource<T extends { id: string }>(initialData: ReadonlyArray<T>) {
        const options = mockSyncCollectionOptions<T>({
          id: `overlap-${grammarCellName(cell)}-${path}`,
          getKey: (row) => row.id,
          initialData: [...initialData],
          rowUpdateMode: `full`,
        })
        const collection = createCollection(options)
        const write = (type: `insert` | `update` | `delete`, value: T) => {
          options.utils.begin()
          options.utils.write({ type, value })
          options.utils.commit()
        }
        return {
          collection,
          insert: (row: T) => write(`insert`, row),
          update: (row: T) => write(`update`, row),
          remove: (row: T) => write(`delete`, row),
        }
      },
      mount(build) {
        const live =
          path === `root`
            ? createLiveQueryCollection(build)
            : createLiveQueryCollection((q) =>
                q.from({ parent: parents.collection }).select(({ parent }) => ({
                  id: parent.id,
                  ...includeInEveryForm(
                    build(q).where(({ row }: { row: PublicFieldOverlapRow }) =>
                      eq(row.parentGroup, parent.group),
                    ),
                  ),
                })),
              )
        return {
          apply: (write) => {
            write()
            return Promise.resolve()
          },
          flush: () => live.preload(),
          unmount: () => {},
          collection: () => live,
          read: () =>
            path === `root` ? live.toArray : [...live.get(1)![path].values()],
        }
      },
    }
    try {
      await runPublicFieldOverlapCell(host, cell)
    } catch (cause) {
      failures.push(new Error(`${path}: overlapping projection`, { cause }))
    } finally {
      try {
        await parents.collection.cleanup()
      } catch (cause) {
        failures.push(new Error(`${path}: parent cleanup failed`, { cause }))
      }
    }
  }
  if (failures.length)
    throw new AggregateError(
      failures,
      `Overlapping source paths changed borrowed data or failed`,
    )
}

async function runGrammarCell(cell: GrammarCell): Promise<void> {
  switch (cell.family) {
    case `parent-projection`:
      return runParentProjectionCell(cell)
    case `correlation-domain`:
      return runCorrelationDomainCell(cell)
    case `lexical-scope`:
      return runLexicalScopeCell(cell)
    case `aggregation`:
      return runAggregationCell(cell)
    case `recursive-source`:
      return runRecursiveSourceCell(cell)
    case `join`:
      return runJoinCell(cell)
    case `union-identity`:
      return runUnionIdentityCell(cell)
    case `derived-result`:
      return runDerivedResultCell(cell)
    case `namespace-collision`:
      return runNamespaceCollisionCell(cell)
    case `public-field`:
      return runPublicFieldCell(cell)
    case `public-field-overlap`:
      return runPublicFieldOverlapPaths(cell)
    case `public-surface`:
      return runPublicSurfaceCell(cell)
  }
}

// Each grammar cell is checked against the models below. Each expectation is
// computed from the source Collections, not written as a value.
const routeContextLaw = `Each parent reference is discovered across nested includes, QueryRef sources, union branches, and joined sources, enters route identity, is attached before the first operator that evaluates it, and is preserved through later boundaries.`
const materializedInputLaw = `An inherited inline input keeps each parent's route: a child's membership depends only on its parent's group, and its nested array holds exactly the grandchildren naming it.`

// Grammar cells are enumerated by name, because a public-field cell can hold a
// symbol key, which is not history data. Resolution finds the cell again.
const grammarCellsByName = new Map(
  grammarCells.map((cell) => [grammarCellName(cell), cell]),
)
const observationsOf = (cell: GrammarCell) =>
  cell.family === `public-field` || cell.family === `public-field-overlap`
    ? `root and correlated forms × field admission stages`
    : `every materialization form × parent/child updates`

describe(`correlated include route-context transport grammar`, () => {
  oracleProperty({
    id: `includes-context-transport.grammar`,
    law: {
      statement: routeContextLaw,
      authority: `Route-context transport in packages/db/src/query/live/ARCHITECTURE.md (discovery, route identity, attachment before evaluation, and preservation across recursive and join boundaries), stated at the start of this owner.`,
      limits: `Every declared route-context grammar cell, enumerated by name, over small finite source Collections, three public forms, and the listed updates.`,
    },
    owns: [
      `src/collection/index.ts#createCollection`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
    ],
    histories: grammarCells.map(grammarCellName),
    label: (name) =>
      `${name} × ${observationsOf(grammarCellsByName.get(name)!)}`,
    resolve: (name) => ({ cell: grammarCellsByName.get(name)! }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(routeContextLaw, plan, observe, () =>
        runGrammarCell(plan.cell),
      ),
    check: forwardAssertionJudgment,
  })
})

// Law: a compound join pairs a child with a peer when the first equality holds
// and the second equality holds with the parent parameter on the chosen side.
function expectedCompoundRows(
  children: ControlledCollection<{
    id: number
    group: number
    a: number
    b: number
  }>,
  peers: ControlledCollection<{ id: number; a: number; b: number }>,
  parentSide: `main` | `joined`,
  parent: { group: number; parameter: number },
) {
  return children.collection.toArray.flatMap((child) =>
    peers.collection.toArray
      .filter(
        (peer) =>
          child.group === parent.group &&
          child.a === peer.a &&
          (parentSide === `main`
            ? child.b + parent.parameter === peer.b
            : child.b === peer.b + parent.parameter),
      )
      .map((peer) => ({ id: child.id, peerId: peer.id })),
  )
}

const compoundJoinLaw = `A parent value used only in the second join equality is still route context, so each parent pairs children with peers by its own parameter.`

// The former case body, unchanged, for one boundary and parent side.
async function judgeCompoundParentContext(
  boundary: `direct` | `queryRef`,
  parentSide: `main` | `joined`,
): Promise<void> {
  const parents = createGrammarCollection(`compound-parents`, [
    { id: 1, group: 1, parameter: 1 },
    { id: 2, group: 1, parameter: 2 },
  ])
  const children = createGrammarCollection(`compound-children`, [
    { id: 10, group: 1, a: 1, b: 1 },
    { id: 11, group: 1, a: 1, b: 2 },
  ])
  const peers = createGrammarCollection(`compound-peers`, [
    { id: 20, a: 1, b: 2 },
    { id: 21, a: 1, b: 3 },
  ])
  let cleanupLive: () => Promise<void> = async () => {}
  await runWithCleanup(
    { cleanup: () => cleanupLive() },
    [parents, children, peers],
    async () => {
      const live = createLiveQueryCollection((q) =>
        q.from({ parent: parents.collection }).select(({ parent }) => {
          const base = q
            .from({ child: children.collection })
            .where(({ child }) => eq(child.group, parent.group))
          const joinCondition = ({
            child,
            peer,
          }: {
            child: {
              a: RefLeaf<number>
              b: RefLeaf<number>
            }
            peer: {
              a: RefLeaf<number>
              b: RefLeaf<number>
            }
          }) =>
            and(
              eq(child.a, peer.a),
              parentSide === `main`
                ? eq(add(child.b, parent.parameter), peer.b)
                : eq(child.b, add(peer.b, parent.parameter)),
            )
          const joined =
            boundary === `direct`
              ? base.innerJoin({ peer: peers.collection }, joinCondition)
              : base.innerJoin(
                  {
                    peer: q
                      .from({ peer: peers.collection })
                      .select(({ peer }) => ({
                        id: peer.id,
                        a: peer.a,
                        b: peer.b,
                      })),
                  },
                  joinCondition,
                )
          const rows = joined.select(({ child, peer }) => ({
            id: child.id,
            peerId: peer.id,
          }))
          return { id: parent.id, ...includeInEveryForm(rows) }
        }),
      )
      cleanupLive = () => live.cleanup()
      const project = (rows: Iterable<{ id: number; peerId: number }>) =>
        [...rows]
          .map(({ id, peerId }) => [id, peerId])
          .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!)
      const check = () => {
        for (const parent of parents.collection.toArray) {
          const expected = expectedCompoundRows(
            children,
            peers,
            parentSide,
            parent,
          )
          expectEveryForm(live.get(parent.id)!, project, project(expected))
        }
      }
      await live.preload()
      check()
      parents.write(`update`, { id: 1, group: 1, parameter: -1 })
      check()
      peers.write(`update`, { id: 20, a: 1, b: 1 })
      check()
      children.write(`update`, { id: 10, group: 1, a: 1, b: 3 })
      check()
    },
  )
}

/**
 * A parent value used only in the second join equality is still route context.
 * Parents sharing the correlation key may disagree on that equality. This
 * extends the transport grammar with direct/joined QueryRef sources and a
 * parent operand on either side. The independent model enumerates source
 * pairs and adds the parent's parameter using ordinary numeric arithmetic.
 * All three public forms are checked after preload, parent updates, and child
 * updates. This bounded matrix makes no asynchronous publication claim.
 */
describe(`compound join parent context`, () => {
  oracleProperty({
    id: `includes-context-transport.compound-join`,
    law: {
      statement: compoundJoinLaw,
      authority: `Route-context transport in packages/db/src/query/live/ARCHITECTURE.md (discovery, route identity, attachment before evaluation, and preservation across recursive and join boundaries), stated at the start of this owner.`,
      limits: `The four enumerated direct/QueryRef by main/joined parent-side cells; no asynchronous publication claim.`,
    },
    owns: [
      `src/collection/index.ts#createCollection`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
    ],
    histories: ([`direct`, `queryRef`] as const).flatMap((boundary) =>
      ([`main`, `joined`] as const).map((parentSide) => ({
        boundary,
        parentSide,
      })),
    ),
    label: ({ boundary, parentSide }) =>
      `preserves the later parent operand through ${boundary}, ${parentSide}`,
    resolve: (cell) => ({ ...cell }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(compoundJoinLaw, plan, observe, () =>
        judgeCompoundParentContext(plan.boundary, plan.parentSide),
      ),
    check: forwardAssertionJudgment,
  })
})

/**
 * A functional projection consumes inherited inline includes before returning
 * its source row. That input materialization cannot end the surrounding parent
 * route. ARCHITECTURE.md's route-context transport and nested-propagation laws
 * require the selected child and grandchildren to reach the same parent bucket.
 * Callback inputs must still contain no compiler-owned symbols.
 *
 * This finite grammar crosses FROM/JOIN QueryRef placement, expression/direct
 * functional return, and toArray/materialize input. Every case reads all three
 * outer forms. Two disjoint buckets and a shared route distinguish lost context
 * from context reused for every parent. Parent moves, child moves, grandchild
 * updates, empty values and reactivation distinguish an initial-only repair.
 * A compiled Collection-valued callback input remains outside this legal
 * grammar. The checks cover synchronous eager-source writes, not async demand,
 * callback publication counts, ordering guarantees or metadata attribution.
 */
// materializedInputGrammar, its cells, model, and check live in
// includes-context-transport-model-oracle.ts.
async function runMaterializedInputCell({
  boundary,
  selection,
  input,
}: MaterializedInputCell): Promise<void> {
  const name = `${boundary}/${selection}/${input}`
  const modelParents = [
    { id: 1, group: 1 },
    { id: 2, group: 2 },
    { id: 3, group: 1 },
  ]
  const modelChildren: Array<MaterializedInputChild> = [
    { id: 10, parentGroup: 1 },
    { id: 11, parentGroup: 1 },
    { id: 20, parentGroup: 2 },
    { id: 30, parentGroup: 3 },
  ]
  const modelGrandchildren: Array<MaterializedInputGrandchild> = [
    { id: 100, childId: 10, label: `ten` },
    { id: 110, childId: 11, label: `eleven` },
    { id: 200, childId: 20, label: `twenty` },
    { id: 300, childId: 30, label: `unrouted` },
  ]
  const states = materializedInputGrammar.checkpoints.flatMap((checkpoint) =>
    materializationForms.flatMap((form) =>
      modelParents.map(({ id }) => `${checkpoint}/${form}/parent-${id}`),
    ),
  )
  if (selection === `functional`)
    states.push(`callback-group-1`, `callback-group-2`)
  const reach = requiredIncludesObservations(
    `materialized-input/${name}`,
    states,
  )
  reach.beginHistory()
  const parents = createGrammarCollection(
    `materialized-input-${name}-parents`,
    modelParents,
  )
  const children = createGrammarCollection(
    `materialized-input-${name}-children`,
    modelChildren,
  )
  const grandchildren = createGrammarCollection(
    `materialized-input-${name}-grandchildren`,
    modelGrandchildren,
  )
  const callbackInputs: Array<unknown> = []
  const recordInput = <T extends MaterializedInputRow>(row: T): T => {
    callbackInputs.push(row)
    if (row.parentGroup === 1 || row.parentGroup === 2)
      reach.reach(`callback-group-${row.parentGroup}`)
    return row
  }
  const live = createLiveQueryCollection((q) =>
    q.from({ parent: parents.collection }).select(({ parent }) => {
      const projected = q
        .from({ child: children.collection })
        .select(({ child }) => {
          const nested = q
            .from({ grandchild: grandchildren.collection })
            .where(({ grandchild }) => eq(grandchild.childId, child.id))
            .select(({ grandchild }) => ({
              id: grandchild.id,
              label: grandchild.label,
            }))
          return {
            id: child.id,
            parentGroup: child.parentGroup,
            grandchildren:
              input === `array` ? toArray(nested) : materialize(nested),
          }
        })
      const correlated =
        boundary === `from-query-ref`
          ? q
              .from({ result: projected })
              .where(({ result }) => eq(result.parentGroup, parent.group))
          : q
              .from({ anchor: children.collection })
              .innerJoin({ result: projected }, ({ anchor, result }) =>
                eq(anchor.id, result.id),
              )
              .where(({ anchor }) => eq(anchor.parentGroup, parent.group))
      const selected =
        selection === `functional`
          ? correlated.fn.select((row) => {
              callbackInputs.push(row)
              return recordInput(row.result)
            })
          : correlated.select(({ result }) => result)
      return { id: parent.id, ...includeInEveryForm(selected) }
    }),
  )
  const failures: Array<Error> = []
  // Record every route/form checkpoint before reporting failures. A missing
  // first bucket cannot prevent the disjoint and shared routes from being read.
  const compare = (
    checkpoint: (typeof materializedInputGrammar.checkpoints)[number],
  ) => {
    for (const parent of modelParents) {
      const forms = live.get(parent.id)
      const expected = expectedMaterializedInputRows(
        parent,
        modelChildren,
        modelGrandchildren,
      )
      for (const form of materializationForms) {
        const state = `${checkpoint}/${form}/parent-${parent.id}`
        reach.reach(state)
        try {
          const actual = forms
            ? [...forms[form].values()]
                .map(({ id, parentGroup, grandchildren: nested }) => ({
                  id,
                  parentGroup,
                  grandchildren: Array.isArray(nested)
                    ? [...nested].sort((left, right) => left.id - right.id)
                    : nested,
                }))
                .sort((left, right) => left.id - right.id)
            : undefined
          checkMaterializedInputRows(actual, expected, state)
        } catch (cause) {
          failures.push(new Error(`${name}/${state}`, { cause }))
        }
      }
    }
    for (const row of callbackInputs) {
      try {
        expectNoPrivateSymbolsDeep(row, new Set())
      } catch (cause) {
        failures.push(new Error(`${name}/${checkpoint}/callback`, { cause }))
      }
    }
  }
  await runWithCleanup(live, [parents, children, grandchildren], async () => {
    await live.preload()
    compare(`initial`)
    modelParents[0] = { id: 1, group: 2 }
    parents.write(`update`, modelParents[0])
    compare(`parent-move`)
    modelChildren[0] = { id: 10, parentGroup: 2 }
    children.write(`update`, modelChildren[0])
    compare(`child-move`)
    modelGrandchildren[0] = { id: 100, childId: 10, label: `updated` }
    grandchildren.write(`update`, modelGrandchildren[0])
    compare(`grandchild-update`)
    const removed = modelGrandchildren.splice(1, 1)[0]!
    grandchildren.write(`delete`, removed)
    compare(`grandchild-empty`)
    const inserted = { id: 111, childId: 11, label: `readmitted` }
    modelGrandchildren.push(inserted)
    grandchildren.write(`insert`, inserted)
    compare(`grandchild-reactivation`)
    reach.assertReached()
    if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`)
      console.log(
        `materialized-input reach ${name}: ${JSON.stringify([...reach.counts()])}`,
      )
    if (failures.length)
      throw new AggregateError(
        failures,
        `Materialized input lost parent routes`,
      )
  })
}

describe(`parent route after inherited inline input materialization`, () => {
  oracleProperty({
    id: `includes-context-transport.materialized-input`,
    law: {
      statement: materializedInputLaw,
      authority: `Route-context transport in packages/db/src/query/live/ARCHITECTURE.md (discovery, route identity, attachment before evaluation, and preservation across recursive and join boundaries), stated at the start of this owner.`,
      limits: `The enumerated boundary, selection, and input cells over synchronous eager-source writes; no async demand, callback publication count, ordering, or metadata attribution claim.`,
    },
    owns: [
      `src/collection/index.ts#createCollection`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
    ],
    histories: materializedInputCells,
    label: ({ boundary, selection, input }) =>
      `${boundary} / ${selection} / ${input}`,
    resolve: (cell) => ({ cell }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(materializedInputLaw, plan, observe, () =>
        runMaterializedInputCell(plan.cell),
      ),
    check: forwardAssertionJudgment,
  })
})

/**
 * An unmatched RIGHT/FULL joined QueryRef must not donate its source key to
 * the whole joined result. Contribution conservation owes one public child
 * per distinct projected contribution, including multiple matches on one side. Source key domains are independent:
 * a joined key may equal the key of a different, matched main row.
 *
 * This finite grammar crosses inner/left/right/full joins with plain and QueryRef inputs.
 * Three parents supply shared and disjoint routes. Initial collision, main
 * departure/reentry, and joined departure compare every public form against a
 * flat independent join. It judges rows and stable distinct membership, without
 * prescribing generated key serialization or callback timing.
 */
// The former case body, unchanged, for one join, reference, and key cell.
async function judgeOuterJoinKeyCell({
  join,
  mainRef,
  joinedRef,
  keys,
}: (typeof outerJoinKeyGrammar)[number]): Promise<void> {
  const cuts = [`initial`, `main-departed`, `main-returned`, `child-departed`]
  const reach = requiredIncludesObservations(
    `outer join independent source keys`,
    cuts.flatMap((cut) => materializationForms.map((form) => `${cut}/${form}`)),
  )
  reach.beginHistory()
  const parents = createGrammarCollection(`outer-key-parents`, [
    { id: 1, group: 1 },
    { id: 2, group: 2 },
    { id: 3, group: 1 },
  ])
  let modelMains: Array<OuterKeyRow> = [{ id: 10, link: 10, parentGroup: 1 }]
  let modelChildren: Array<OuterKeyRow> = [
    { id: 20, link: 10, parentGroup: 1 },
    { id: 21, link: 10, parentGroup: 1 },
    { id: 10, link: 30, parentGroup: 1 },
    { id: 30, link: 50, parentGroup: 2 },
  ]
  const mains = createControlledCollection(`outer-key-mains`, modelMains, {
    autoIndex: `eager`,
    getKey: (row) => (keys === `strings` ? String(row.id) : row.id),
  })
  const children = createControlledCollection(
    `outer-key-children`,
    modelChildren,
    {
      autoIndex: `eager`,
      getKey: (row) => (keys === `numbers` ? row.id : String(row.id)),
    },
  )
  const live = createLiveQueryCollection({
    query: (q) =>
      q.from({ parent: parents.collection }).select(({ parent }) => {
        const mainQuery = q
          .from({ main: mains.collection })
          .select(({ main }) => ({
            id: main.id,
            link: main.link,
            parentGroup: main.parentGroup,
          }))
        const joinedQuery = q
          .from({ child: children.collection })
          .select(({ child }) => ({
            id: child.id,
            link: child.link,
            parentGroup: child.parentGroup,
          }))
        // Runtime source kinds vary independently. This driver uses only their
        // shared ordinary fields; the native type owner checks inference.
        const base = q.from({
          main: (mainRef
            ? mainQuery
            : mains.collection) as unknown as typeof mains.collection,
        })
        const source = {
          child: (joinedRef
            ? joinedQuery
            : children.collection) as unknown as typeof children.collection,
        }
        const joined =
          join === `inner`
            ? base.innerJoin(source, ({ main, child }) =>
                eq(main.link, child.link),
              )
            : join === `left`
              ? base.leftJoin(source, ({ main, child }) =>
                  eq(main.link, child.link),
                )
              : join === `right`
                ? base.rightJoin(source, ({ main, child }) =>
                    eq(main.link, child.link),
                  )
                : base.fullJoin(source, ({ main, child }) =>
                    eq(main.link, child.link),
                  )
        // Full-join optionality is a conservative shared carrier for the
        // runtime grammar; the model still checks actual absence and values.
        const typedJoin = joined as ReturnType<
          typeof base.fullJoin<typeof source>
        >
        const selected = typedJoin
          .where(({ child }) => eq(child.parentGroup, parent.group))
          .select(({ main, child }) => ({ id: child.id, mainId: main.id }))
        return { id: parent.id, ...includeInEveryForm(selected) }
      }),
  })
  const compare = (cut: string) => {
    for (const parent of parents.collection.toArray) {
      const expected = expectedOuterJoinKeyRows(
        modelMains,
        modelChildren,
        parent.group,
        join,
      )
      const forms = live.get(parent.id)!
      const values = readEveryForm(forms, (rows) => [...rows])
      for (const form of materializationForms) {
        checkOuterJoinKeyRows(values[form], expected)
        reach.reach(`${cut}/${form}`)
      }
    }
  }
  await runWithCleanup(live, [parents, mains, children], async () => {
    await live.preload()
    compare(`initial`)
    const original = modelMains[0]!
    modelMains = []
    mains.write(`delete`, original)
    compare(`main-departed`)
    modelMains = [original]
    mains.write(`insert`, original)
    compare(`main-returned`)
    const removed = modelChildren.find(({ id }) => id === 10)!
    modelChildren = modelChildren.filter(({ id }) => id !== 10)
    children.write(`delete`, removed)
    compare(`child-departed`)
    reach.assertReached()
    if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`)
      console.log(
        `outer-key reach ${JSON.stringify({ join, mainRef, joinedRef, keys })}`,
        Object.fromEntries(reach.counts()),
      )
  })
}

const outerJoinKeyLaw = `An unmatched RIGHT or FULL joined QueryRef does not donate its source key to the joined result: each distinct projected contribution keeps one public child across independent source keys.`

oracleProperty({
  id: `includes-context-transport.outer-join-keys`,
  law: {
    statement: outerJoinKeyLaw,
    authority: `Route-context transport in packages/db/src/query/live/ARCHITECTURE.md (discovery, route identity, attachment before evaluation, and preservation across recursive and join boundaries), stated at the start of this owner.`,
    limits: `The enumerated join, main/joined reference, and key-domain cells; rows and stable distinct membership only, without key serialization or callback timing.`,
  },
  owns: [
    `src/collection/index.ts#createCollection`,
    `src/query/live-query-collection.ts#createLiveQueryCollection`,
  ],
  histories: outerJoinKeyGrammar,
  label: (cell) =>
    `preserves outer-join child identities across independent source keys: ${JSON.stringify(cell)}`,
  resolve: (cell) => ({ ...cell }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(outerJoinKeyLaw, plan, observe, () =>
      judgeOuterJoinKeyCell(plan),
    ),
  check: forwardAssertionJudgment,
})
