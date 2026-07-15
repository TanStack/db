import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryCollection } from '../src/query/live-query-collection.js'
import { createLiveQueryObserver } from '../src/live-query-observer.js'
import { eq } from '../src/query/builder/functions.js'
import { mockSyncCollectionOptions } from './utils.js'

interface Person {
  id: string
  name: string
  age: number
}

const SEED: Array<Person> = [
  { id: `1`, name: `Alice`, age: 30 },
  { id: `2`, name: `Bob`, age: 20 },
  { id: `3`, name: `Carol`, age: 40 },
]

let seq = 0
function makeSource(data: Array<Person> = SEED) {
  return createCollection(
    mockSyncCollectionOptions<Person>({
      id: `order-only-move-${seq++}`,
      getKey: (p) => p.id,
      initialData: data,
    }),
  )
}

/** Live query ordered by `age` (NOT projected), selecting only `{ id, name }`. */
async function makeOrderedByAge(source: ReturnType<typeof makeSource>) {
  const lq = createLiveQueryCollection((q) =>
    q
      .from({ p: source })
      .orderBy(({ p }) => p.age, `asc`)
      .select(({ p }) => ({ id: p.id, name: p.name })),
  )
  await lq.preload()
  return lq
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe(`order-only move (RFC #1623 phase 4)`, () => {
  it(`republishes the ordered result when a row moves but its value is unchanged`, async () => {
    const source = makeSource()
    const lq = await makeOrderedByAge(source)
    const observer = createLiveQueryObserver<
      { id: string; name: string },
      string
    >(lq as any)

    let notifications = 0
    observer.subscribe(() => {
      notifications++
    })

    const before = observer.getSnapshot()
    expect((before.data as Array<any>).map((r) => r.id)).toEqual([
      `2`,
      `1`,
      `3`,
    ])
    const revBefore = before.layoutRevision

    // Move Bob (age 20 -> 99) to the end. The projected `{ id, name }` is
    // identical, so the collection's value-diff emits no row change — only the
    // layout notification should republish the new order.
    source.utils.begin()
    source.utils.write({
      type: `update`,
      value: { id: `2`, name: `Bob`, age: 99 },
    })
    source.utils.commit()
    await flush()

    const after = observer.getSnapshot()
    expect((after.data as Array<any>).map((r) => r.id)).toEqual([`1`, `3`, `2`])
    expect(after.layoutRevision).toBeGreaterThan(revBefore)
    expect(notifications).toBeGreaterThan(0)
    observer.dispose()
  })

  it(`does not bump the layout revision when nothing about the layout changes`, async () => {
    const source = makeSource()
    const lq = await makeOrderedByAge(source)
    const observer = createLiveQueryObserver<
      { id: string; name: string },
      string
    >(lq as any)
    observer.subscribe(() => {})

    const revBefore = observer.getSnapshot().layoutRevision

    // Update a row's `age` in a way that keeps its sort position (20 -> 21,
    // still the youngest) and does not change the projected value.
    source.utils.begin()
    source.utils.write({
      type: `update`,
      value: { id: `2`, name: `Bob`, age: 21 },
    })
    source.utils.commit()
    await flush()

    // Order is unchanged (`2` still first), so the layout revision is stable.
    const after = observer.getSnapshot()
    expect((after.data as Array<any>).map((r) => r.id)).toEqual([`2`, `1`, `3`])
    expect(after.layoutRevision).toBe(revBefore)
    observer.dispose()
  })

  it(`bumps the layout revision on membership changes too`, async () => {
    const source = makeSource()
    const lq = await makeOrderedByAge(source)
    const observer = createLiveQueryObserver<
      { id: string; name: string },
      string
    >(lq as any)
    observer.subscribe(() => {})

    const revBefore = observer.getSnapshot().layoutRevision

    source.utils.begin()
    source.utils.write({
      type: `insert`,
      value: { id: `4`, name: `Dan`, age: 10 },
    })
    source.utils.commit()
    await flush()

    const after = observer.getSnapshot()
    expect((after.data as Array<any>).map((r) => r.id)).toEqual([
      `4`,
      `2`,
      `1`,
      `3`,
    ])
    expect(after.layoutRevision).toBeGreaterThan(revBefore)
    observer.dispose()
  })

  // Kyle's review issue 1: a commit containing both an ordinary value update
  // and an order-only move must publish exactly once — the ordinary publication
  // already carries the final values and ordering, so the separate layout event
  // is redundant.
  it(`publishes a mixed value update and order-only move exactly once`, async () => {
    const source = makeSource()
    const lq = await makeOrderedByAge(source)
    const observer = createLiveQueryObserver<
      { id: string; name: string },
      string
    >(lq as any)

    let notifications = 0
    observer.subscribe(() => notifications++)
    notifications = 0 // exclude subscribeChanges' initial-state publication

    source.utils.begin()
    source.utils.write({
      type: `update`,
      value: { id: `1`, name: `Alicia`, age: 30 },
    })
    source.utils.write({
      type: `update`,
      value: { id: `2`, name: `Bob`, age: 99 },
    })
    source.utils.commit()

    const after = observer.getSnapshot()
    expect(
      (after.data as Array<Person>).map(({ id, name }) => [id, name]),
    ).toEqual([
      [`1`, `Alicia`],
      [`3`, `Carol`],
      [`2`, `Bob`],
    ])
    expect(notifications).toBe(1)
    observer.dispose()
  })

  // Kyle's review issue 2: an ordered child collection produced by `includes`
  // must consume the insertion-side order metadata and publish its move when the
  // projected child value is unchanged.
  it(`publishes an ordered included child move exactly once`, async () => {
    const parents = createCollection(
      mockSyncCollectionOptions<{ id: string }>({
        id: `order-only-parents-${seq++}`,
        getKey: ({ id }) => id,
        initialData: [{ id: `p1` }],
      }),
    )
    const children = createCollection(
      mockSyncCollectionOptions<{
        id: string
        parentId: string
        name: string
        position: number
      }>({
        id: `order-only-children-${seq++}`,
        getKey: ({ id }) => id,
        initialData: [
          { id: `c1`, parentId: `p1`, name: `One`, position: 1 },
          { id: `c2`, parentId: `p1`, name: `Two`, position: 2 },
        ],
      }),
    )
    const lq = createLiveQueryCollection((q) =>
      q.from({ parent: parents }).select(({ parent }) => ({
        id: parent.id,
        children: q
          .from({ child: children })
          .where(({ child }) => eq(child.parentId, parent.id))
          .orderBy(({ child }) => child.position)
          .select(({ child }) => ({ id: child.id, name: child.name })),
      })),
    )
    await lq.preload()

    const childCollection = (lq.get(`p1`) as any).children
    let notifications = 0
    const subscription = childCollection.subscribeChanges(
      () => notifications++,
      { includeInitialState: false },
    )

    children.utils.begin()
    children.utils.write({
      type: `update`,
      value: { id: `c1`, parentId: `p1`, name: `One`, position: 3 },
    })
    children.utils.commit()

    expect([...childCollection.values()].map(({ id }: any) => id)).toEqual([
      `c2`,
      `c1`,
    ])
    expect(notifications).toBe(1)
    subscription.unsubscribe()
  })

  // The includes flush is recursive, so the order-only-move handling must hold
  // at depth, not just one level. Two levels of ordered includes
  // (org -> teams -> members); move a grandchild whose projected value is
  // unchanged and assert its collection re-sorts and publishes exactly once.
  it(`publishes an ordered move in a deeply-nested included child exactly once`, async () => {
    const orgs = createCollection(
      mockSyncCollectionOptions<{ id: string }>({
        id: `order-only-orgs-${seq++}`,
        getKey: ({ id }) => id,
        initialData: [{ id: `o1` }],
      }),
    )
    const teams = createCollection(
      mockSyncCollectionOptions<{ id: string; orgId: string; position: number }>(
        {
          id: `order-only-teams-${seq++}`,
          getKey: ({ id }) => id,
          initialData: [{ id: `t1`, orgId: `o1`, position: 1 }],
        },
      ),
    )
    const members = createCollection(
      mockSyncCollectionOptions<{
        id: string
        teamId: string
        name: string
        position: number
      }>({
        id: `order-only-members-${seq++}`,
        getKey: ({ id }) => id,
        initialData: [
          { id: `m1`, teamId: `t1`, name: `One`, position: 1 },
          { id: `m2`, teamId: `t1`, name: `Two`, position: 2 },
        ],
      }),
    )
    const lq = createLiveQueryCollection((q) =>
      q.from({ org: orgs }).select(({ org }) => ({
        id: org.id,
        teams: q
          .from({ team: teams })
          .where(({ team }) => eq(team.orgId, org.id))
          .orderBy(({ team }) => team.position)
          .select(({ team }) => ({
            id: team.id,
            members: q
              .from({ member: members })
              .where(({ member }) => eq(member.teamId, team.id))
              .orderBy(({ member }) => member.position)
              .select(({ member }) => ({ id: member.id, name: member.name })),
          })),
      })),
    )
    await lq.preload()

    const teamCollection = (lq.get(`o1`) as any).teams
    const memberCollection = (teamCollection.get(`t1`)).members
    let notifications = 0
    const subscription = memberCollection.subscribeChanges(
      () => notifications++,
      { includeInitialState: false },
    )

    // Move m1 behind m2 (position 1 -> 3); projected { id, name } unchanged.
    members.utils.begin()
    members.utils.write({
      type: `update`,
      value: { id: `m1`, teamId: `t1`, name: `One`, position: 3 },
    })
    members.utils.commit()

    expect([...memberCollection.values()].map(({ id }: any) => id)).toEqual([
      `m2`,
      `m1`,
    ])
    expect(notifications).toBe(1)
    subscription.unsubscribe()
  })
})
