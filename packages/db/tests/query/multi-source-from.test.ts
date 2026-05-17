import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import {
  caseWhen,
  coalesce,
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
})
