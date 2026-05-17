import { describe, expectTypeOf, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import {
  coalesce,
  createLiveQueryCollection,
} from '../../src/query/index.js'
import { mockSyncCollectionOptions } from '../utils.js'
import type { OutputWithVirtual } from '../utils.js'

type Message = {
  id: number
  text: string
  timestamp: number
}

type ToolCall = {
  id: number
  name: string
  timestamp: number
}

type MessageRow = OutputWithVirtual<Message>
type ToolCallRow = OutputWithVirtual<ToolCall>

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
})
