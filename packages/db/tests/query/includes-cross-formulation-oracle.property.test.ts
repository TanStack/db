import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import {
  createLiveQueryCollection,
  eq,
  isNull,
  lt,
  not,
  queryOnce,
  toArray,
} from '../../src/query/index.js'
import { oraclePropertyOptions } from '../oracle-config.js'
import { flushPromises, mockSyncCollectionOptions } from '../utils.js'
import type { Collection } from '../../src/collection/index.js'

type ParentRow = {
  id: number
  group: number
  position: number
}

type ChildRow = {
  id: number
  parentGroup: number
  score: number | null
  position: number
}

type CrossFormulationAction =
  | { type: `putParent`; row: ParentRow }
  | { type: `deleteParent`; id: number }
  | { type: `putChild`; row: ChildRow }
  | { type: `deleteChild`; id: number }

type CrossFormulationScenario = {
  parents: Array<ParentRow>
  children: Array<ChildRow>
  pivot: number
  actions: Array<CrossFormulationAction>
}

type NormalizedParent = ParentRow & {
  children: Array<ChildRow>
}

type ControlledCollection<T extends { id: number }> = {
  collection: Collection<T>
  write: (type: `insert` | `update` | `delete`, value: T) => void
}

type FlatRow = {
  parentId: number
  parentGroup: number
  parentPosition: number
  child: ChildRow | undefined
}

let nextCrossFormulationId = 0

function createControlledCollection<T extends { id: number }>(
  name: string,
  initialData: ReadonlyArray<T>,
): ControlledCollection<T> {
  const options = mockSyncCollectionOptions<T>({
    id: `${name}-${nextCrossFormulationId++}`,
    getKey: (row) => row.id,
    initialData: initialData.map((row) => ({ ...row })),
    autoIndex: `eager`,
  })
  options.sync.rowUpdateMode = `full`
  return {
    collection: createCollection(options),
    write(type, value) {
      options.utils.begin()
      options.utils.write({ type, value: { ...value } })
      options.utils.commit()
    },
  }
}

function compareParents(left: ParentRow, right: ParentRow): number {
  return left.position - right.position || left.id - right.id
}

function compareChildren(left: ChildRow, right: ChildRow): number {
  return left.position - right.position || left.id - right.id
}

function normalizeChild(child: ChildRow): ChildRow {
  return {
    id: child.id,
    parentGroup: child.parentGroup,
    score: child.score,
    position: child.position,
  }
}

function normalizeNested(
  rows: ReadonlyArray<NormalizedParent>,
): Array<NormalizedParent> {
  return rows
    .map((parent) => ({
      id: parent.id,
      group: parent.group,
      position: parent.position,
      children: parent.children.map(normalizeChild).sort(compareChildren),
    }))
    .sort(compareParents)
}

function normalizeFlat(rows: ReadonlyArray<FlatRow>): Array<NormalizedParent> {
  const parents = new Map<number, NormalizedParent>()
  for (const row of rows) {
    const parent = parents.get(row.parentId) ?? {
      id: row.parentId,
      group: row.parentGroup,
      position: row.parentPosition,
      children: [],
    }
    if (row.child) parent.children.push(normalizeChild(row.child))
    parents.set(row.parentId, parent)
  }
  return normalizeNested([...parents.values()])
}

function recompute(
  parents: Map<number, ParentRow>,
  children: Map<number, ChildRow>,
): Array<NormalizedParent> {
  return normalizeNested(
    [...parents.values()].map((parent) => ({
      ...parent,
      children: [...children.values()].filter(
        (child) => child.parentGroup === parent.group,
      ),
    })),
  )
}

function createNestedQuery(
  parents: Collection<ParentRow>,
  children: Collection<ChildRow>,
) {
  return createLiveQueryCollection({
    getKey: (row) => row.id,
    query: (q) =>
      q
        .from({ parent: parents })
        .orderBy(({ parent }) => parent.position)
        .orderBy(({ parent }) => parent.id)
        .select(({ parent }) => ({
          id: parent.id,
          group: parent.group,
          position: parent.position,
          children: toArray(
            q
              .from({ child: children })
              .where(({ child }) => eq(child.parentGroup, parent.group))
              .orderBy(({ child }) => child.position)
              .orderBy(({ child }) => child.id)
              .select(({ child }) => ({
                id: child.id,
                parentGroup: child.parentGroup,
                score: child.score,
                position: child.position,
              })),
          ),
        })),
  })
}

