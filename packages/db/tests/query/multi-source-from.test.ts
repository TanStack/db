import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import {
  caseWhen,
  coalesce,
  concat,
  createLiveQueryCollection,
  eq,
  toArray,
} from '../../src/query/index.js'
import {
  flushPromises,
  mockSyncCollectionOptions,
  stripVirtualProps,
} from '../utils.js'
import { OnlyOneSourceAllowedError } from '../../src/errors.js'
import type { LoadSubsetOptions } from '../../src/types.js'

type Message = {
  id: number
  text: string
  kind: `visible` | `hidden`
  timestamp: number
  userId: number
}

type ToolCall = {
  id: number
  name: string
  timestamp: number
  userId: number
}

type Chunk = {
  id: number
  messageId: number
  text: string
}

type User = {
  id: number
  name: string
}

type LabelRow = {
  id: number
  label: string
}

const messagesData: Array<Message> = [
  { id: 1, text: `hello`, kind: `visible`, timestamp: 10, userId: 1 },
  { id: 2, text: `secret`, kind: `hidden`, timestamp: 30, userId: 2 },
]

const toolCallsData: Array<ToolCall> = [
  { id: 1, name: `search`, timestamp: 20, userId: 1 },
  { id: 3, name: `write`, timestamp: 40, userId: 3 },
]

function createMessagesCollection(id: string) {
  return createCollection(
    mockSyncCollectionOptions<Message>({
      id,
      getKey: (message) => message.id,
      initialData: messagesData,
    }),
  )
}

function createToolCallsCollection(id: string) {
  return createCollection(
    mockSyncCollectionOptions<ToolCall>({
      id,
      getKey: (toolCall) => toolCall.id,
      initialData: toolCallsData,
    }),
  )
}

function createChunksCollection(id: string) {
  return createCollection(
    mockSyncCollectionOptions<Chunk>({
      id,
      getKey: (chunk) => chunk.id,
      initialData: [
        { id: 1, messageId: 1, text: `hello` },
        { id: 2, messageId: 1, text: `world` },
        { id: 3, messageId: 2, text: `hidden` },
      ],
    }),
  )
}

function createUsersCollection(id: string) {
  return createCollection(
    mockSyncCollectionOptions<User>({
      id,
      getKey: (user) => user.id,
      initialData: [
        { id: 1, name: `Alice` },
        { id: 2, name: `Bob` },
        { id: 4, name: `Unmatched` },
      ],
    }),
  )
}

function createCollectionWithLoadSubsetTracking<T extends object>(
  id: string,
  getKey: (row: T) => string | number,
  initialData: Array<T>,
) {
  const loadSubsetCalls: Array<LoadSubsetOptions> = []

  const collection = createCollection<T>({
    id,
    getKey,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const row of initialData) {
          write({ type: `insert`, value: row })
        }
        commit()
        markReady()

        return {
          loadSubset: (options: LoadSubsetOptions) => {
            loadSubsetCalls.push(options)
            return Promise.resolve()
          },
        }
      },
    },
  })

  return { collection, loadSubsetCalls }
}

function createUsersCollectionWithLoadSubsetTracking(id: string) {
  return createCollectionWithLoadSubsetTracking<User>(
    id,
    (user) => user.id,
    [
      { id: 1, name: `Alice` },
      { id: 2, name: `Bob` },
      { id: 4, name: `Unmatched` },
    ],
  )
}

function stripVirtualPropsDeep(value: any): any {
  if (Array.isArray(value)) {
    return value.map((entry) => stripVirtualPropsDeep(entry))
  }
  if (value && typeof value === `object`) {
    const out: Record<string, any> = {}
    for (const [key, entry] of Object.entries(stripVirtualProps(value))) {
      out[key] = stripVirtualPropsDeep(entry)
    }
    return out
  }
  return value
}

function childRows(collection: any): Array<any> {
  return [...collection.toArray].map((row) => stripVirtualPropsDeep(row))
}

