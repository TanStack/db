// Fixed-scenario Collection-valued include tests: each runs one hand-written
// history, or a fixed structural observation, and checks literal facade rows,
// events, and states. These are unit tests. The generated facade laws, the
// Map model, and the exhaustive relationship lane are owned by
// includes-collection-oracle.property.test.ts.
import { test as fcTest } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import {
  add,
  caseWhen,
  count,
  createLiveQueryCollection,
  eq,
  gt,
  include,
  lt,
  materialize,
  multiply,
  sum,
  toArray,
} from '../../src/query/index.js'
import { runTrace } from '../trace-runner.js'
import { withHistoryCleanup } from '../optimistic-history-oracle.js'
import {
  assertDeleteIdentityEvents,
  assertFacadeRootSnapshots,
  assertRetiredFacade,
  createControlledCollection,
  expectedMaterializations,
} from './includes-collection-support.js'
import { createCollectionDriver } from './includes-collection-driver-oracle.js'
import type { TraceProjection } from '../trace-runner.js'
import type { CollectionContext } from './includes-collection-driver-oracle.js'
import type {
  ChildRow,
  DeleteIdentityObservation,
  ParentRow,
} from './includes-collection-support.js'

describe(`Collection-valued includes oracle`, () => {
  fcTest(
    `delete identity observations reject missing and overwritten failures`,
    () => {
      const valid: DeleteIdentityObservation = {
        type: `delete`,
        key: 1,
        id: 1,
        matchesPublishedFacade: true,
      }
      assertDeleteIdentityEvents([], false)
      assertDeleteIdentityEvents([valid], true)
      for (const invalid of [
        [],
        [valid, valid],
        [{ ...valid, matchesPublishedFacade: false }, valid],
        [{ ...valid, type: `update` }],
        [{ ...valid, key: `1` }],
      ])
        expect(() => assertDeleteIdentityEvents(invalid, true)).toThrow()
    },
  )

  fcTest(`retirement observations reject rows retained until cleanup`, () => {
    assertRetiredFacade({ status: `ready`, rows: [] })
    expect(() =>
      assertRetiredFacade({
        status: `ready`,
        rows: [{ id: 10, parentGroup: 1, value: 1 }],
      }),
    ).toThrow()
    expect(() =>
      assertRetiredFacade({ status: `cleaned-up`, rows: [] }),
    ).toThrow()
  })

  fcTest(
    `facade callback observations reject unexpected raw public keys`,
    () => {
      assertFacadeRootSnapshots([
        { group: 2, usesOldFacade: false, rows: [20] },
      ])
      expect(() =>
        assertFacadeRootSnapshots([
          { group: 2, usesOldFacade: false, rows: [20, `unexpected`] },
        ]),
      ).toThrow()
    },
  )

  fcTest(
    `root application failure rolls back a prepared facade publication`,
    async () => {
      type NodeRow = {
        id: number
        kind: `parent` | `child`
        group: number
        value: number
      }
      const initialParent: NodeRow = {
        id: 1,
        kind: `parent`,
        group: 1,
        value: 1,
      }
      const initialChild: NodeRow = {
        id: 10,
        kind: `child`,
        group: 1,
        value: 1,
      }
      const nodes = createControlledCollection<NodeRow>(`rollback-nodes`, [
        initialParent,
        initialChild,
      ])
      const live = createLiveQueryCollection((q) =>
        q
          .from({ parent: nodes.collection })
          .where(({ parent }) => eq(parent.kind, `parent`))
          .select(({ parent }) => ({
            id: parent.id,
            value: parent.value,
            children: include(
              q
                .from({ child: nodes.collection })
                .where(({ child }) => eq(child.kind, `child`))
                .where(({ child }) => eq(child.group, parent.group)),
            ),
          })),
      )

      await live.preload()
      const facade = live.get(1)!.children
      const rootPublications: Array<unknown> = []
      const childPublications: Array<unknown> = []
      const rootSubscription = live.subscribeChanges(
        (batch) => rootPublications.push(...batch),
        { includeInitialState: false },
      )
      const childSubscription = facade.subscribeChanges(
        (batch) => childPublications.push(...batch),
        { includeInitialState: false },
      )
      const originalGetKey = live.config.getKey
      live.config.getKey = (row) => {
        if (row.value === 2) throw new Error(`root key failed`)
        return originalGetKey(row)
      }

      try {
        expect(() =>
          nodes.writeBatch([
            {
              type: `update`,
              value: { ...initialParent, value: 2 },
            },
            {
              type: `update`,
              value: { ...initialChild, value: 2 },
            },
          ]),
        ).toThrow(`root key failed`)
        expect(live.get(1)!.value).toBe(1)
        expect(facade.get(10)!.value).toBe(1)
        expect(rootPublications).toEqual([])
        expect(childPublications).toEqual([])

        live.config.getKey = originalGetKey
        nodes.writeBatch([
          {
            type: `update`,
            value: { ...initialParent, value: 3 },
          },
          {
            type: `update`,
            value: { ...initialChild, value: 3 },
          },
        ])
        expect(live.get(1)!.value).toBe(3)
        expect(facade.get(10)!.value).toBe(3)
        expect(rootPublications).toHaveLength(1)
        expect(childPublications).toHaveLength(1)
      } finally {
        live.config.getKey = originalGetKey
        rootSubscription.unsubscribe()
        childSubscription.unsubscribe()
        await Promise.all([live.cleanup(), nodes.collection.cleanup()])
      }
    },
  )

  fcTest(
    `a retry after a failed root commit publishes the pending child change`,
    async () => {
      // The failed root commit keeps the parent and child changes pending.
      // The retry carries only a further parent change, and must still
      // publish the child change once.
      type NodeRow = {
        id: number
        kind: `parent` | `child`
        group: number
        value: number
      }
      const parent: NodeRow = { id: 1, kind: `parent`, group: 1, value: 1 }
      const child: NodeRow = { id: 10, kind: `child`, group: 1, value: 1 }
      const nodes = createControlledCollection<NodeRow>(`retry-nodes`, [
        parent,
        child,
      ])
      const live = createLiveQueryCollection((q) =>
        q
          .from({ parent: nodes.collection })
          .where(({ parent }) => eq(parent.kind, `parent`))
          .select(({ parent }) => ({
            id: parent.id,
            value: parent.value,
            children: include(
              q
                .from({ child: nodes.collection })
                .where(({ child }) => eq(child.kind, `child`))
                .where(({ child }) => eq(child.group, parent.group)),
            ),
          })),
      )

      await live.preload()
      const facade = live.get(1)!.children
      const childPublications: Array<unknown> = []
      const childSubscription = facade.subscribeChanges(
        (batch) => childPublications.push(...batch),
        { includeInitialState: false },
      )
      const originalGetKey = live.config.getKey
      live.config.getKey = (row) => {
        if (row.value === 2) throw new Error(`root key failed`)
        return originalGetKey(row)
      }

      try {
        expect(() =>
          nodes.writeBatch([
            { type: `update`, value: { ...parent, value: 2 } },
            { type: `update`, value: { ...child, value: 2 } },
          ]),
        ).toThrow(`root key failed`)
        expect(facade.get(10)!.value).toBe(1)

        live.config.getKey = originalGetKey
        nodes.writeBatch([{ type: `update`, value: { ...parent, value: 3 } }])
        expect(live.get(1)!.value).toBe(3)
        expect(facade.get(10)!.value).toBe(2)
        expect(childPublications).toHaveLength(1)
      } finally {
        live.config.getKey = originalGetKey
        childSubscription.unsubscribe()
        await Promise.all([live.cleanup(), nodes.collection.cleanup()])
      }
    },
  )

  fcTest(
    `child-only changes flush the facade without republishing the parent`,
    async () => {
      const parents = createControlledCollection(`facade-only-parents`, [
        { id: 1, group: 1 },
      ])
      const children = createControlledCollection(`facade-only-children`, [
        { id: 10, parentGroup: 1, value: 1 },
      ])
      const live = createLiveQueryCollection((q) =>
        q.from({ parent: parents.collection }).select(({ parent }) => ({
          id: parent.id,
          children: include(
            q
              .from({ child: children.collection })
              .where(({ child }) => eq(child.parentGroup, parent.group)),
          ),
        })),
      )

      await live.preload()
      const facade = live.get(1)!.children
      const rootPublications: Array<unknown> = []
      const childPublications: Array<unknown> = []
      const rootSubscription = live.subscribeChanges(
        (batch) => rootPublications.push(...batch),
        { includeInitialState: false },
      )
      const childSubscription = facade.subscribeChanges(
        (batch) => childPublications.push(...batch),
        { includeInitialState: false },
      )

      try {
        children.write(`update`, {
          id: 10,
          parentGroup: 1,
          value: 2,
        })

        expect(rootPublications).toEqual([])
        expect(childPublications).toHaveLength(1)
        expect(live.get(1)!.children).toBe(facade)
        expect(
          [...facade.values()].map(({ id, parentGroup, value }) => ({
            id,
            parentGroup,
            value,
          })),
        ).toEqual([{ id: 10, parentGroup: 1, value: 2 }])
      } finally {
        rootSubscription.unsubscribe()
        childSubscription.unsubscribe()
        await Promise.all([
          live.cleanup(),
          parents.collection.cleanup(),
          children.collection.cleanup(),
        ])
      }
    },
  )

  fcTest(
    `outer fn.select recomputes nested values after a union branch include changes`,
    async () => {
      const callbackRows: Array<Record<PropertyKey, unknown>> = []
      const messages = createControlledCollection(`fn-select-messages`, [
        { id: 1, group: 1 },
      ])
      const tools = createControlledCollection(`fn-select-tools`, [
        { id: 2, group: 2 },
      ])
      const children = createControlledCollection(`fn-select-children`, [
        { id: 10, parentGroup: 1, value: 1 },
      ])
      const live = createLiveQueryCollection((q) => {
        const messageRows = q
          .from({ message: messages.collection })
          .select(({ message }) => ({
            kind: `message` as const,
            id: message.id,
            children: toArray(
              q
                .from({ messageChild: children.collection })
                .where(({ messageChild }) =>
                  eq(messageChild.parentGroup, message.group),
                )
                .select(({ messageChild }) => ({
                  id: messageChild.id,
                  value: messageChild.value,
                })),
            ),
          }))
        const toolRows = q
          .from({ tool: tools.collection })
          .select(({ tool }) => ({
            kind: `tool` as const,
            id: tool.id,
          }))

        return q.unionAll(messageRows, toolRows).fn.select((row) => {
          callbackRows.push(row)
          return {
            kind: row.kind,
            id: row.id,
            payload: { children: row.children },
          }
        })
      })

      try {
        await live.preload()
        const message = live.toArray.find((row) => row.kind === `message`)!
        expect(message.payload.children).toEqual([{ id: 10, value: 1 }])

        children.write(`update`, {
          id: 10,
          parentGroup: 1,
          value: 2,
        })
        expect(
          live.toArray.find((row) => row.kind === `message`)!.payload.children,
        ).toEqual([{ id: 10, value: 2 }])
        expect(
          callbackRows.flatMap((row) => Object.getOwnPropertySymbols(row)),
        ).toEqual([])
      } finally {
        await Promise.all([
          live.cleanup(),
          messages.collection.cleanup(),
          tools.collection.cleanup(),
          children.collection.cleanup(),
        ])
      }
    },
  )

  fcTest(
    `outer fn.select rejects a bare union include before invoking the callback`,
    async () => {
      class Box {
        constructor(readonly child: unknown) {}
      }

      const callbackChildren: Array<unknown> = []
      const messages = createControlledCollection(`fn-select-bare-messages`, [
        { id: 1, group: 1 },
      ])
      const tools = createControlledCollection(`fn-select-bare-tools`, [
        { id: 2, group: 2 },
      ])
      const children = createControlledCollection(`fn-select-bare-children`, [
        { id: 10, parentGroup: 1, value: 1 },
        { id: 20, parentGroup: 2, value: 2 },
      ])
      const buildQuery = () =>
        createLiveQueryCollection((q) => {
          const messageRows = q
            .from({ message: messages.collection })
            .select(({ message }) => ({
              kind: `message` as const,
              id: message.id,
              children: include(
                q
                  .from({ messageChild: children.collection })
                  .where(({ messageChild }) =>
                    eq(messageChild.parentGroup, message.group),
                  ),
              ),
            }))
          const toolRows = q
            .from({ tool: tools.collection })
            .select(({ tool }) => ({
              kind: `tool` as const,
              id: tool.id,
            }))

          return q.unionAll(messageRows, toolRows).fn.select((row) => {
            const child = `children` in row ? row.children : undefined
            callbackChildren.push(child)
            return { kind: row.kind, id: row.id, box: new Box(child) }
          })
        })

      try {
        expect(buildQuery).toThrow(
          `fn.select() cannot consume Collection-valued includes`,
        )
        expect(callbackChildren).toEqual([])
      } finally {
        await Promise.all([
          messages.collection.cleanup(),
          tools.collection.cleanup(),
          children.collection.cleanup(),
        ])
      }
    },
  )

  fcTest(
    `fn.select rejects query values returned during include rematerialization`,
    async () => {
      const messages = createControlledCollection(`fn-select-reject-messages`, [
        { id: 1, group: 1 },
      ])
      const tools = createControlledCollection(`fn-select-reject-tools`, [
        { id: 2, group: 2 },
      ])
      const children = createControlledCollection(`fn-select-reject-children`, [
        { id: 10, parentGroup: 1, value: 1 },
      ])
      const live = createLiveQueryCollection((q) => {
        const messageRows = q
          .from({ message: messages.collection })
          .select(({ message }) => ({
            kind: `message` as const,
            id: message.id,
            children: toArray(
              q
                .from({ messageChild: children.collection })
                .where(({ messageChild }) =>
                  eq(messageChild.parentGroup, message.group),
                ),
            ),
          }))
        const toolRows = q
          .from({ tool: tools.collection })
          .select(({ tool }) => ({
            kind: `tool` as const,
            id: tool.id,
          }))

        return q.unionAll(messageRows, toolRows).fn.select((row) => {
          const includedChildren =
            row.kind === `message`
              ? (row.children as typeof row.children | null)
              : null

          return {
            kind: row.kind,
            id: row.id,
            leakedQuery:
              includedChildren?.[0]?.value === 2
                ? q.from({ child: children.collection })
                : null,
          } as any
        })
      })

      try {
        await live.preload()

        expect(() =>
          children.write(`update`, {
            id: 10,
            parentGroup: 1,
            value: 2,
          }),
        ).toThrow(`fn.select() cannot return a child query builder`)
      } finally {
        await Promise.all([
          live.cleanup(),
          messages.collection.cleanup(),
          tools.collection.cleanup(),
          children.collection.cleanup(),
        ])
      }
    },
  )

  fcTest(
    `rejects collapsed contributors that disagree by value, order, or outgoing route`,
    async () => {
      type CommentRow = {
        id: number
        userId: number
        text: string
      }
      const users = createControlledCollection(`congruence-users`, [
        { id: 1, group: 1 },
      ])

      const expectIncrementalRejection = async (
        mode: `value` | `order`,
      ): Promise<void> => {
        const comments = createControlledCollection<CommentRow>(
          `congruence-${mode}-comments`,
          [{ id: 1, userId: 1, text: `first` }],
        )
        const live = createLiveQueryCollection({
          query: (q) => {
            const joined = q
              .from({ comment: comments.collection })
              .join({ user: users.collection }, ({ comment, user }) =>
                eq(comment.userId, user.id),
              )
            return mode === `value`
              ? joined.select(({ comment }) => ({
                  publicId: comment.userId,
                  visible: comment.text,
                }))
              : joined
                  .orderBy(({ comment }) => comment.id)
                  .select(({ comment }) => ({
                    publicId: comment.userId,
                    visible: `same`,
                  }))
          },
          getKey: (row) => row.publicId,
        })

        try {
          await live.preload()
          expect(() =>
            comments.write(`insert`, {
              id: 2,
              userId: 1,
              text: mode === `value` ? `second` : `ignored`,
            }),
          ).toThrow(`not congruent`)
        } finally {
          await live.cleanup()
          await comments.collection.cleanup()
        }
      }

      await expectIncrementalRejection(`value`)
      await expectIncrementalRejection(`order`)

      const parents = createControlledCollection(`congruence-parents`, [
        { id: 1, group: 1 },
      ])
      const children = createControlledCollection<ChildRow>(
        `congruence-children`,
        [],
      )
      const routed = createLiveQueryCollection({
        query: (q) =>
          q.from({ parent: parents.collection }).select(({ parent }) => ({
            publicId: 1,
            visible: `same`,
            children: toArray(
              q
                .from({ child: children.collection })
                .where(({ child }) => eq(child.parentGroup, parent.group)),
            ),
          })),
        getKey: (row) => row.publicId,
      })

      try {
        await routed.preload()
        expect(() => parents.write(`insert`, { id: 2, group: 2 })).toThrow(
          `not congruent`,
        )
      } finally {
        await routed.cleanup()
        await Promise.all([
          parents.collection.cleanup(),
          children.collection.cleanup(),
          users.collection.cleanup(),
        ])
      }
    },
  )

  fcTest(
    `a holder's cleanup during root publication throws and keeps the facade`,
    async () => {
      type NodeRow = {
        id: number
        kind: `parent` | `child`
        group: number
        value: number
      }
      const nodes = createControlledCollection<NodeRow>(`publication-cleanup`, [
        { id: 1, kind: `parent`, group: 1, value: 1 },
        { id: 10, kind: `child`, group: 1, value: 1 },
      ])
      const live = createLiveQueryCollection((q) =>
        q
          .from({ parent: nodes.collection })
          .where(({ parent }) => eq(parent.kind, `parent`))
          .select(({ parent }) => ({
            id: parent.id,
            value: parent.value,
            children: include(
              q
                .from({ child: nodes.collection })
                .where(({ child }) => eq(child.kind, `child`))
                .where(({ child }) => eq(child.group, parent.group)),
            ),
          })),
      )

      await live.preload()
      const facade = live.get(1)!.children
      const rootSnapshots: Array<Array<number>> = []
      const facadeSnapshots: Array<Array<number>> = []
      // The live query owns its child collections, so a holder's cleanup
      // throws, even inside the root's publication.
      const cleanupErrors: Array<unknown> = []
      const rootSubscription = live.subscribeChanges(
        () => {
          rootSnapshots.push(facade.toArray.map(({ value }) => value))
          facade.cleanup().catch((error: unknown) => cleanupErrors.push(error))
        },
        { includeInitialState: false },
      )
      const facadeSubscription = facade.subscribeChanges(
        () => facadeSnapshots.push(facade.toArray.map(({ value }) => value)),
        { includeInitialState: false },
      )

      try {
        nodes.writeBatch([
          {
            type: `update`,
            value: { id: 1, kind: `parent`, group: 1, value: 2 },
          },
          {
            type: `update`,
            value: { id: 10, kind: `child`, group: 1, value: 2 },
          },
        ])
        await Promise.resolve()
        expect(rootSnapshots).toEqual([[2]])
        expect(cleanupErrors).toHaveLength(1)
        expect(String(cleanupErrors[0])).toMatch(
          /cannot be cleaned up directly/,
        )
        expect(facadeSnapshots).toEqual([[2]])
        expect(facade.status).toBe(`ready`)
        expect(facade.toArray.map(({ value }) => value)).toEqual([2])
      } finally {
        rootSubscription.unsubscribe()
        facadeSubscription.unsubscribe()
        await Promise.all([live.cleanup(), nodes.collection.cleanup()])
      }
    },
  )

  fcTest(
    `live query cleanup during root publication suppresses the prepared facade callback`,
    async () => {
      type NodeRow = {
        id: number
        kind: `parent` | `child`
        group: number
        value: number
      }
      const nodes = createControlledCollection<NodeRow>(
        `publication-live-cleanup`,
        [
          { id: 1, kind: `parent`, group: 1, value: 1 },
          { id: 10, kind: `child`, group: 1, value: 1 },
        ],
      )
      const live = createLiveQueryCollection((q) =>
        q
          .from({ parent: nodes.collection })
          .where(({ parent }) => eq(parent.kind, `parent`))
          .select(({ parent }) => ({
            id: parent.id,
            value: parent.value,
            children: include(
              q
                .from({ child: nodes.collection })
                .where(({ child }) => eq(child.kind, `child`))
                .where(({ child }) => eq(child.group, parent.group)),
            ),
          })),
      )

      await live.preload()
      const facade = live.get(1)!.children
      const rootSnapshots: Array<Array<number>> = []
      const facadeSnapshots: Array<Array<number>> = []
      // The owner ends its child collections while the root publishes. The
      // facade's prepared publication must not reach its subscribers after
      // that.
      let cleanup: Promise<void> | undefined
      const rootSubscription = live.subscribeChanges(
        () => {
          rootSnapshots.push(facade.toArray.map(({ value }) => value))
          cleanup = live.cleanup()
        },
        { includeInitialState: false },
      )
      const facadeSubscription = facade.subscribeChanges(
        () => facadeSnapshots.push(facade.toArray.map(({ value }) => value)),
        { includeInitialState: false },
      )

      try {
        nodes.writeBatch([
          {
            type: `update`,
            value: { id: 1, kind: `parent`, group: 1, value: 2 },
          },
          {
            type: `update`,
            value: { id: 10, kind: `child`, group: 1, value: 2 },
          },
        ])
        await cleanup

        expect(rootSnapshots).toEqual([[2]])
        expect(facadeSnapshots).toEqual([])
        expect(facade.status).toBe(`cleaned-up`)
        expect(facade.toArray).toEqual([])
      } finally {
        rootSubscription.unsubscribe()
        facadeSubscription.unsubscribe()
        await nodes.collection.cleanup()
      }
    },
  )

  fcTest(`a matched null singleton remains null`, async () => {
    type NullableChild = { id: number; parentGroup: number; value: null }
    const parents = createControlledCollection(`nullable-oracle-parents`, [
      { id: 1, group: 1 },
    ])
    const children = createControlledCollection<NullableChild>(
      `nullable-oracle-children`,
      [{ id: 10, parentGroup: 1, value: null }],
    )
    const live = createLiveQueryCollection((q) =>
      q.from({ parent: parents.collection }).select(({ parent }) => ({
        id: parent.id,
        value: materialize(
          q
            .from({ child: children.collection })
            .where(({ child }) => eq(child.parentGroup, parent.group))
            .select(({ child }) => child.value)
            .findOne(),
        ),
      })),
    )

    try {
      await live.preload()
      expect(live.get(1)!.value).toBeNull()
    } finally {
      await Promise.all([
        live.cleanup(),
        parents.collection.cleanup(),
        children.collection.cleanup(),
      ])
    }
  })

  fcTest(
    `held-facade cleanup retains the primary and both cleanup failures`,
    async () => {
      const primary = new Error(`facade publication mismatch`)
      const firstCleanup = new Error(`facade unsubscribe failed`)
      const secondCleanup = new Error(`source cleanup failed`)
      const released: Array<string> = []
      let failure: unknown
      try {
        await withHistoryCleanup(
          async () => {
            throw primary
          },
          () => [
            () => {
              released.push(`facade`)
              throw firstCleanup
            },
            () => {
              released.push(`source`)
              throw secondCleanup
            },
            () => {
              released.push(`parent`)
            },
          ],
        )
      } catch (error) {
        failure = error
      }
      expect(released).toEqual([`facade`, `source`, `parent`])
      expect(failure).toBeInstanceOf(AggregateError)
      expect((failure as AggregateError).cause).toBe(primary)
      expect((failure as AggregateError).errors).toEqual([
        primary,
        firstCleanup,
        secondCleanup,
      ])
    },
  )

  fcTest(
    `reconstructs nested conditional includes through guard transitions`,
    async () => {
      type GuardedParent = ParentRow & { active: boolean }
      const parents = createControlledCollection<GuardedParent>(
        `guarded-parents`,
        [{ id: 1, group: 1, active: true }],
      )
      const children = createControlledCollection(`guarded-children`, [
        { id: 10, parentGroup: 1, value: 1 },
      ])
      const live = createLiveQueryCollection((q) =>
        q.from({ parent: parents.collection }).select(({ parent }) => {
          const childRows = () =>
            q
              .from({ child: children.collection })
              .where(({ child }) => eq(child.parentGroup, parent.group))
              .orderBy(({ child }) => child.id)
              .select(({ child }) => ({
                id: child.id,
                parentGroup: child.parentGroup,
                value: child.value,
              }))

          return {
            id: parent.id,
            profile: caseWhen(
              eq(parent.active, true),
              {
                kind: `active` as const,
                facade: include(childRows()),
                array: toArray(childRows()),
                materialized: materialize(childRows()),
              },
              { kind: `inactive` as const },
            ),
          }
        }),
      )

      const project = () => {
        const profile = live.get(1)!.profile
        if (profile.kind === `inactive`) return profile
        const rows = (values: Iterable<ChildRow>) =>
          [...values].map(({ id, value }) => ({ id, value }))
        return {
          kind: profile.kind,
          facade: rows(profile.facade.values()),
          array: rows(profile.array),
          materialized: rows(profile.materialized),
        }
      }

      try {
        await live.preload()
        const initialProfile = live.get(1)!.profile
        if (initialProfile.kind === `inactive`) {
          throw new Error(
            `Expected the initial conditional branch to be active`,
          )
        }
        const initialFacade = initialProfile.facade
        expect(project()).toEqual({
          kind: `active`,
          ...expectedMaterializations([{ id: 10, value: 1 }]),
        })

        parents.write(`update`, { id: 1, group: 1, active: false })
        expect(project()).toEqual({ kind: `inactive` })
        expect(initialFacade.toArray).toEqual([])
        expect(initialFacade.status).toBe(`ready`)
        children.write(`insert`, { id: 20, parentGroup: 1, value: 2 })
        expect(project()).toEqual({ kind: `inactive` })

        parents.write(`update`, { id: 1, group: 1, active: true })
        const reactivatedProfile = live.get(1)!.profile
        if (reactivatedProfile.kind === `inactive`) {
          throw new Error(`Expected the conditional branch to reactivate`)
        }
        expect(reactivatedProfile.facade).not.toBe(initialFacade)
        expect(project()).toEqual({
          kind: `active`,
          ...expectedMaterializations([
            { id: 10, value: 1 },
            { id: 20, value: 2 },
          ]),
        })
      } finally {
        await Promise.all([
          live.cleanup(),
          parents.collection.cleanup(),
          children.collection.cleanup(),
        ])
      }
    },
  )

  fcTest(
    `matches recomputation for correlated aggregate child relations`,
    async () => {
      const parents = createControlledCollection(`aggregate-parents`, [
        { id: 1, group: 1, factor: 1 },
        { id: 2, group: 1, factor: -1 },
        { id: 3, group: 2, factor: 2 },
      ])
      const children = createControlledCollection(`aggregate-children`, [
        { id: 10, parentGroup: 1, value: 1 },
        { id: 20, parentGroup: 1, value: 2 },
        { id: 30, parentGroup: 2, value: 5 },
      ])
      const live = createLiveQueryCollection((q) =>
        q
          .from({ parent: parents.collection })
          .orderBy(({ parent }) => parent.id)
          .select(({ parent }) => {
            const summaries = () =>
              q
                .from({ child: children.collection })
                .where(({ child }) => eq(child.parentGroup, parent.group))
                .groupBy(({ child }) => child.parentGroup)
                .select(({ child }) => ({
                  parentGroup: child.parentGroup,
                  count: count(child.id),
                  total: sum(multiply(child.value, parent.factor)),
                }))
            const total = () =>
              q
                .from({ child: children.collection })
                .where(({ child }) => eq(child.parentGroup, parent.group))
                .select(({ child }) => ({
                  count: count(child.id),
                  total: sum(multiply(child.value, parent.factor)),
                }))

            return {
              id: parent.id,
              facade: include(summaries()),
              array: toArray(summaries()),
              materialized: materialize(summaries()),
              implicit: materialize(total()),
            }
          }),
      )

      type Summary = { parentGroup: number; count: number; total: number }
      const project = () =>
        live.toArray.map((row) => {
          const clean = (values: Iterable<Summary>) =>
            [...values].map(({ parentGroup, count: size, total }) => ({
              parentGroup,
              count: size,
              total,
            }))
          return {
            id: row.id,
            facade: clean(row.facade.values()),
            array: clean(row.array),
            materialized: clean(row.materialized),
            implicit: row.implicit.map(({ count: size, total }) => ({
              count: size,
              total,
            })),
          }
        })

      const expected = (groupOneTotal: number, groupOneCount: number) => [
        {
          id: 1,
          ...expectedMaterializations([
            { parentGroup: 1, count: groupOneCount, total: groupOneTotal },
          ]),
          implicit: [{ count: groupOneCount, total: groupOneTotal }],
        },
        {
          id: 2,
          ...expectedMaterializations([
            {
              parentGroup: 1,
              count: groupOneCount,
              total: -groupOneTotal,
            },
          ]),
          implicit: [{ count: groupOneCount, total: -groupOneTotal }],
        },
        {
          id: 3,
          ...expectedMaterializations([
            { parentGroup: 2, count: 1, total: 10 },
          ]),
          implicit: [{ count: 1, total: 10 }],
        },
      ]

      try {
        await live.preload()
        expect(project()).toEqual(expected(3, 2))

        children.write(`update`, { id: 20, parentGroup: 1, value: 7 })
        expect(project()).toEqual(expected(8, 2))

        children.write(`delete`, { id: 10, parentGroup: 1, value: 1 })
        expect(project()).toEqual(expected(7, 1))
      } finally {
        await Promise.all([
          live.cleanup(),
          parents.collection.cleanup(),
          children.collection.cleanup(),
        ])
      }
    },
  )

  fcTest(
    `evaluates correlated having clauses with parent context`,
    async () => {
      type HavingParent = ParentRow & { threshold: number }
      const parents = createControlledCollection<HavingParent>(
        `having-parents`,
        [
          { id: 1, group: 1, threshold: 1 },
          { id: 2, group: 1, threshold: 3 },
        ],
      )
      const children = createControlledCollection(`having-children`, [
        { id: 10, parentGroup: 1, value: 1 },
        { id: 20, parentGroup: 1, value: 2 },
      ])
      const live = createLiveQueryCollection((q) =>
        q
          .from({ parent: parents.collection })
          .orderBy(({ parent }) => parent.id)
          .select(({ parent }) => {
            const summaries = () =>
              q
                .from({ child: children.collection })
                .where(({ child }) => eq(child.parentGroup, parent.group))
                .groupBy(({ child }) => child.parentGroup)
                .having(({ child }) => gt(count(child.id), parent.threshold))
                .select(({ child }) => ({ count: count(child.id) }))

            return {
              id: parent.id,
              facade: include(summaries()),
              array: toArray(summaries()),
              materialized: materialize(summaries()),
            }
          }),
      )

      const project = () =>
        live.toArray.map((row) => {
          const counts = (values: Iterable<{ count: number }>) =>
            [...values].map(({ count: size }) => size)
          return {
            id: row.id,
            facade: counts(row.facade.values()),
            array: counts(row.array),
            materialized: counts(row.materialized),
          }
        })

      try {
        await live.preload()
        expect(project()).toEqual([
          { id: 1, ...expectedMaterializations([2]) },
          { id: 2, ...expectedMaterializations([]) },
        ])

        // The count equals this threshold, so `gt` must still exclude it.
        parents.write(`update`, { id: 2, group: 1, threshold: 2 })
        expect(project()).toEqual([
          { id: 1, ...expectedMaterializations([2]) },
          { id: 2, ...expectedMaterializations([]) },
        ])

        parents.write(`update`, { id: 2, group: 1, threshold: 1 })
        expect(project()).toEqual([
          { id: 1, ...expectedMaterializations([2]) },
          { id: 2, ...expectedMaterializations([2]) },
        ])
      } finally {
        await Promise.all([
          live.cleanup(),
          parents.collection.cleanup(),
          children.collection.cleanup(),
        ])
      }
    },
  )

  fcTest(`routes changes to non-key parent filter inputs`, async () => {
    type FilterParent = ParentRow & { threshold: number }
    const parents = createControlledCollection<FilterParent>(
      `parent-filter-input-parents`,
      [{ id: 1, group: 1, threshold: 2 }],
    )
    const children = createControlledCollection(
      `parent-filter-input-children`,
      [
        { id: 10, parentGroup: 1, value: 1 },
        { id: 20, parentGroup: 1, value: 3 },
      ],
    )
    const live = createLiveQueryCollection((q) =>
      q.from({ parent: parents.collection }).select(({ parent }) => {
        const childRows = () =>
          q
            .from({ child: children.collection })
            .where(({ child }) => eq(child.parentGroup, parent.group))
            .where(({ child }) => lt(child.value, parent.threshold))
            .orderBy(({ child }) => child.id)
            .select(({ child }) => ({ id: child.id, value: child.value }))

        return {
          id: parent.id,
          facade: include(childRows()),
          array: toArray(childRows()),
          materialized: materialize(childRows()),
        }
      }),
    )

    const project = () => {
      const row = live.get(1)!
      const ids = (values: Iterable<{ id: number }>) =>
        [...values].map(({ id }) => id)
      return {
        facade: ids(row.facade.values()),
        array: ids(row.array),
        materialized: ids(row.materialized),
      }
    }

    try {
      await live.preload()
      expect(project()).toEqual(expectedMaterializations([10]))

      // Both equality boundaries distinguish `<` from an inclusive filter.
      parents.write(`update`, { id: 1, group: 1, threshold: 1 })
      expect(project()).toEqual(expectedMaterializations([]))

      parents.write(`update`, { id: 1, group: 1, threshold: 3 })
      expect(project()).toEqual(expectedMaterializations([10]))

      parents.write(`update`, { id: 1, group: 1, threshold: 4 })
      expect(project()).toEqual(expectedMaterializations([10, 20]))

      parents.write(`update`, { id: 1, group: 1, threshold: 0 })
      expect(project()).toEqual(expectedMaterializations([]))
    } finally {
      await Promise.all([
        live.cleanup(),
        parents.collection.cleanup(),
        children.collection.cleanup(),
      ])
    }
  })

  fcTest(`routes changes to parent-dependent child ordering`, async () => {
    type OrderingParent = ParentRow & { direction: number }
    const parents = createControlledCollection<OrderingParent>(
      `parent-order-input-parents`,
      [
        { id: 1, group: 1, direction: 1 },
        { id: 2, group: 1, direction: -1 },
      ],
    )
    const children = createControlledCollection(`parent-order-input-children`, [
      { id: 10, parentGroup: 1, value: 1 },
      { id: 20, parentGroup: 1, value: 2 },
    ])
    const live = createLiveQueryCollection((q) =>
      q.from({ parent: parents.collection }).select(({ parent }) => {
        const childRows = () =>
          q
            .from({ child: children.collection })
            .where(({ child }) => eq(child.parentGroup, parent.group))
            .orderBy(({ child }) => multiply(child.value, parent.direction))
            .select(({ child }) => ({ id: child.id, value: child.value }))

        return {
          id: parent.id,
          facade: include(childRows()),
          array: toArray(childRows()),
          materialized: materialize(childRows()),
        }
      }),
    )

    const project = (id: number) => {
      const row = live.get(id)!
      const rows = (values: Iterable<{ id: number; value: number }>) =>
        [...values].map(({ id: childId, value }) => ({ id: childId, value }))
      return {
        facade: rows(row.facade.values()),
        array: rows(row.array),
        materialized: rows(row.materialized),
      }
    }

    try {
      await live.preload()
      const ascendingFacade = live.get(1)!.facade
      const descendingFacade = live.get(2)!.facade
      expect(project(1)).toEqual(
        expectedMaterializations([
          { id: 10, value: 1 },
          { id: 20, value: 2 },
        ]),
      )
      expect(project(2)).toEqual(
        expectedMaterializations([
          { id: 20, value: 2 },
          { id: 10, value: 1 },
        ]),
      )
      expect(ascendingFacade).not.toBe(descendingFacade)

      parents.write(`update`, { id: 1, group: 1, direction: -1 })
      expect(live.get(1)!.facade).toBe(descendingFacade)
      expect(ascendingFacade.toArray).toEqual([])
      expect(project(1)).toEqual(
        expectedMaterializations([
          { id: 20, value: 2 },
          { id: 10, value: 1 },
        ]),
      )
    } finally {
      await Promise.all([
        live.cleanup(),
        parents.collection.cleanup(),
        children.collection.cleanup(),
      ])
    }
  })

  fcTest(`routes changes to parent-dependent child joins`, async () => {
    type JoinParent = ParentRow & { offset: number }
    type JoinedChild = ChildRow & { tagId: number }
    type Tag = { id: number; label: string }
    const parents = createControlledCollection<JoinParent>(
      `parent-join-parents`,
      [
        { id: 1, group: 1, offset: 0 },
        { id: 2, group: 1, offset: 1 },
      ],
    )
    const children = createControlledCollection<JoinedChild>(
      `parent-join-children`,
      [{ id: 10, parentGroup: 1, value: 1, tagId: 1 }],
    )
    const tags = createControlledCollection<Tag>(`parent-join-tags`, [
      { id: 1, label: `direct` },
      { id: 2, label: `offset` },
    ])
    const live = createLiveQueryCollection((q) =>
      q
        .from({ parent: parents.collection })
        .orderBy(({ parent }) => parent.id)
        .select(({ parent }) => {
          const childRows = () =>
            q
              .from({ child: children.collection })
              .innerJoin({ tag: tags.collection }, ({ child, tag }) =>
                eq(tag.id, add(child.tagId, parent.offset)),
              )
              .where(({ child }) => eq(child.parentGroup, parent.group))
              .select(({ child, tag }) => ({
                id: child.id,
                label: tag.label,
              }))

          return {
            id: parent.id,
            facade: include(childRows()),
            array: toArray(childRows()),
            materialized: materialize(childRows()),
          }
        }),
    )

    const project = (id: number) => {
      const row = live.get(id)!
      const labels = (values: Iterable<{ label: string }>) =>
        [...values].map(({ label }) => label)
      return {
        facade: labels(row.facade.values()),
        array: labels(row.array),
        materialized: labels(row.materialized),
      }
    }

    try {
      await live.preload()
      const directFacade = live.get(1)!.facade
      const offsetFacade = live.get(2)!.facade
      expect(directFacade).not.toBe(offsetFacade)
      expect(project(1)).toEqual(expectedMaterializations([`direct`]))
      expect(project(2)).toEqual(expectedMaterializations([`offset`]))

      parents.write(`update`, { id: 1, group: 1, offset: 1 })
      expect(live.get(1)!.facade).toBe(offsetFacade)
      expect(directFacade.toArray).toEqual([])
      expect(project(1)).toEqual(expectedMaterializations([`offset`]))
    } finally {
      await Promise.all([
        live.cleanup(),
        parents.collection.cleanup(),
        children.collection.cleanup(),
        tags.collection.cleanup(),
      ])
    }
  })

  fcTest(`facade public keys survive row cloning`, async () => {
    const driver = createCollectionDriver(
      [{ id: 1, group: 1 }],
      [{ id: 10, parentGroup: 1, value: 1 }],
    )
    const projection: TraceProjection<
      CollectionContext,
      { clonedKey: unknown },
      { clonedKey: number }
    > = {
      observe(context) {
        const facade = context.live.get(1)!.children
        const row = facade.get(10)!
        return { clonedKey: facade.getKeyFromItem({ ...row }) }
      },
      recompute: () => ({ clonedKey: 10 }),
      assertEqual(observed, expected) {
        expect(observed).toEqual(expected)
        return undefined
      },
    }

    await runTrace({ steps: [], driver, projection })
  })
})
