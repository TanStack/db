import { afterEach, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/query-core'
import {
  BTreeIndex,
  createCollection,
  createLiveQueryCollection,
  eq,
  extractSimpleComparisons,
  getLoadSubsetDemandKey,
} from '@tanstack/db'
import { queryCollectionOptions } from '../src/query'
import type { QueryFunctionContext } from '@tanstack/query-core'

const cleanups: Array<() => void | Promise<void>> = []
let sequence = 0

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function createParentSource(ids: ReadonlyArray<number>) {
  const parents = createCollection<{ id: number }, number>({
    id: `joined-dedupe-parents-${sequence++}`,
    getKey: (row) => row.id,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const id of ids) write({ type: `insert`, value: { id } })
        commit()
        markReady()
      },
    },
  })
  cleanups.push(() => parents.cleanup())
  return parents
}

function createChildSource() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const rows = [
    { id: 10, parentId: 1 },
    { id: 20, parentId: 2 },
  ]
  const queryFn = vi.fn((context: QueryFunctionContext) => {
    const where = context.meta?.loadSubsetOptions?.where
    const parentId = extractSimpleComparisons(where).find(
      ({ field }) => field.join(`.`) === `parentId`,
    )
    if (parentId?.operator === `eq`)
      return Promise.resolve(
        rows.filter((row) => row.parentId === parentId.value),
      )
    if (parentId?.operator === `in` && Array.isArray(parentId.value))
      return Promise.resolve(
        rows.filter((row) => parentId.value.includes(row.parentId)),
      )
    if (where === undefined) return Promise.resolve(rows)
    throw new Error(`Unexpected joined-demand predicate`)
  })
  const children = createCollection(
    queryCollectionOptions({
      id: `joined-dedupe-children-${sequence++}`,
      queryClient: client,
      queryKey: [`joined-dedupe-children`],
      queryFn,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
    }),
  )
  cleanups.push(() => client.clear())
  cleanups.push(() => children.cleanup())
  return { children, queryFn }
}

function createJoin(
  parents: ReturnType<typeof createParentSource>,
  children: ReturnType<typeof createChildSource>[`children`],
) {
  const live = createLiveQueryCollection((q) =>
    q
      .from({ parent: parents })
      .join({ child: children }, ({ parent, child }) =>
        eq(child.parentId, parent.id),
      ),
  )
  cleanups.push(() => live.cleanup())
  return live
}

it(`shares identical joined demands after settled load`, async () => {
  const parents = createParentSource([1, 2])
  const { children, queryFn } = createChildSource()
  const first = createJoin(parents, children)
  await first.preload()
  const second = createJoin(parents, children)
  await second.preload()
  expect(queryFn).toHaveBeenCalledTimes(1)
  expect(first.toArray).toHaveLength(2)
  expect(second.toArray).toHaveLength(2)
})

it(`shares identical joined demands while loading`, async () => {
  const parents = createParentSource([1, 2])
  const { children, queryFn } = createChildSource()
  await Promise.all([
    createJoin(parents, children).preload(),
    createJoin(parents, children).preload(),
  ])
  expect(queryFn).toHaveBeenCalledTimes(1)
})

it(`shares joined demands from independent parent sources`, async () => {
  const forward = createParentSource([1, 2])
  const reverse = createParentSource([2, 1])
  const { children, queryFn } = createChildSource()
  await createJoin(forward, children).preload()
  await createJoin(reverse, children).preload()
  expect(queryFn).toHaveBeenCalledTimes(1)
})

it(`shares a direct equality request with the same joined singleton request`, async () => {
  const parents = createParentSource([1])
  const { children, queryFn } = createChildSource()
  const direct = createLiveQueryCollection((q) =>
    q.from({ child: children }).where(({ child }) => eq(child.parentId, 1)),
  )
  cleanups.push(() => direct.cleanup())
  await direct.preload()
  const joined = createJoin(parents, children)
  await joined.preload()
  expect(queryFn).toHaveBeenCalledTimes(1)
  expect(direct.toArray.map((row) => row.id)).toEqual([10])
  expect(joined.toArray.map((row) => row.child?.id)).toEqual([10])
})

