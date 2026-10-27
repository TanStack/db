// The Collection-valued include driver and its Map model. The driver runs
// generated or fixed source histories through a live include query, and the
// model recomputes the parent rows that the public Collection facade must
// show. The laws and their comparisons are owned by
// includes-collection-oracle.property.test.ts, which declares the model;
// includes-collection.test.ts runs the driver for its fixed scenarios.
import {
  createLiveQueryCollection,
  eq,
  materialize,
  toArray,
} from '../../src/query/index.js'
import { declareOracle } from '../oracle-declaration.js'
import { createControlledCollection } from './includes-collection-support.js'
import type { Collection } from '../../src/collection/index.js'
import type { TraceDriver } from '../trace-runner.js'
import type { ControlledCollection } from './includes-oracle-helpers.js'
import type { ChildRow, ParentRow } from './includes-collection-support.js'

export type CollectionAction =
  | { type: `putParent`; row: ParentRow }
  | { type: `deleteParent`; id: number }
  | { type: `putChild`; row: ChildRow }
  | { type: `deleteChild`; id: number }

export type ProjectedParent = {
  id: number
  group: number
  childrenReady: boolean
  children: Array<ChildRow>
  arrayChildren: Array<ChildRow>
  materializedChildren: Array<ChildRow>
}

export type EventValue = Pick<
  ProjectedParent,
  `id` | `group` | `arrayChildren` | `materializedChildren`
>

export type ParentEvent = {
  type: `insert` | `update` | `delete`
  key: number | string
  value: EventValue
  previousValue?: EventValue
}

export function projectEventValue(row: EventValue): EventValue {
  const children = (rows: Array<ChildRow>) =>
    rows.map(({ id, parentGroup, value }) => ({ id, parentGroup, value }))
  return {
    id: row.id,
    group: row.group,
    arrayChildren: children(row.arrayChildren),
    materializedChildren: children(row.materializedChildren),
  }
}

export type CollectionContext = {
  parents: ControlledCollection<ParentRow>
  children: ControlledCollection<ChildRow>
  live: ReturnType<typeof createCollectionQuery>
  model: {
    parents: Map<number, ParentRow>
    children: Map<number, ChildRow>
  }
  publications: Array<Array<ProjectedParent>>
  events: Array<ParentEvent>
  before: Array<ProjectedParent>
  subscription?: { unsubscribe: () => void }
}

export function createCollectionQuery(
  parents: Collection<ParentRow>,
  children: Collection<ChildRow>,
  reuseChildRelation = true,
) {
  return createLiveQueryCollection((q) =>
    q
      .from({ parent: parents })
      .orderBy(({ parent }) => parent.id)
      .select(({ parent }) => {
        const createChildRows = () =>
          q
            .from({ child: children })
            .where(({ child }) => eq(child.parentGroup, parent.group))
            .orderBy(({ child }) => child.id)
            .select(({ child }) => ({
              id: child.id,
              parentGroup: child.parentGroup,
              value: child.value,
            }))
        const childRows = createChildRows()

        return {
          id: parent.id,
          group: parent.group,
          children: childRows,
          arrayChildren: toArray(
            reuseChildRelation ? childRows : createChildRows(),
          ),
          materializedChildren: materialize(
            reuseChildRelation ? childRows : createChildRows(),
          ),
        }
      }),
  )
}

export type IncludedChildCollection = ReturnType<
  typeof createCollectionQuery
>[`toArray`][number][`children`]

export function projectLive(
  live: ReturnType<typeof createCollectionQuery>,
): Array<ProjectedParent> {
  return [...live.values()].map((parent) => {
    const projectChildren = (rows: Iterable<ChildRow>) =>
      [...rows].map(({ id, parentGroup, value }) => ({
        id,
        parentGroup,
        value,
      }))

    return {
      id: parent.id,
      group: parent.group,
      childrenReady: parent.children.isReady(),
      children: projectChildren(parent.children.values()),
      arrayChildren: projectChildren(parent.arrayChildren),
      materializedChildren: projectChildren(parent.materializedChildren),
    }
  })
}

// This value model uses only current source Maps and the declared relation and
// child order. Facade identity has separate focused models below.
export function recompute(context: CollectionContext): Array<ProjectedParent> {
  return [...context.model.parents.values()]
    .sort((left, right) => left.id - right.id)
    .map((parent) => {
      const children = [...context.model.children.values()]
        .filter((child) => child.parentGroup === parent.group)
        .sort((left, right) => left.id - right.id)
        .map((child) => ({ ...child }))

      return {
        ...parent,
        childrenReady: true,
        children,
        arrayChildren: children,
        materializedChildren: children,
      }
    })
}

declareOracle({ model: [recompute] })

export function createCollectionDriver(
  initialParents: ReadonlyArray<ParentRow>,
  initialChildren: ReadonlyArray<ChildRow>,
  reuseChildRelation = true,
): TraceDriver<CollectionAction, CollectionContext> {
  return {
    setup() {
      const parents = createControlledCollection(
        `collection-oracle-parents`,
        initialParents,
      )
      const children = createControlledCollection(
        `collection-oracle-children`,
        initialChildren,
      )
      return {
        parents,
        children,
        live: createCollectionQuery(
          parents.collection,
          children.collection,
          reuseChildRelation,
        ),
        model: {
          parents: new Map(initialParents.map((row) => [row.id, { ...row }])),
          children: new Map(initialChildren.map((row) => [row.id, { ...row }])),
        },
        publications: [],
        events: [],
        before: [],
      }
    },
    async start(context) {
      await context.live.preload()
      context.before = recompute(context)
      context.subscription = context.live.subscribeChanges(
        (changes) => {
          context.publications.push(projectLive(context.live))
          context.events.push(
            ...changes.map((change) => ({
              type: change.type,
              key: change.key,
              value: projectEventValue(change.value),
              ...(change.previousValue
                ? { previousValue: projectEventValue(change.previousValue) }
                : {}),
            })),
          )
        },
        { includeInitialState: false },
      )
    },
    apply(action, context) {
      context.publications = []
      context.events = []
      context.before = recompute(context)
      switch (action.type) {
        case `putParent`: {
          const type = context.model.parents.has(action.row.id)
            ? `update`
            : `insert`
          context.model.parents.set(action.row.id, { ...action.row })
          context.parents.write(type, action.row)
          return
        }
        case `deleteParent`: {
          const previous = context.model.parents.get(action.id)
          if (!previous) return
          context.model.parents.delete(action.id)
          context.parents.write(`delete`, previous)
          return
        }
        case `putChild`: {
          const type = context.model.children.has(action.row.id)
            ? `update`
            : `insert`
          context.model.children.set(action.row.id, { ...action.row })
          context.children.write(type, action.row)
          return
        }
        case `deleteChild`: {
          const previous = context.model.children.get(action.id)
          if (!previous) return
          context.model.children.delete(action.id)
          context.children.write(`delete`, previous)
        }
      }
    },
    async cleanup(context) {
      context.subscription?.unsubscribe()
      await Promise.all([
        context.live.cleanup(),
        context.parents.collection.cleanup(),
        context.children.collection.cleanup(),
      ])
    },
  }
}