function createFlatQuery(
  parents: Collection<ParentRow>,
  children: Collection<ChildRow>,
) {
  return createLiveQueryCollection({
    getKey: (row) => `${row.parentId}:${row.child?.id ?? `empty`}`,
    query: (q) =>
      q
        .from({ parent: parents })
        .leftJoin({ child: children }, ({ parent, child }) =>
          eq(parent.group, child.parentGroup),
        )
        .select(({ parent, child }) => ({
          parentId: parent.id,
          parentGroup: parent.group,
          parentPosition: parent.position,
          child,
        })),
  })
}

type ChildPartition = `all` | `predicate` | `complement` | `unknown`

async function queryChildren(
  children: Collection<ChildRow>,
  parentGroup: number,
  pivot: number,
  partition: ChildPartition,
): Promise<Array<ChildRow>> {
  return queryOnce((q) => {
    const correlated = q
      .from({ child: children })
      .where(({ child }) => eq(child.parentGroup, parentGroup))
    const partitioned = (() => {
      switch (partition) {
        case `all`:
          return correlated
        case `predicate`:
          return correlated.where(({ child }) => lt(child.score, pivot))
        case `complement`:
          return correlated.where(({ child }) => not(lt(child.score, pivot)))
        case `unknown`:
          return correlated.where(({ child }) => isNull(lt(child.score, pivot)))
      }
    })()

    return partitioned
      .orderBy(({ child }) => child.position)
      .orderBy(({ child }) => child.id)
      .select(({ child }) => ({
        id: child.id,
        parentGroup: child.parentGroup,
        score: child.score,
        position: child.position,
      }))
  })
}

async function queryPerParent(
  parents: ReadonlyArray<ParentRow>,
  children: Collection<ChildRow>,
  pivot: number,
  useTlp: boolean,
): Promise<Array<NormalizedParent>> {
  return normalizeNested(
    await Promise.all(
      parents.map(async (parent) => {
        const childRows = useTlp
          ? (
              await Promise.all(
                ([`predicate`, `complement`, `unknown`] as const).map(
                  (partition) =>
                    queryChildren(children, parent.group, pivot, partition),
                ),
              )
            ).flat()
          : await queryChildren(children, parent.group, pivot, `all`)

        return { ...parent, children: childRows }
      }),
    ),
  )
}

function applyAction(
  action: CrossFormulationAction,
  parentSource: ControlledCollection<ParentRow>,
  childSource: ControlledCollection<ChildRow>,
  parents: Map<number, ParentRow>,
  children: Map<number, ChildRow>,
): void {
  switch (action.type) {
    case `putParent`: {
      const type = parents.has(action.row.id) ? `update` : `insert`
      parents.set(action.row.id, { ...action.row })
      parentSource.write(type, action.row)
      return
    }
    case `deleteParent`: {
      const previous = parents.get(action.id)
      if (!previous) return
      parents.delete(action.id)
      parentSource.write(`delete`, previous)
      return
    }
    case `putChild`: {
      const type = children.has(action.row.id) ? `update` : `insert`
      children.set(action.row.id, { ...action.row })
      childSource.write(type, action.row)
      return
    }
    case `deleteChild`: {
      const previous = children.get(action.id)
      if (!previous) return
      children.delete(action.id)
      childSource.write(`delete`, previous)
    }
  }
}