for (const firstOwner of [`joined`, `direct`] as const) {
  for (const retiredOwner of [`joined`, `direct`] as const) {
    it(`keeps peer rows when ${firstOwner} loads first and ${retiredOwner} retires first`, async () => {
      // One source row satisfies both logical owners. The reference keeps it
      // visible until the last owner retires, independent of acquisition order.
      const parents = createParentSource([1])
      const { children, queryFn } = createChildSource()
      const joined = createJoin(parents, children)
      const direct = createLiveQueryCollection((q) =>
        q.from({ child: children }).where(({ child }) => eq(child.parentId, 1)),
      )
      cleanups.push(() => direct.cleanup())
      const owners = { joined, direct }
      await owners[firstOwner].preload()
      await owners[firstOwner === `joined` ? `direct` : `joined`].preload()
      expect(queryFn).toHaveBeenCalledTimes(1)
      const firstWhere =
        queryFn.mock.calls[0]![0].meta?.loadSubsetOptions?.where
      const firstComparison = extractSimpleComparisons(firstWhere).find(
        ({ field }) => field.join(`.`) === `parentId`,
      )
      expect(firstComparison?.operator).toBe(
        firstOwner === `joined` ? `in` : `eq`,
      )
      expect(firstComparison?.value).toEqual(firstOwner === `joined` ? [1] : 1)
      expect(joined.toArray.map((row) => row.child?.id)).toEqual([10])
      expect(direct.toArray.map((row) => row.id)).toEqual([10])

      await owners[retiredOwner].cleanup()
      if (retiredOwner === `joined`) {
        expect(direct.toArray.map((row) => row.id)).toEqual([10])
      } else {
        expect(joined.toArray.map((row) => row.child?.id)).toEqual([10])
      }
      expect(children.has(10)).toBe(true)
      await owners[retiredOwner === `joined` ? `direct` : `joined`].cleanup()
      await vi.waitFor(() => expect(children.has(10)).toBe(false))
      expect(queryFn).toHaveBeenCalledTimes(1)
    })
  }
}

it.each(
  ([`joined`, `direct`] as const).flatMap((firstOwner) =>
    ([`joined`, `direct`] as const).map((retiredOwner) => ({
      firstOwner,
      retiredOwner,
    })),
  ),
)(
  `keeps the surviving equality or singleton owner when $firstOwner loads first and $retiredOwner retires`,
  async ({ firstOwner, retiredOwner }) => {
    const parents = createParentSource([1])
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    let finish!: (rows: Array<{ id: number; parentId: number }>) => void
    const queryFn = vi.fn((context: QueryFunctionContext) => {
      return new Promise<Array<{ id: number; parentId: number }>>(
        (resolve, reject) => {
          finish = resolve
          const requestSignal = context.meta?.loadSubsetOptions?.signal
          if (!requestSignal) throw new Error(`expected request signal`)
          requestSignal.addEventListener(`abort`, () => {
            reject(new Error(`shared fetch aborted`))
          })
        },
      )
    })
    const children = createCollection(
      queryCollectionOptions({
        id: `joined-inflight-child-${sequence++}`,
        queryClient: client,
        queryKey: [`joined-inflight-child`],
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
      }),
    )
    cleanups.push(() => client.clear())
    cleanups.push(() => children.cleanup())
    const loadSubset = vi.spyOn(children._sync, `loadSubset`)
    const direct = createLiveQueryCollection((q) =>
      q.from({ child: children }).where(({ child }) => eq(child.parentId, 1)),
    )
    cleanups.push(() => direct.cleanup())
    const joined = createJoin(parents, children)
    const owners = { direct, joined }
    const secondOwner = firstOwner === `direct` ? `joined` : `direct`
    const outcome = (promise: Promise<unknown>) =>
      promise.then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      )
    const firstLoad = outcome(owners[firstOwner].preload())
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1))
    const secondLoad = outcome(owners[secondOwner].preload())
    await vi.waitFor(() => expect(loadSubset).toHaveBeenCalledTimes(2))
    // Equal demand keys and one provider call check the dedupe work promise.
    expect(getLoadSubsetDemandKey(loadSubset.mock.calls[0]![0])).toBe(
      getLoadSubsetDemandKey(loadSubset.mock.calls[1]![0]),
    )
    await owners[retiredOwner].cleanup()
    expect(queryFn).toHaveBeenCalledTimes(1)
    finish([{ id: 10, parentId: 1 }])
    const surviving = retiredOwner === firstOwner ? secondOwner : firstOwner
    // The surviving preload and public row check the independent ownership law.
    const result = await (surviving === firstOwner ? firstLoad : secondLoad)
    expect(result).toEqual({ ok: true })
    expect(
      surviving === `joined`
        ? joined.toArray.map((row) => row.child?.id)
        : direct.toArray.map((row) => row.id),
    ).toEqual([10])
  },
)
