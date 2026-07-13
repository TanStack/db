import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryCollection } from '../src/query/live-query-collection.js'
import { createLiveQueryObserver } from '../src/live-query-observer.js'
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
})
