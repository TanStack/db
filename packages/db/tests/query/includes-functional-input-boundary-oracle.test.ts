import { describe, expect, it } from 'vitest'
import {
  createLiveQueryCollection,
  eq,
  materialize,
  toArray,
} from '../../src/query/index.js'
import { createControlledCollection } from './includes-oracle-helpers.js'

describe(`functional include input boundary`, () => {
  it.each(
    [`array`, `materialized`].flatMap((form) =>
      [`none`, `first`, `second`].map((failureAt) => ({ form, failureAt })),
    ),
  )(
    `keeps chained $form projections coherent through $failureAt failure`,
    async ({ form, failureAt }) => {
      const parents = createControlledCollection(`chain-parent`, [
        { id: 1, group: 1 },
      ])
      const children = createControlledCollection(`chain-child`, [
        { id: 10, group: 1 },
        { id: 20, group: 2 },
      ])
      const peers = createControlledCollection(`chain-peer`, [
        { id: 100, group: 1 },
        { id: 200, group: 2 },
      ])
      const failure = new Error(`projection failed`)
      let failing = false
      const query = createLiveQueryCollection((q) => {
        const source = q.from({ parent: parents.collection })
        const included =
          form === `array`
            ? source.select(({ parent }) => ({
                id: parent.id,
                group: parent.group,
                children: toArray(
                  q
                    .from({ child: children.collection })
                    .where(({ child }) => eq(child.group, parent.group)),
                ),
              }))
            : source.select(({ parent }) => ({
                id: parent.id,
                group: parent.group,
                children: materialize(
                  q
                    .from({ child: children.collection })
                    .where(({ child }) => eq(child.group, parent.group)),
                ),
              }))
        const first = q.from({ row: included }).fn.select(({ row }) => {
          if (failing && failureAt === `first`) throw failure
          return {
            id: row.id,
            group: row.group,
            ids: row.children.map((child) => child.id),
          }
        })
        const projected = q.from({ row: first })
        const combined =
          form === `array`
            ? projected.select(({ row }) => ({
                id: row.id,
                ids: row.ids,
                peers: toArray(
                  q
                    .from({ peer: peers.collection })
                    .where(({ peer }) => eq(peer.group, row.group)),
                ),
              }))
            : projected.select(({ row }) => ({
                id: row.id,
                ids: row.ids,
                peers: materialize(
                  q
                    .from({ peer: peers.collection })
                    .where(({ peer }) => eq(peer.group, row.group)),
                ),
              }))
        return q.from({ row: combined }).fn.select(({ row }) => {
          if (failing && failureAt === `second`) throw failure
          return {
            id: row.id,
            ids: [...row.ids, ...row.peers.map((peer) => peer.id)],
          }
        })
      })
      try {
        await query.preload()
        const old = query.get(1)!
        expect(old.ids).toEqual([10, 100])
        failing = failureAt !== `none`
        if (failing) {
          expect(() => parents.write(`update`, { id: 1, group: 2 })).toThrow(
            failure,
          )
          expect(query.get(1)).toBe(old)
          expect(old.ids).toEqual([10, 100])
        } else {
          parents.write(`update`, { id: 1, group: 2 })
          expect(query.get(1)!.ids).toEqual([20, 200])
          expect(old.ids).toEqual([10, 100])
        }
        await query.cleanup()
        failing = false
        await query.preload()
        expect(query.get(1)!.ids).toEqual([20, 200])
        peers.write(`insert`, { id: 201, group: 2 })
        expect(query.get(1)!.ids).toEqual([20, 200, 201])
      } finally {
        await query.cleanup()
        await parents.collection.cleanup()
        await children.collection.cleanup()
        await peers.collection.cleanup()
      }
    },
  )

  it(`keeps singleton materialization reactive through absence`, async () => {
    const parents = createControlledCollection(`singleton-parent`, [{ id: 1 }])
    const children = createControlledCollection(`singleton-child`, [
      { id: 10, parentId: 2, value: 3 },
    ])
    const query = createLiveQueryCollection((q) => {
      const included = q
        .from({ parent: parents.collection })
        .select(({ parent }) => ({
          id: parent.id,
          child: materialize(
            q
              .from({ child: children.collection })
              .where(({ child }) => eq(child.parentId, parent.id))
              .findOne(),
          ),
        }))
      return q
        .from({ row: included })
        .fn.select(({ row }) => ({ id: row.id, value: row.child?.value ?? 0 }))
    })
    try {
      await query.preload()
      expect(query.get(1)!.value).toBe(0)
      children.write(`update`, { id: 10, parentId: 1, value: 3 })
      expect(query.get(1)!.value).toBe(3)
      children.write(`update`, { id: 10, parentId: 1, value: 7 })
      expect(query.get(1)!.value).toBe(7)
      children.write(`delete`, { id: 10, parentId: 1, value: 7 })
      expect(query.get(1)!.value).toBe(0)
    } finally {
      await query.cleanup()
      await parents.collection.cleanup()
      await children.collection.cleanup()
    }
  })

  it.each([
    `read`,
    `pass-through`,
    `ignore`,
    `subscribe`,
    `create-index`,
  ] as const)(
    `rejects a Collection input before the callback can %s it`,
    async (use) => {
      const parents = createControlledCollection(`boundary-parent`, [{ id: 1 }])
      const children = createControlledCollection(`boundary-child`, [
        { id: 10, parentId: 1 },
      ])
      let calls = 0
      let query: ReturnType<typeof createLiveQueryCollection> | undefined
      try {
        await expect(
          (async () => {
            query = createLiveQueryCollection((q) =>
              q
                .from({
                  row: q
                    .from({ parent: parents.collection })
                    .select(({ parent }) => ({
                      id: parent.id,
                      children: q
                        .from({ child: children.collection })
                        .where(({ child }) => eq(child.parentId, parent.id)),
                    })),
                })
                .fn.select(({ row }) => {
                  calls++
                  if (use === `subscribe`)
                    row.children.subscribeChanges(() => {})
                  if (use === `create-index`)
                    row.children.createIndex((child) => child.id)
                  return {
                    id: row.id,
                    value:
                      use === `read`
                        ? row.children.size
                        : use === `pass-through`
                          ? row.children
                          : null,
                  }
                }),
            )
            await query.preload()
          })(),
        ).rejects.toThrow(
          `fn.select() cannot consume Collection-valued includes`,
        )
        expect(calls).toBe(0)
      } finally {
        await query?.cleanup()
        await parents.collection.cleanup()
        await children.collection.cleanup()
      }
    },
  )

  it.each([`array`, `materialized`] as const)(
    `keeps %s calculations reactive after child-only changes`,
    async (form) => {
      const parents = createControlledCollection(`inline-parent`, [{ id: 1 }])
      const children = createControlledCollection(`inline-child`, [
        { id: 10, parentId: 1, value: 3 },
      ])
      let calls = 0
      const query = createLiveQueryCollection((q) => {
        const source = q.from({ parent: parents.collection })
        const included =
          form === `array`
            ? source.select(({ parent }) => ({
                id: parent.id,
                children: toArray(
                  q
                    .from({ child: children.collection })
                    .where(({ child }) => eq(child.parentId, parent.id)),
                ),
              }))
            : source.select(({ parent }) => ({
                id: parent.id,
                children: materialize(
                  q
                    .from({ child: children.collection })
                    .where(({ child }) => eq(child.parentId, parent.id)),
                ),
              }))
        return q.from({ row: included }).fn.select(({ row }) => {
          calls++
          return {
            id: row.id,
            count: row.children.length,
            sum: row.children.reduce((sum, child) => sum + child.value, 0),
            found: row.children.find((child) => child.id === 10)?.value,
          }
        })
      })
      try {
        await query.preload()
        expect(query.get(1)).toMatchObject({ count: 1, sum: 3, found: 3 })
        const initialCalls = calls
        children.write(`update`, { id: 10, parentId: 1, value: 7 })
        expect(query.get(1)).toMatchObject({ count: 1, sum: 7, found: 7 })
        expect(calls).toBeGreaterThan(initialCalls)
        children.write(`insert`, { id: 11, parentId: 1, value: 5 })
        expect(query.get(1)).toMatchObject({ count: 2, sum: 12, found: 7 })
        children.write(`delete`, { id: 10, parentId: 1, value: 7 })
        expect(query.get(1)).toMatchObject({
          count: 1,
          sum: 5,
          found: undefined,
        })
      } finally {
        await query.cleanup()
        await parents.collection.cleanup()
        await children.collection.cleanup()
      }
    },
  )

  it(`keeps a bare Collection live through an expression projection`, async () => {
    const parents = createControlledCollection(`expression-parent`, [{ id: 1 }])
    const children = createControlledCollection(`expression-child`, [
      { id: 10, parentId: 1 },
    ])
    const query = createLiveQueryCollection((q) =>
      q
        .from({
          row: q.from({ parent: parents.collection }).select(({ parent }) => ({
            id: parent.id,
            children: q
              .from({ child: children.collection })
              .where(({ child }) => eq(child.parentId, parent.id)),
          })),
        })
        .select(({ row }) => ({ id: row.id, children: row.children })),
    )
    try {
      await query.preload()
      const held = query.get(1)!.children
      expect(held.get(10)?.id).toBe(10)
      children.write(`insert`, { id: 11, parentId: 1 })
      expect(query.get(1)!.children).toBe(held)
      expect(held.get(11)?.id).toBe(11)
    } finally {
      await query.cleanup()
      await parents.collection.cleanup()
      await children.collection.cleanup()
    }
  })

  it(`keeps parent-only functional work before adding live children`, async () => {
    const parents = createControlledCollection(`parent-first`, [{ id: 1 }])
    const children = createControlledCollection(`parent-first-child`, [
      { id: 10, parentId: 1 },
    ])
    const query = createLiveQueryCollection((q) => {
      const projected = q
        .from({ parent: parents.collection })
        .fn.select(({ parent }) => ({
          id: parent.id,
          label: `Parent ${parent.id}`,
        }))
      return q.from({ row: projected }).select(({ row }) => ({
        id: row.id,
        label: row.label,
        children: q
          .from({ child: children.collection })
          .where(({ child }) => eq(child.parentId, row.id)),
      }))
    })
    let publications = 0
    const subscription = query.subscribeChanges(() => {
      publications++
    })
    try {
      await query.preload()
      const held = query.get(1)!.children
      expect(query.get(1)!.label).toBe(`Parent 1`)
      expect(held.get(10)?.id).toBe(10)
      publications = 0
      children.write(`insert`, { id: 11, parentId: 1 })
      expect(held.get(11)?.id).toBe(11)
      expect(publications).toBe(0)
    } finally {
      subscription.unsubscribe()
      await query.cleanup()
      await parents.collection.cleanup()
      await children.collection.cleanup()
    }
  })

  it.each([false, true])(
    `checks nested Collection inputs (inline=%s)`,
    async (inline) => {
      const parents = createControlledCollection(`nested-parent`, [{ id: 1 }])
      const children = createControlledCollection(`nested-child`, [
        { id: 10, parentId: 1 },
      ])
      const leaves = createControlledCollection(`nested-leaf`, [
        { id: 100, childId: 10 },
      ])
      let cleanup = async () => {}
      try {
        const run = async () => {
          const query = createLiveQueryCollection((q) => {
            const included = q
              .from({ parent: parents.collection })
              .select(({ parent }) => ({
                id: parent.id,
                children: toArray(
                  q
                    .from({ child: children.collection })
                    .where(({ child }) => eq(child.parentId, parent.id))
                    .select(({ child }) => {
                      const leafQuery = q
                        .from({ leaf: leaves.collection })
                        .where(({ leaf }) => eq(leaf.childId, child.id))
                      return {
                        id: child.id,
                        leaves: inline ? toArray(leafQuery) : leafQuery,
                      }
                    }),
                ),
              }))
            return q
              .from({ row: included })
              .fn.select(({ row }) => ({ id: row.id, children: row.children }))
          })
          cleanup = () => query.cleanup()
          await query.preload()
          expect(query.get(1)).toMatchObject({
            children: [{ id: 10, leaves: [{ id: 100 }] }],
          })
        }
        if (inline) await run()
        else
          await expect(run()).rejects.toThrow(
            `fn.select() cannot consume Collection-valued includes`,
          )
      } finally {
        await cleanup()
        await parents.collection.cleanup()
        await children.collection.cleanup()
        await leaves.collection.cleanup()
      }
    },
  )
})