describe(`multi-source from`, () => {
  it(`combines multiple sources into exclusive namespaced rows`, async () => {
    const messages = createMessagesCollection(`multi-source-messages-basic`)
    const toolCalls = createToolCallsCollection(`multi-source-tools-basic`)

    const collection = createLiveQueryCollection((q) =>
      q.from({
        message: messages,
        toolCall: toolCalls,
      }),
    )

    await collection.preload()

    expect(collection.size).toBe(4)
    expect(collection.toArray.map(stripVirtualProps)).toEqual(
      expect.arrayContaining([
        { message: expect.objectContaining({ id: 1, text: `hello` }) },
        { message: expect.objectContaining({ id: 2, text: `secret` }) },
        { toolCall: expect.objectContaining({ id: 1, name: `search` }) },
        { toolCall: expect.objectContaining({ id: 3, name: `write` }) },
      ]),
    )
  })

  it(`namespaces result keys across sources with overlapping source keys`, async () => {
    const messages = createMessagesCollection(`multi-source-messages-keys`)
    const toolCalls = createToolCallsCollection(`multi-source-tools-keys`)

    const collection = createLiveQueryCollection((q) =>
      q.from({
        message: messages,
        toolCall: toolCalls,
      }),
    )

    await collection.preload()

    const rowsWithKeyOne = collection.toArray.filter((row: any) => {
      return row.message?.id === 1 || row.toolCall?.id === 1
    })
    expect(rowsWithKeyOne).toHaveLength(2)
  })

  it(`orders across branches with a combined expression`, async () => {
    const messages = createMessagesCollection(`multi-source-messages-order`)
    const toolCalls = createToolCallsCollection(`multi-source-tools-order`)

    const collection = createLiveQueryCollection((q) =>
      q
        .from({
          message: messages,
          toolCall: toolCalls,
        })
        .orderBy(({ message, toolCall }) =>
          coalesce(message.timestamp, toolCall.timestamp),
        ),
    )

    await collection.preload()

    expect(
      collection.toArray.map((row: any) =>
        row.message ? `message:${row.message.id}` : `tool:${row.toolCall.id}`,
      ),
    ).toEqual([`message:1`, `tool:1`, `message:2`, `tool:3`])
  })

  it(`uses the first source collation when ordering mixed string branches`, async () => {
    const messages = createCollection(
      mockSyncCollectionOptions<LabelRow>({
        id: `multi-source-messages-string-collation`,
        getKey: (row) => row.id,
        initialData: [{ id: 1, label: `Charlie` }],
        defaultStringCollation: {
          stringSort: `lexical`,
        },
      }),
    )
    const toolCalls = createCollection(
      mockSyncCollectionOptions<LabelRow>({
        id: `multi-source-tools-string-collation`,
        getKey: (row) => row.id,
        initialData: [
          { id: 1, label: `alice` },
          { id: 2, label: `bob` },
        ],
        defaultStringCollation: {
          stringSort: `locale`,
        },
      }),
    )

    const collection = createLiveQueryCollection((q) =>
      q
        .from({
          message: messages,
          toolCall: toolCalls,
        })
        .select(({ message, toolCall }) => ({
          label: coalesce(message.label, toolCall.label),
        }))
        .orderBy(({ $selected }) => $selected.label),
    )

    await collection.preload()

    expect(collection.toArray.map((row) => row.label)).toEqual([
      `Charlie`,
      `alice`,
      `bob`,
    ])
  })

  it(`keeps where semantics global after union`, async () => {
    const messages = createMessagesCollection(`multi-source-messages-where`)
    const toolCalls = createToolCallsCollection(`multi-source-tools-where`)

    const collection = createLiveQueryCollection((q) =>
      q
        .from({
          message: messages,
          toolCall: toolCalls,
        })
        .where(({ message }) => eq(message.kind, `visible`)),
    )

    await collection.preload()

    expect(collection.toArray.map(stripVirtualProps)).toEqual([
      { message: expect.objectContaining({ id: 1, kind: `visible` }) },
    ])
  })

  it(`supports subquery branches for per-source filtering`, async () => {
    const messages = createMessagesCollection(`multi-source-messages-subquery`)
    const toolCalls = createToolCallsCollection(`multi-source-tools-subquery`)

    const collection = createLiveQueryCollection((q) => {
      const visibleMessages = q
        .from({ message: messages })
        .where(({ message }) => eq(message.kind, `visible`))

      return q
        .from({
          message: visibleMessages,
          toolCall: toolCalls,
        })
        .orderBy(({ message, toolCall }) =>
          coalesce(message.timestamp, toolCall.timestamp),
        )
    })

    await collection.preload()

    expect(
      collection.toArray.map((row: any) =>
        row.message ? `message:${row.message.id}` : `tool:${row.toolCall.id}`,
      ),
    ).toEqual([`message:1`, `tool:1`, `tool:3`])
  })

  it(`supports subquery branches with joins and projections`, async () => {
    const messages = createMessagesCollection(
      `multi-source-messages-subquery-join`,
    )
    const toolCalls = createToolCallsCollection(
      `multi-source-tools-subquery-join`,
    )
    const users = createUsersCollection(`multi-source-users-subquery-join`)

    const collection = createLiveQueryCollection((q) => {
      const visibleMessagesWithUsers = q
        .from({ message: messages })
        .join(
          { user: users },
          ({ message, user }) => eq(message.userId, user.id),
          `inner`,
        )
        .where(({ message }) => eq(message.kind, `visible`))
        .select(({ message, user }) => ({
          id: message.id,
          text: message.text,
          timestamp: message.timestamp,
          userName: user.name,
        }))

      return q
        .from({
          message: visibleMessagesWithUsers,
          toolCall: toolCalls,
        })
        .orderBy(({ message, toolCall }) =>
          coalesce(message.timestamp, toolCall.timestamp),
        )
    })

    await collection.preload()

    expect(collection.toArray.map((row) => stripVirtualPropsDeep(row))).toEqual([
      {
        message: {
          id: 1,
          text: `hello`,
          timestamp: 10,
          userName: `Alice`,
        },
      },
      {
        toolCall: expect.objectContaining({ id: 1, name: `search` }),
      },
      {
        toolCall: expect.objectContaining({ id: 3, name: `write` }),
      },
    ])
  })

  it(`supports joins after multi-source from with branch-dependent keys`, async () => {
    const messages = createMessagesCollection(`multi-source-messages-join`)
    const toolCalls = createToolCallsCollection(`multi-source-tools-join`)
    const users = createUsersCollection(`multi-source-users-join`)

    const collection = createLiveQueryCollection((q) =>
      q
        .from({
          message: messages,
          toolCall: toolCalls,
        })
        .join(
          { user: users },
          ({ message, toolCall, user }) =>
            eq(coalesce(message.userId, toolCall.userId), user.id),
          `inner`,
        )
        .select(({ message, toolCall, user }) => ({
          messageId: message.id,
          toolCallId: toolCall.id,
          userName: user.name,
          timestamp: coalesce(message.timestamp, toolCall.timestamp),
        }))
        .orderBy(({ message, toolCall }) =>
          coalesce(message.timestamp, toolCall.timestamp),
        ),
    )

    await collection.preload()

    expect(collection.toArray.map((row) => stripVirtualProps(row))).toEqual([
      { messageId: 1, toolCallId: undefined, userName: `Alice`, timestamp: 10 },
      { messageId: undefined, toolCallId: 1, userName: `Alice`, timestamp: 20 },
      { messageId: 2, toolCallId: undefined, userName: `Bob`, timestamp: 30 },
    ])
  })

  it(`supports right joins after multi-source from`, async () => {
    const messages = createMessagesCollection(`multi-source-messages-right-join`)
    const toolCalls = createToolCallsCollection(`multi-source-tools-right-join`)
    const users = createUsersCollection(`multi-source-users-right-join`)

    const collection = createLiveQueryCollection((q) =>
      q
        .from({
          message: messages,
          toolCall: toolCalls,
        })
        .rightJoin(
          { user: users },
          ({ message, toolCall, user }) =>
            eq(coalesce(message.userId, toolCall.userId), user.id),
        )
        .orderBy(({ user }) => user.id),
    )

    await collection.preload()

    expect(collection.toArray.map((row) => stripVirtualPropsDeep(row))).toEqual([
      {
        message: expect.objectContaining({ id: 1 }),
        user: expect.objectContaining({ id: 1, name: `Alice` }),
      },
      {
        toolCall: expect.objectContaining({ id: 1 }),
        user: expect.objectContaining({ id: 1, name: `Alice` }),
      },
      {
        message: expect.objectContaining({ id: 2 }),
        user: expect.objectContaining({ id: 2, name: `Bob` }),
      },
      {
        user: expect.objectContaining({ id: 4, name: `Unmatched` }),
      },
    ])
  })

  it(`supports full joins after multi-source from`, async () => {
    const messages = createMessagesCollection(`multi-source-messages-full-join`)
    const toolCalls = createToolCallsCollection(`multi-source-tools-full-join`)
    const users = createUsersCollection(`multi-source-users-full-join`)

    const collection = createLiveQueryCollection((q) =>
      q
        .from({
          message: messages,
          toolCall: toolCalls,
        })
        .fullJoin(
          { user: users },
          ({ message, toolCall, user }) =>
            eq(coalesce(message.userId, toolCall.userId), user.id),
        )
        .orderBy(({ message, toolCall, user }) =>
          coalesce(message.timestamp, toolCall.timestamp, user.id),
        ),
    )

    await collection.preload()

    expect(collection.toArray.map((row) => stripVirtualPropsDeep(row))).toEqual([
      {
        user: expect.objectContaining({ id: 4, name: `Unmatched` }),
      },
      {
        message: expect.objectContaining({ id: 1 }),
        user: expect.objectContaining({ id: 1, name: `Alice` }),
      },
      {
        toolCall: expect.objectContaining({ id: 1 }),
        user: expect.objectContaining({ id: 1, name: `Alice` }),
      },
      {
        message: expect.objectContaining({ id: 2 }),
        user: expect.objectContaining({ id: 2, name: `Bob` }),
      },
      {
        toolCall: expect.objectContaining({ id: 3 }),
      },
    ])
  })

  it(`does not lazy-load branch-dependent joins after multi-source from`, async () => {
    const messages = createMessagesCollection(`multi-source-messages-no-lazy`)
    const toolCalls = createToolCallsCollection(`multi-source-tools-no-lazy`)
    const { collection: users, loadSubsetCalls } =
      createUsersCollectionWithLoadSubsetTracking(`multi-source-users-no-lazy`)

    const collection = createLiveQueryCollection((q) =>
      q
        .from({
          message: messages,
          toolCall: toolCalls,
        })
        .join(
          { user: users },
          ({ message, toolCall, user }) =>
            eq(coalesce(message.userId, toolCall.userId), user.id),
          `inner`,
        )
        .select(({ message, toolCall, user }) => ({
          id: coalesce(message.id, toolCall.id),
          userName: user.name,
        })),
    )

    await collection.preload()

    expect(collection.size).toBe(3)
    expect(loadSubsetCalls.every((call) => call.where === undefined)).toBe(true)
  })

  it(`lazy-loads each branch when joining to a multi-source subquery`, async () => {
    const { collection: messages, loadSubsetCalls: messageLoadSubsetCalls } =
      createCollectionWithLoadSubsetTracking<Message>(
        `multi-source-messages-lazy-subquery-join`,
        (message) => message.id,
        messagesData,
      )
    const { collection: toolCalls, loadSubsetCalls: toolLoadSubsetCalls } =
      createCollectionWithLoadSubsetTracking<ToolCall>(
        `multi-source-tools-lazy-subquery-join`,
        (toolCall) => toolCall.id,
        toolCallsData,
      )
    const users = createUsersCollection(`multi-source-users-lazy-subquery-join`)

    const collection = createLiveQueryCollection((q) => {
      const events = q
        .from({
          message: messages,
          toolCall: toolCalls,
        })
        .select(({ message, toolCall }) => ({
          userId: coalesce(message.userId, toolCall.userId),
          timestamp: coalesce(message.timestamp, toolCall.timestamp),
        }))

      return q
        .from({ user: users })
        .leftJoin({ event: events }, ({ user, event }) =>
          eq(user.id, event.userId),
        )
        .select(({ user, event }) => ({
          userId: user.id,
          eventTimestamp: event.timestamp,
        }))
        .orderBy(({ user, event }) => coalesce(event.timestamp, user.id))
    })

    await collection.preload()

    expect(collection.toArray.map((row) => stripVirtualProps(row))).toEqual([
      { userId: 4, eventTimestamp: undefined },
      { userId: 1, eventTimestamp: 10 },
      { userId: 1, eventTimestamp: 20 },
      { userId: 2, eventTimestamp: 30 },
    ])
    expect(messageLoadSubsetCalls.length).toBeGreaterThan(0)
    expect(toolLoadSubsetCalls.length).toBeGreaterThan(0)
    expect(messageLoadSubsetCalls.every((call) => call.where)).toBe(true)
    expect(toolLoadSubsetCalls.every((call) => call.where)).toBe(true)
  })

  it(`does not lazy-load computed multi-source subquery join projections`, async () => {
    const { collection: messages, loadSubsetCalls: messageLoadSubsetCalls } =
      createCollectionWithLoadSubsetTracking<Message>(
        `multi-source-messages-computed-lazy-subquery-join`,
        (message) => message.id,
        messagesData,
      )
    const { collection: toolCalls, loadSubsetCalls: toolLoadSubsetCalls } =
      createCollectionWithLoadSubsetTracking<ToolCall>(
        `multi-source-tools-computed-lazy-subquery-join`,
        (toolCall) => toolCall.id,
        toolCallsData,
      )
    const users = createUsersCollection(
      `multi-source-users-computed-lazy-subquery-join`,
    )

    const collection = createLiveQueryCollection((q) => {
      const events = q
        .from({
          message: messages,
          toolCall: toolCalls,
        })
        .select(({ message, toolCall }) => ({
          label: concat(coalesce(message.text, toolCall.name), `!`),
        }))

      return q
        .from({ user: users })
        .leftJoin({ event: events }, ({ user, event }) =>
          eq(user.name, event.label),
        )
        .select(({ user, event }) => ({
          userId: user.id,
          label: event.label,
        }))
    })

    await collection.preload()

    expect(collection.size).toBe(3)
    expect(messageLoadSubsetCalls.length).toBeGreaterThan(0)
    expect(toolLoadSubsetCalls.length).toBeGreaterThan(0)
    expect(messageLoadSubsetCalls.every((call) => call.where === undefined)).toBe(
      true,
    )
    expect(toolLoadSubsetCalls.every((call) => call.where === undefined)).toBe(
      true,
    )
  })

  it(`does not lazy-load limited multi-source subquery branches`, async () => {
    const { collection: messages, loadSubsetCalls: messageLoadSubsetCalls } =
      createCollectionWithLoadSubsetTracking<Message>(
        `multi-source-messages-limited-lazy-subquery-join`,
        (message) => message.id,
        messagesData,
      )
    const { collection: toolCalls, loadSubsetCalls: toolLoadSubsetCalls } =
      createCollectionWithLoadSubsetTracking<ToolCall>(
        `multi-source-tools-limited-lazy-subquery-join`,
        (toolCall) => toolCall.id,
        toolCallsData,
      )
    const users = createUsersCollection(`multi-source-users-limited-subquery-join`)

    const collection = createLiveQueryCollection((q) => {
      const firstMessage = q
        .from({ message: messages })
        .orderBy(({ message }) => message.timestamp)
        .limit(1)

      const events = q
        .from({
          message: firstMessage,
          toolCall: toolCalls,
        })
        .select(({ message, toolCall }) => ({
          userId: coalesce(message.userId, toolCall.userId),
          timestamp: coalesce(message.timestamp, toolCall.timestamp),
        }))

      return q
        .from({ user: users })
        .leftJoin({ event: events }, ({ user, event }) =>
          eq(user.id, event.userId),
        )
        .select(({ user, event }) => ({
          userId: user.id,
          eventTimestamp: event.timestamp,
        }))
    })

    await collection.preload()

    expect(collection.size).toBe(4)
    expect(messageLoadSubsetCalls.length).toBeGreaterThan(0)
    expect(toolLoadSubsetCalls.length).toBeGreaterThan(0)
    expect(messageLoadSubsetCalls.every((call) => call.where === undefined)).toBe(
      true,
    )
    expect(toolLoadSubsetCalls.some((call) => call.where)).toBe(true)
  })

  it(`supports distinct over selected multi-source rows`, async () => {
    const messages = createMessagesCollection(`multi-source-messages-distinct`)
    const toolCalls = createToolCallsCollection(`multi-source-tools-distinct`)

    const collection = createLiveQueryCollection((q) =>
      q
        .from({
          message: messages,
          toolCall: toolCalls,
        })
        .select(({ message, toolCall }) => ({
          id: coalesce(message.id, toolCall.id),
        }))
        .distinct()
        .orderBy(({ $selected }) => $selected.id),
    )

    await collection.preload()

    expect(collection.toArray.map((row) => stripVirtualProps(row))).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
    ])
  })

  it(`reacts to insert, update, and delete changes from each branch`, async () => {
    const messages = createMessagesCollection(`multi-source-messages-live`)
    const toolCalls = createToolCallsCollection(`multi-source-tools-live`)

    const collection = createLiveQueryCollection((q) =>
      q
        .from({
          message: messages,
          toolCall: toolCalls,
        })
        .orderBy(({ message, toolCall }) =>
          coalesce(message.timestamp, toolCall.timestamp),
        ),
    )

    await collection.preload()
    expect(collection.size).toBe(4)

    messages.insert({
      id: 4,
      text: `new`,
      kind: `visible`,
      timestamp: 50,
      userId: 1,
    })
    toolCalls.insert({ id: 5, name: `read`, timestamp: 60, userId: 2 })
    await flushPromises()
    expect(collection.size).toBe(6)

    toolCalls.update(3, (draft) => {
      draft.name = `updated`
    })
    await flushPromises()
    expect(
      collection.toArray.some((row: any) => row.toolCall?.name === `updated`),
    ).toBe(true)

    messages.delete(2)
    toolCalls.delete(1)
    await flushPromises()
    expect(collection.size).toBe(4)
    expect(
      collection.toArray.some(
        (row: any) => row.message?.id === 2 || row.toolCall?.id === 1,
      ),
    ).toBe(false)
  })

  it(`rejects multiple sources in one join call`, () => {
    const messages = createMessagesCollection(`multi-source-messages-join-error`)
    const toolCalls = createToolCallsCollection(`multi-source-tools-join-error`)
    const users = createUsersCollection(`multi-source-users-join-error`)

    expect(() =>
      createLiveQueryCollection((q) =>
        q.from({ message: messages }).join(
          { toolCall: toolCalls, user: users },
          ({ message, toolCall }) => eq(message.id, toolCall.id),
        ),
      ),
    ).toThrow(OnlyOneSourceAllowedError)
  })

  it(`materializes guarded includes only for matching union branches`, async () => {
    const messages = createMessagesCollection(`multi-source-messages-includes`)
    const toolCalls = createToolCallsCollection(`multi-source-tools-includes`)
    const chunks = createChunksCollection(`multi-source-chunks-includes`)

    const collection = createLiveQueryCollection((q) =>
      q
        .from({
          message: messages,
          toolCall: toolCalls,
        })
        .select(({ message, toolCall }) => ({
          message: caseWhen(message.id, {
            id: message.id,
            text: message.text,
            chunks: toArray(
              q
                .from({ chunk: chunks })
                .where(({ chunk }) => eq(chunk.messageId, message.id))
                .orderBy(({ chunk }) => chunk.id)
                .select(({ chunk }) => chunk.text),
            ),
          }),
          toolCall: caseWhen(toolCall.id, {
            id: toolCall.id,
            name: toolCall.name,
          }),
          timestamp: coalesce(message.timestamp, toolCall.timestamp),
        }))
        .orderBy(({ message, toolCall }) =>
          coalesce(message.timestamp, toolCall.timestamp),
        ),
    )

    await collection.preload()

    expect(collection.toArray.map((row) => stripVirtualPropsDeep(row))).toEqual([
      {
        message: { id: 1, text: `hello`, chunks: [`hello`, `world`] },
        toolCall: undefined,
        timestamp: 10,
      },
      {
        message: undefined,
        toolCall: { id: 1, name: `search` },
        timestamp: 20,
      },
      {
        message: { id: 2, text: `secret`, chunks: [`hidden`] },
        toolCall: undefined,
        timestamp: 30,
      },
      {
        message: undefined,
        toolCall: { id: 3, name: `write` },
        timestamp: 40,
      },
    ])
  })

  it(`materializes correlated collection includes from multi-source subquery children`, async () => {
    const { collection: messages, loadSubsetCalls: messageLoadSubsetCalls } =
      createCollectionWithLoadSubsetTracking<Message>(
        `multi-source-messages-collection-includes`,
        (message) => message.id,
        messagesData,
      )
    const { collection: toolCalls, loadSubsetCalls: toolLoadSubsetCalls } =
      createCollectionWithLoadSubsetTracking<ToolCall>(
        `multi-source-tools-collection-includes`,
        (toolCall) => toolCall.id,
        toolCallsData,
      )
    const users = createUsersCollection(`multi-source-users-collection-includes`)

    const collection = createLiveQueryCollection((q) => {
      const events = q
        .from({
          message: messages,
          toolCall: toolCalls,
        })
        .select(({ message, toolCall }) => ({
          userId: coalesce(message.userId, toolCall.userId),
          timestamp: coalesce(message.timestamp, toolCall.timestamp),
          label: coalesce(message.text, toolCall.name),
        }))

      return q
        .from({ user: users })
        .select(({ user }) => ({
          id: user.id,
          profile: caseWhen(user.id, {
            id: user.id,
            items: q
              .from({ item: events })
              .where(({ item }) => eq(item.userId, user.id))
              .orderBy(({ item }) => item.timestamp)
              .select(({ item }) => ({
                label: item.label,
                timestamp: item.timestamp,
              })),
          }),
        }))
        .orderBy(({ user }) => user.id)
    })

    await collection.preload()

    const rows = collection.toArray
    expect(childRows(rows[0]!.profile.items)).toEqual([
      { label: `hello`, timestamp: 10 },
      { label: `search`, timestamp: 20 },
    ])
    expect(childRows(rows[1]!.profile.items)).toEqual([
      { label: `secret`, timestamp: 30 },
    ])
    expect(childRows(rows[2]!.profile.items)).toEqual([])
    expect(messageLoadSubsetCalls.some((call) => call.where)).toBe(true)
    expect(toolLoadSubsetCalls.some((call) => call.where)).toBe(true)

    users.insert({ id: 3, name: `Cara` })
    await flushPromises()

    const inserted = collection.toArray.find((row) => row.id === 3)!
    expect(childRows(inserted.profile.items)).toEqual([
      { label: `write`, timestamp: 40 },
    ])
  })
})
