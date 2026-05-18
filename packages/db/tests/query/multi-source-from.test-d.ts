import { describe, expectTypeOf, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import {
  coalesce,
  createLiveQueryCollection,
  eq,
} from '../../src/query/index.js'
import { mockSyncCollectionOptions } from '../utils.js'
import type { OutputWithVirtual } from '../utils.js'

type Message = {
  id: number
  text: string
  timestamp: number
  userId: number
}

type ToolCall = {
  id: number
  name: string
  timestamp: number
  userId: number
}

type User = {
  id: number
  name: string
}

type MessageRow = OutputWithVirtual<Message>
type ToolCallRow = OutputWithVirtual<ToolCall>
type UserRow = OutputWithVirtual<User>

function createMessages() {
  return createCollection(
    mockSyncCollectionOptions<Message>({
      id: `multi-source-type-messages`,
      getKey: (message) => message.id,
      initialData: [],
    }),
  )
}

function createToolCalls() {
  return createCollection(
    mockSyncCollectionOptions<ToolCall>({
      id: `multi-source-type-tools`,
      getKey: (toolCall) => toolCall.id,
      initialData: [],
    }),
  )
}

function createUsers() {
  return createCollection(
    mockSyncCollectionOptions<User>({
      id: `multi-source-type-users`,
      getKey: (user) => user.id,
      initialData: [],
    }),
  )
}

describe(`multi-source from types`, () => {
  test(`no select returns an exclusive union`, () => {
    const messages = createMessages()
    const toolCalls = createToolCalls()

    const collection = createLiveQueryCollection((q) =>
      q.from({
        message: messages,
        toolCall: toolCalls,
      }),
    )

    expectTypeOf(collection.toArray).toMatchTypeOf<
      Array<
        OutputWithVirtual<
          | { message: MessageRow; toolCall?: undefined }
          | { message?: undefined; toolCall: ToolCallRow }
        >
      >
    >()
  })

  test(`orderBy preserves the exclusive union result`, () => {
    const messages = createMessages()
    const toolCalls = createToolCalls()

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

    expectTypeOf(collection.toArray).toMatchTypeOf<
      Array<
        OutputWithVirtual<
          | { message: MessageRow; toolCall?: undefined }
          | { message?: undefined; toolCall: ToolCallRow }
        >
      >
    >()
  })

  test(`select returns the selected object type`, () => {
    const messages = createMessages()
    const toolCalls = createToolCalls()

    const collection = createLiveQueryCollection((q) =>
      q
        .from({
          message: messages,
          toolCall: toolCalls,
        })
        .select(({ message, toolCall }) => ({
          messageText: message.text,
          toolCallName: toolCall.name,
          timestamp: coalesce(message.timestamp, toolCall.timestamp),
        })),
    )

    const row = collection.toArray[0]!
    const messageCanBeUndefined: typeof row.messageText = undefined
    const toolCallCanBeUndefined: typeof row.toolCallName = undefined
    expectTypeOf(row.messageText).toMatchTypeOf<string | undefined>()
    expectTypeOf(row.toolCallName).toMatchTypeOf<string | undefined>()
    expectTypeOf(row.timestamp).toEqualTypeOf<number>()
    expectTypeOf(messageCanBeUndefined).toEqualTypeOf<undefined>()
    expectTypeOf(toolCallCanBeUndefined).toEqualTypeOf<undefined>()
  })

  test(`subquery source branches preserve joined projection types`, () => {
    const messages = createMessages()
    const toolCalls = createToolCalls()
    const users = createUsers()

    const collection = createLiveQueryCollection((q) => {
      const messagesWithUsers = q
        .from({ message: messages })
        .join(
          { user: users },
          ({ message, user }) => eq(message.userId, user.id),
          `inner`,
        )
        .select(({ message, user }) => ({
          id: message.id,
          timestamp: message.timestamp,
          userName: user.name,
        }))

      return q.from({
        message: messagesWithUsers,
        toolCall: toolCalls,
      })
    })

    expectTypeOf(collection.toArray).toMatchTypeOf<
      Array<
        OutputWithVirtual<
          | {
              message: OutputWithVirtual<{
                id: number
                timestamp: number
                userName: string
              }>
              toolCall?: undefined
            }
          | {
              message?: undefined
              toolCall: ToolCallRow
            }
        >
      >
    >()
  })

  test(`no-select left joins include joined aliases in each union branch`, () => {
    const messages = createMessages()
    const toolCalls = createToolCalls()
    const users = createUsers()

    const collection = createLiveQueryCollection((q) =>
      q
        .from({
          message: messages,
          toolCall: toolCalls,
        })
        .leftJoin({ user: users }, ({ message, toolCall, user }) =>
          eq(coalesce(message.userId, toolCall.userId), user.id),
        ),
    )

    expectTypeOf(collection.toArray).toMatchTypeOf<
      Array<
        OutputWithVirtual<
          | {
              message: MessageRow
              toolCall?: undefined
              user: UserRow | undefined
            }
          | {
              message?: undefined
              toolCall: ToolCallRow
              user: UserRow | undefined
            }
        >
      >
    >()
  })

  test(`right joins allow rows with only the joined side`, () => {
    const messages = createMessages()
    const toolCalls = createToolCalls()
    const users = createUsers()

    const collection = createLiveQueryCollection((q) =>
      q
        .from({
          message: messages,
          toolCall: toolCalls,
        })
        .rightJoin({ user: users }, ({ message, toolCall, user }) =>
          eq(coalesce(message.userId, toolCall.userId), user.id),
        ),
    )

    expectTypeOf(collection.toArray).toMatchTypeOf<
      Array<
        OutputWithVirtual<
          | { message: MessageRow; toolCall?: undefined; user: UserRow }
          | { message?: undefined; toolCall: ToolCallRow; user: UserRow }
          | { message?: undefined; toolCall?: undefined; user: UserRow }
        >
      >
    >()
  })

  test(`full joins apply left-side optionality to all union branches`, () => {
    const messages = createMessages()
    const toolCalls = createToolCalls()
    const users = createUsers()

    const collection = createLiveQueryCollection((q) =>
      q
        .from({
          message: messages,
          toolCall: toolCalls,
        })
        .fullJoin({ user: users }, ({ message, toolCall, user }) =>
          eq(coalesce(message.userId, toolCall.userId), user.id),
        ),
    )

    expectTypeOf(collection.toArray).toMatchTypeOf<
      Array<
        OutputWithVirtual<
          | {
              message: MessageRow
              toolCall?: undefined
              user: UserRow | undefined
            }
          | {
              message?: undefined
              toolCall: ToolCallRow
              user: UserRow | undefined
            }
          | {
              message?: undefined
              toolCall?: undefined
              user: UserRow | undefined
            }
        >
      >
    >()
  })
})