async function expectFormulationsEquivalent(
  scenario: CrossFormulationScenario,
): Promise<void> {
  const parentSource = createControlledCollection(
    `cross-form-parents`,
    scenario.parents,
  )
  const childSource = createControlledCollection(
    `cross-form-children`,
    scenario.children,
  )
  const parents = new Map(scenario.parents.map((row) => [row.id, { ...row }]))
  const children = new Map(scenario.children.map((row) => [row.id, { ...row }]))
  const nested = createNestedQuery(
    parentSource.collection,
    childSource.collection,
  )
  const flat = createFlatQuery(parentSource.collection, childSource.collection)

  const assertEquivalent = async () => {
    const expected = recompute(parents, children)
    const nestedResult = normalizeNested(nested.toArray)
    const flatResult = normalizeFlat(flat.toArray)
    const parentRows = [...parents.values()]
    const standaloneResult = await queryPerParent(
      parentRows,
      childSource.collection,
      scenario.pivot,
      false,
    )
    const tlpResult = await queryPerParent(
      parentRows,
      childSource.collection,
      scenario.pivot,
      true,
    )

    expect({
      nested: nestedResult,
      flat: flatResult,
      standalone: standaloneResult,
      tlp: tlpResult,
    }).toEqual({
      nested: expected,
      flat: expected,
      standalone: expected,
      tlp: expected,
    })
  }

  try {
    await Promise.all([nested.preload(), flat.preload()])
    await assertEquivalent()
    for (const action of scenario.actions) {
      applyAction(action, parentSource, childSource, parents, children)
      await flushPromises()
      await assertEquivalent()
    }
  } finally {
    await Promise.allSettled([
      nested.cleanup(),
      flat.cleanup(),
      parentSource.collection.cleanup(),
      childSource.collection.cleanup(),
    ])
  }
}

const parentRowArbitrary = (id: number) =>
  fc.record({
    id: fc.constant(id),
    group: fc.integer({ min: -1, max: 1 }),
    position: fc.integer({ min: -2, max: 2 }),
  })

const childRowArbitrary = (id: number) =>
  fc.record({
    id: fc.constant(id),
    parentGroup: fc.integer({ min: -1, max: 1 }),
    score: fc.option(fc.integer({ min: -2, max: 2 }), { nil: null }),
    position: fc.integer({ min: -2, max: 2 }),
  })

const actionArbitrary: fc.Arbitrary<CrossFormulationAction> = fc.oneof(
  fc.record({
    type: fc.constant(`putParent` as const),
    row: fc.integer({ min: 0, max: 2 }).chain(parentRowArbitrary),
  }),
  fc.record({
    type: fc.constant(`deleteParent` as const),
    id: fc.integer({ min: 0, max: 2 }),
  }),
  fc.record({
    type: fc.constant(`putChild` as const),
    row: fc.integer({ min: 10, max: 14 }).chain(childRowArbitrary),
  }),
  fc.record({
    type: fc.constant(`deleteChild` as const),
    id: fc.integer({ min: 10, max: 14 }),
  }),
)

const scenarioArbitrary: fc.Arbitrary<CrossFormulationScenario> = fc.record({
  parents: fc.tuple(parentRowArbitrary(0), parentRowArbitrary(1)),
  children: fc.tuple(
    childRowArbitrary(10),
    childRowArbitrary(11),
    childRowArbitrary(12),
  ),
  pivot: fc.integer({ min: -2, max: 2 }),
  actions: fc.array(actionArbitrary, { minLength: 1, maxLength: 5 }),
})

describe(`includes cross-formulation oracle`, () => {
  fcTest(`shared-route child deletion agrees across formulations`, () =>
    expectFormulationsEquivalent({
      parents: [
        { id: 0, group: 0, position: 0 },
        { id: 1, group: 0, position: 0 },
      ],
      children: [
        { id: 10, parentGroup: 0, score: null, position: 0 },
        { id: 11, parentGroup: 0, score: null, position: 0 },
        { id: 12, parentGroup: 0, score: null, position: 0 },
      ],
      pivot: 0,
      actions: [{ type: `deleteChild`, id: 10 }],
    }),
  )

  fcTest.prop([scenarioArbitrary], oraclePropertyOptions(8))(
    `agrees across nested includes, flat joins, per-parent queries, and TLP partitions`,
    expectFormulationsEquivalent,
  )
})
