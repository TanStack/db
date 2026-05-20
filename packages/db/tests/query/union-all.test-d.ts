import { describe, expectTypeOf, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import {
  coalesce,
  count,
  createLiveQueryCollection,
  eq,
  gt,
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

describe(`unionAll types`, () => {
  test(`from rejects multiple sources`, () => {
    const messages = createMessages()
    const toolCalls = createToolCalls()

    createLiveQueryCollection((q) =>
      // @ts-expect-error Use unionAll() to combine multiple independent sources.
      q.from({
        message: messages,
        toolCall: toolCalls,
      }),
    )
  })

  test(`unionAll is only available as a start method`, () => {
    const messages = createMessages()
    const toolCalls = createToolCalls()

    createLiveQueryCollection((q) =>
      q
        .from({ message: messages })
        // @ts-expect-error unionAll is a start method, like from().
        .unionAll({ toolCall: toolCalls }),
    )
  })

  test(`no select returns an exclusive union`, () => {
    const messages = createMessages()
    const toolCalls = createToolCalls()

    const collection = createLiveQueryCollection((q) =>
      q.unionAll({
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
        .unionAll({
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
        .unionAll({
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

  test(`query branches return a union of branch result rows`, () => {
    const messages = createMessages()
    const toolCalls = createToolCalls()

    const collection = createLiveQueryCollection((q) => {
      const messageRows = q
        .from({ message: messages })
        .select(({ message }) => ({
          type: `message` as const,
          id: message.id,
          body: message.text,
          timestamp: message.timestamp,
        }))
      const toolCallRows = q
        .from({ toolCall: toolCalls })
        .select(({ toolCall }) => ({
          type: `toolCall` as const,
          id: toolCall.id,
          body: toolCall.name,
          timestamp: toolCall.timestamp,
        }))

      return q
        .unionAll(messageRows, toolCallRows)
        .orderBy(({ timestamp }) => timestamp)
    })

    expectTypeOf(collection.toArray).toMatchTypeOf<
      Array<
        OutputWithVirtual<
          | {
              type: `message`
              id: number
              body: string
              timestamp: number
            }
          | {
              type: `toolCall`
              id: number
              body: string
              timestamp: number
            }
        >
      >
    >()
  })

  test(`query branches support methods after unionAll`, () => {
    const messages = createMessages()
    const toolCalls = createToolCalls()

    const collection = createLiveQueryCollection((q) => {
      const messageRows = q
        .from({ message: messages })
        .select(({ message }) => ({
          kind: `message` as const,
          id: message.id,
          timestamp: message.timestamp,
        }))
      const toolCallRows = q
        .from({ toolCall: toolCalls })
        .select(({ toolCall }) => ({
          kind: `toolCall` as const,
          id: toolCall.id,
          timestamp: toolCall.timestamp,
        }))

      return q
        .unionAll(messageRows, toolCallRows)
        .where(({ id }) => gt(id, 0))
        .orderBy(({ timestamp }) => timestamp)
        .limit(10)
    })

    expectTypeOf(collection.toArray).toMatchTypeOf<
      Array<
        OutputWithVirtual<
          | {
              kind: `message`
              id: number
              timestamp: number
            }
          | {
              kind: `toolCall`
              id: number
              timestamp: number
            }
        >
      >
    >()
  })

  test(`query branches support groupBy and having after unionAll`, () => {
    const messages = createMessages()
    const toolCalls = createToolCalls()

    const collection = createLiveQueryCollection((q) => {
      const messageRows = q
        .from({ message: messages })
        .select(() => ({ kind: `event` as const }))
      const toolCallRows = q
        .from({ toolCall: toolCalls })
        .select(() => ({ kind: `event` as const }))

      return q
        .unionAll(messageRows, toolCallRows)
        .groupBy(({ kind }) => kind)
        .select(({ kind }) => ({
          kind,
          rowCount: count(kind),
        }))
        .having(({ kind }) => gt(count(kind), 0))
    })

    const row = collection.toArray[0]!
    expectTypeOf(row.rowCount).toEqualTypeOf<number>()
  })

  test(`query branches support typed joins after unionAll`, () => {
    const messages = createMessages()
    const toolCalls = createToolCalls()
    const users = createUsers()

    const collection = createLiveQueryCollection((q) => {
      const messageRows = q
        .from({ message: messages })
        .select(({ message }) => ({
          kind: `message` as const,
          id: message.id,
          userId: message.userId,
        }))
      const toolCallRows = q
        .from({ toolCall: toolCalls })
        .select(({ toolCall }) => ({
          kind: `toolCall` as const,
          id: toolCall.id,
          userId: toolCall.userId,
        }))

      return q
        .unionAll(messageRows, toolCallRows)
        .join(
          { user: users },
          ({ userId, user }) => eq(userId, user.id),
          `inner`,
        )
        .select(({ kind, id, user }) => ({
          kind,
          id,
          userName: user.name,
        }))
    })

    expectTypeOf(collection.toArray).toMatchTypeOf<
      Array<
        OutputWithVirtual<
          | {
              kind: `message`
              id: number
              userName: string
            }
          | {
              kind: `toolCall`
              id: number
              userName: string
            }
        >
      >
    >()
  })

  test(`query branches keep joined namespaces when not selected`, () => {
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
      const toolCallRows = q.from({ toolCall: toolCalls })

      return q.unionAll(messagesWithUsers, toolCallRows)
    })

    expectTypeOf(collection.toArray).toMatchTypeOf<
      Array<
        OutputWithVirtual<
          | {
              message: MessageRow
              user: UserRow
            }
          | ToolCallRow
        >
      >
    >()
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

      return q.unionAll({
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
        .unionAll({
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
        .unionAll({
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
        .unionAll({
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
