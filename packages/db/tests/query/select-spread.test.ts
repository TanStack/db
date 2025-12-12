import { beforeEach, describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { mockSyncCollectionOptions } from '../utils.js'
import { add, eq, upper } from '../../src/query/builder/functions.js'

// Base type used in bug report
interface Message {
  id: number
  text: string
  user: string
}

const initialMessages: Array<Message> = [
  { id: 1, text: `hello`, user: `sam` },
  { id: 2, text: `world`, user: `kim` },
]

function createMessagesCollection() {
  return createCollection(
    mockSyncCollectionOptions<Message>({
      id: `messages-select-spread`,
      getKey: (m) => m.id,
      initialData: initialMessages,
    }),
  )
}

// Nested message shape for deeper spread tests
interface MessageWithMeta extends Message {
  meta: {
    tags: Array<string>
    author: {
      name: string
      rating: number
    }
  }
}

const nestedMessages: Array<MessageWithMeta> = [
  {
    id: 1,
    text: `hello`,
    user: `sam`,
    meta: { tags: [`a`, `b`], author: { name: `sam`, rating: 5 } },
  },
  {
    id: 2,
    text: `world`,
    user: `kim`,
    meta: { tags: [`x`], author: { name: `kim`, rating: 3 } },
  },
]

function createMessagesWithMetaCollection() {
  return createCollection(
    mockSyncCollectionOptions<MessageWithMeta>({
      id: `messages-select-spread-nested`,
      getKey: (m) => m.id,
      initialData: nestedMessages,
    }),
  )
}

// A second collection to verify spreading across multiple aliases (join)
interface UserRow {
  id: number
  alias: string
}

const usersData: Array<UserRow> = [
  { id: 1, alias: `sammy` },
  { id: 2, alias: `kimmy` },
]

function createUsersCollection() {
  return createCollection(
    mockSyncCollectionOptions<UserRow>({
      id: `users-select-spread`,
      getKey: (u) => u.id,
      initialData: usersData,
    }),
  )
}

describe(`select spreads (runtime)`, () => {
  let messagesCollection: ReturnType<typeof createMessagesCollection>

  beforeEach(() => {
    messagesCollection = createMessagesCollection()
  })

  it(`spreading the source alias projects the full row`, async () => {
    const collection = createLiveQueryCollection((q) =>
      q.from({ message: messagesCollection }).select(({ message }) => ({
        ...message,
      })),
    )
    await collection.preload()

    const results = Array.from(collection.values())
    expect(results).toHaveLength(2)
    // Should match initial data exactly
    expect(results).toEqual(initialMessages)
    // Index access by key
    expect(collection.get(1)).toEqual(initialMessages[0])
  })

  it(`spread + computed fields merges fields with correct values`, async () => {
    const collection = createLiveQueryCollection((q) =>
      q.from({ message: messagesCollection }).select(({ message }) => ({
        ...message,
        idPlusOne: add(message.id, 1),
        upperText: upper(message.text),
      })),
    )
    await collection.preload()

    const results = Array.from(collection.values())
    expect(results).toHaveLength(2)

    const r1 = results.find((m) => m.id === 1)!
    expect(r1).toMatchObject({ id: 1, text: `hello`, user: `sam` })
    expect(r1.idPlusOne).toBe(2)
    expect(r1.upperText).toBe(`HELLO`)

    const r2 = results.find((m) => m.id === 2)!
    expect(r2.idPlusOne).toBe(3)
    expect(r2.upperText).toBe(`WORLD`)
  })

  it(`explicit property wins over spread (override after spread)`, async () => {
    const collection = createLiveQueryCollection((q) =>
      q.from({ message: messagesCollection }).select(({ message }) => ({
        ...message,
        user: upper(message.user),
      })),
    )
    await collection.preload()

    const results = Array.from(collection.values())
    const r1 = results.find((m) => m.id === 1)!
    expect(r1.user).toBe(`SAM`)
  })

  it(`spread after explicit property restores original (last spread wins)`, async () => {
    const collection = createLiveQueryCollection((q) =>
      q.from({ message: messagesCollection }).select(({ message }) => ({
        // @ts-expect-error - user is overridden by spread
        user: upper(message.user),
        ...message,
      })),
    )
    await collection.preload()

    const results = Array.from(collection.values())
    const r1 = results.find((m) => m.id === 1)!
    // Because the later spread should overwrite earlier user override
    expect(r1.user).toBe(`sam`)
  })

  it(`live updates maintain spread semantics`, async () => {
    const collection = createLiveQueryCollection((q) =>
      q.from({ message: messagesCollection }).select(({ message }) => ({
        ...message,
      })),
    )
    await collection.preload()

    // Insert new message
    messagesCollection.utils.begin()
    messagesCollection.utils.write({
      type: `insert`,
      value: { id: 3, text: `test`, user: `alex` },
    })
    messagesCollection.utils.commit()

    const results = Array.from(collection.values())
    expect(results).toHaveLength(3)
    expect(collection.get(3)).toEqual({ id: 3, text: `test`, user: `alex` })
  })

  it(`spreading preserves nested object fields intact`, async () => {
    const messagesNested = createMessagesWithMetaCollection()
    const collection = createLiveQueryCollection((q) =>
      q.from({ m: messagesNested }).select(({ m }) => ({
        ...m,
      })),
    )
    await collection.preload()

    const results = Array.from(collection.values())
    expect(results).toEqual(nestedMessages)

    const r1 = results.find((r) => r.id === 1) as MessageWithMeta
    expect(r1.meta.author.name).toBe(`sam`)
    expect(r1.meta.tags).toEqual([`a`, `b`])
  })

  it(`repeating the same alias spread multiple times uses last-wins for all fields`, async () => {
    const collection = createLiveQueryCollection((q) =>
      q.from({ message: messagesCollection }).select(({ message }) => ({
        ...message,
        // @ts-expect-error - user is overridden by spread
        user: upper(message.user),
        // later spread should restore original values for all overlapping keys
        ...message,
        // and a final override wins over the last spread
        text: upper(message.text),
      })),
    )
    await collection.preload()

    const r1 = Array.from(collection.values()).find((m) => m.id === 1)!
    // user restored by second spread
    expect(r1.user).toBe(`sam`)
    // text overridden after the second spread
    expect(r1.text).toBe(`HELLO`)
  })

  it(`spreading across multiple aliases merges both rows (no collisions)`, async () => {
    const users = createUsersCollection()
    const collection = createLiveQueryCollection((q) =>
      q
        .from({ m: messagesCollection })
        .join({ u: users }, ({ m, u }) => eq(m.id, u.id), `inner`)
        .select(({ m, u }) => ({
          ...m,
          ...u,
        })),
    )
    await collection.preload()

    const r1 = Array.from(collection.values()).find((row) => row.id === 1)!
    // id comes from last spread (users), but here both ids are equal anyway
    expect(r1.alias).toBe(`sammy`)
    expect(r1.text).toBe(`hello`)
  })

  it(`nested object property supports spreading another object under that key`, async () => {
    const messagesNested = createMessagesWithMetaCollection()
    const collection = createLiveQueryCollection((q) =>
      q.from({ m: messagesNested }).select(({ m }) => ({
        id: m.id,
        user: m.user,
        meta: {
          extra: 1,
          // desired: spread meta fields under meta key
          ...m.meta,
        },
      })),
    )
    await collection.preload()

    const r1 = Array.from(collection.values()).find((r) => r.id === 1) as any
    expect(r1.meta.extra).toBe(1)
    expect(r1.meta.tags).toEqual([`a`, `b`]) // from spread
    expect(r1.meta.author).toEqual({ name: `sam`, rating: 5 })
  })

  it(`nested spread respects last-wins within the nested object`, async () => {
    const messagesNested = createMessagesWithMetaCollection()
    const collection = createLiveQueryCollection((q) =>
      q.from({ m: messagesNested }).select(({ m }) => ({
        id: m.id,
        meta: {
          // override first
          // @ts-expect-error - user is overridden by spread
          author: { name: upper(m.user), rating: 0 },
          // last spread restores original author
          ...m.meta,
        },
      })),
    )
    await collection.preload()

    const r1 = Array.from(collection.values()).find((r) => r.id === 1) as any
    expect(r1.meta.author).toEqual({ name: `sam`, rating: 5 })
  })
})
