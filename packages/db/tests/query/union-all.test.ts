import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import {
  caseWhen,
  coalesce,
  concat,
  count,
  createLiveQueryCollection,
  eq,
  gt,
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

type RunRow = {
  key: string
  order: string
  status: string
}

type TextRow = {
  key: string
  runId: string
  order: string
  status: string
}

type ToolCallRow = {
  key: string
  runId: string
  order: string
  name: string
  status: string
}

type TextDeltaRow = {
  key: string
  textId: string
  order: string
  delta: string
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
  return createCollectionWithLoadSubsetTracking<User>(id, (user) => user.id, [
    { id: 1, name: `Alice` },
    { id: 2, name: `Bob` },
    { id: 4, name: `Unmatched` },
  ])
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

describe(`unionAll`, () => {
  it(`combines query branches into result rows with branch-prefixed keys`, async () => {
    const messages = createMessagesCollection(`union-all-query-messages-basic`)
    const toolCalls = createToolCallsCollection(`union-all-query-tools-basic`)

    const collection = createLiveQueryCollection((q) => {
      const messageRows = q
        .from({ message: messages })
        .select(({ message }) => ({
          kind: `message` as const,
          id: message.id,
          body: message.text,
          timestamp: message.timestamp,
        }))
      const toolCallRows = q
        .from({ toolCall: toolCalls })
        .select(({ toolCall }) => ({
          kind: `toolCall` as const,
          id: toolCall.id,
          body: toolCall.name,
          timestamp: toolCall.timestamp,
        }))

      return q.unionAll(messageRows, toolCallRows).orderBy(({ timestamp }) => timestamp)
    })

    await collection.preload()

    expect(collection.size).toBe(4)
    expect(collection.toArray.map(stripVirtualProps)).toEqual([
      { kind: `message`, id: 1, body: `hello`, timestamp: 10 },
      { kind: `toolCall`, id: 1, body: `search`, timestamp: 20 },
      { kind: `message`, id: 2, body: `secret`, timestamp: 30 },
      { kind: `toolCall`, id: 3, body: `write`, timestamp: 40 },
    ])
  })

  it(`supports where and select after query branch unionAll`, async () => {
    const messages = createMessagesCollection(`union-all-query-messages-where`)
    const toolCalls = createToolCallsCollection(`union-all-query-tools-where`)

    const collection = createLiveQueryCollection((q) => {
      const messageRows = q
        .from({ message: messages })
        .select(({ message }) => ({
          kind: `message` as const,
          id: message.id,
          body: message.text,
          timestamp: message.timestamp,
        }))
      const toolCallRows = q
        .from({ toolCall: toolCalls })
        .select(({ toolCall }) => ({
          kind: `toolCall` as const,
          id: toolCall.id,
          body: toolCall.name,
          timestamp: toolCall.timestamp,
        }))

      return q
        .unionAll(messageRows, toolCallRows)
        .where(({ kind }) => eq(kind, `message`))
        .select(({ id, body }) => ({ id, body }))
        .orderBy(({ $selected }) => $selected.id)
    })

    await collection.preload()

    expect(collection.toArray.map(stripVirtualProps)).toEqual([
      { id: 1, body: `hello` },
      { id: 2, body: `secret` },
    ])
  })

  it(`supports distinct, limit, and offset after query branch unionAll`, async () => {
    const messages = createMessagesCollection(`union-all-query-messages-window`)
    const toolCalls = createToolCallsCollection(`union-all-query-tools-window`)

    const collection = createLiveQueryCollection((q) => {
      const messageIds = q
        .from({ message: messages })
        .select(({ message }) => ({ id: message.id }))
      const toolCallIds = q
        .from({ toolCall: toolCalls })
        .select(({ toolCall }) => ({ id: toolCall.id }))

      return q
        .unionAll(messageIds, toolCallIds)
        .distinct()
        .orderBy(({ id }) => id)
        .offset(1)
        .limit(2)
    })

    await collection.preload()

    expect(collection.toArray.map(stripVirtualProps)).toEqual([
      { id: 2 },
      { id: 3 },
    ])
  })

  it(`supports groupBy and having after query branch unionAll`, async () => {
    const messages = createMessagesCollection(`union-all-query-messages-group`)
    const toolCalls = createToolCallsCollection(`union-all-query-tools-group`)

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
        .having(({ kind }) => gt(count(kind), 3))
    })

    await collection.preload()

    expect(collection.toArray.map(stripVirtualProps)).toEqual([
      { kind: `event`, rowCount: 4 },
    ])
  })

  it(`supports joins after query branch unionAll`, async () => {
    const messages = createMessagesCollection(`union-all-query-messages-join`)
    const toolCalls = createToolCallsCollection(`union-all-query-tools-join`)
    const users = createUsersCollection(`union-all-query-users-join`)

    const collection = createLiveQueryCollection((q) => {
      const messageRows = q
        .from({ message: messages })
        .select(({ message }) => ({
          kind: `message` as const,
          id: message.id,
          userId: message.userId,
          timestamp: message.timestamp,
        }))
      const toolCallRows = q
        .from({ toolCall: toolCalls })
        .select(({ toolCall }) => ({
          kind: `toolCall` as const,
          id: toolCall.id,
          userId: toolCall.userId,
          timestamp: toolCall.timestamp,
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
        .orderBy(({ $selected }) => $selected.id)
    })

    await collection.preload()

    expect(collection.toArray.map(stripVirtualProps)).toEqual([
      { kind: `message`, id: 1, userName: `Alice` },
      { kind: `toolCall`, id: 1, userName: `Alice` },
      { kind: `message`, id: 2, userName: `Bob` },
    ])
  })

  it(`deoptimizes lazy joins when query branch unionAll is the lazy side`, async () => {
    const messages = createMessagesCollection(`union-all-query-messages-lazy-main`)
    const toolCalls = createToolCallsCollection(`union-all-query-tools-lazy-main`)
    const users = createCollection(
      mockSyncCollectionOptions<User>({
        id: `union-all-query-users-lazy-main`,
        getKey: (user) => user.id,
        initialData: [{ id: 1, name: `Alice` }],
      }),
    )

    const collection = createLiveQueryCollection((q) => {
      const messageRows = q
        .from({ message: messages })
        .select(({ message }) => ({
          kind: `message` as const,
          id: message.id,
          userId: message.userId,
          timestamp: message.timestamp,
        }))
      const toolCallRows = q
        .from({ toolCall: toolCalls })
        .select(({ toolCall }) => ({
          kind: `toolCall` as const,
          id: toolCall.id,
          userId: toolCall.userId,
          timestamp: toolCall.timestamp,
        }))

      return q
        .unionAll(messageRows, toolCallRows)
        .join({ user: users }, ({ userId, user }) => eq(userId, user.id), `inner`)
        .select(({ kind, id, user }) => ({
          kind,
          id,
          userName: user.name,
        }))
        .orderBy(({ $selected }) => $selected.id)
    })

    await collection.preload()

    expect(collection.toArray.map(stripVirtualProps)).toEqual([
      { kind: `message`, id: 1, userName: `Alice` },
      { kind: `toolCall`, id: 1, userName: `Alice` },
    ])
  })

  it(`materializes includes inside query branch unionAll results`, async () => {
    const messages = createMessagesCollection(`union-all-query-messages-includes`)
    const toolCalls = createToolCallsCollection(`union-all-query-tools-includes`)
    const chunks = createChunksCollection(`union-all-query-chunks-includes`)

    const collection = createLiveQueryCollection((q) => {
      const messageRows = q
        .from({ message: messages })
        .select(({ message }) => ({
          kind: `message` as const,
          id: message.id,
          timestamp: message.timestamp,
          chunks: toArray(
            q
              .from({ chunk: chunks })
              .where(({ chunk }) => eq(chunk.messageId, message.id))
              .orderBy(({ chunk }) => chunk.id)
              .select(({ chunk }) => chunk.text),
          ),
        }))
      const toolCallRows = q
        .from({ toolCall: toolCalls })
        .select(({ toolCall }) => ({
          kind: `toolCall` as const,
          id: toolCall.id,
          timestamp: toolCall.timestamp,
        }))

      return q.unionAll(messageRows, toolCallRows).orderBy(({ timestamp }) => timestamp)
    })

    await collection.preload()

    expect(collection.toArray.map(stripVirtualPropsDeep)).toEqual([
      { kind: `message`, id: 1, timestamp: 10, chunks: [`hello`, `world`] },
      { kind: `toolCall`, id: 1, timestamp: 20 },
      { kind: `message`, id: 2, timestamp: 30, chunks: [`hidden`] },
      { kind: `toolCall`, id: 3, timestamp: 40 },
    ])
  })

  it(`materializes query branch unionAll includes through an outer select`, async () => {
    const messages = createMessagesCollection(
      `union-all-query-messages-includes-select`,
    )
    const toolCalls = createToolCallsCollection(
      `union-all-query-tools-includes-select`,
    )
    const chunks = createChunksCollection(`union-all-query-chunks-includes-select`)

    const collection = createLiveQueryCollection((q) => {
      const messageRows = q
        .from({ message: messages })
        .select(({ message }) => ({
          kind: `message` as const,
          id: message.id,
          timestamp: message.timestamp,
          chunks: toArray(
            q
              .from({ chunk: chunks })
              .where(({ chunk }) => eq(chunk.messageId, message.id))
              .orderBy(({ chunk }) => chunk.id)
              .select(({ chunk }) => chunk.text),
          ),
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
        .select(({ kind, id, timestamp, chunks: branchChunks }) => ({
          kind,
          id,
          timestamp,
          messageChunks: branchChunks,
        }))
        .orderBy(({ $selected }) => $selected.timestamp)
    })

    await collection.preload()

    expect(collection.toArray.map(stripVirtualPropsDeep)).toEqual([
      {
        kind: `message`,
        id: 1,
        timestamp: 10,
        messageChunks: [`hello`, `world`],
      },
      {
        kind: `toolCall`,
        id: 1,
        timestamp: 20,
        messageChunks: undefined,
      },
      {
        kind: `message`,
        id: 2,
        timestamp: 30,
        messageChunks: [`hidden`],
      },
      {
        kind: `toolCall`,
        id: 3,
        timestamp: 40,
        messageChunks: undefined,
      },
    ])
  })

  it(`materializes query branch unionAll includes before outer fnSelect`, async () => {
    const messages = createMessagesCollection(
      `union-all-query-messages-includes-fn-select`,
    )
    const toolCalls = createToolCallsCollection(
      `union-all-query-tools-includes-fn-select`,
    )
    const chunks = createChunksCollection(`union-all-query-chunks-includes-fn-select`)

    const collection = createLiveQueryCollection((q) => {
      const messageRows = q
        .from({ message: messages })
        .select(({ message }) => ({
          kind: `message` as const,
          id: message.id,
          timestamp: message.timestamp,
          chunks: toArray(
            q
              .from({ chunk: chunks })
              .where(({ chunk }) => eq(chunk.messageId, message.id))
              .orderBy(({ chunk }) => chunk.id)
              .select(({ chunk }) => chunk.text),
          ),
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
        .fn.select((row) => ({
          kind: row.kind,
          id: row.id,
          timestamp: row.timestamp,
          messageChunks: row.chunks,
        }))
        .orderBy(({ $selected }) => $selected.timestamp)
    })

    await collection.preload()

    expect(collection.toArray.map(stripVirtualPropsDeep)).toEqual([
      {
        kind: `message`,
        id: 1,
        timestamp: 10,
        messageChunks: [`hello`, `world`],
      },
      {
        kind: `toolCall`,
        id: 1,
        timestamp: 20,
        messageChunks: undefined,
      },
      {
        kind: `message`,
        id: 2,
        timestamp: 30,
        messageChunks: [`hidden`],
      },
      {
        kind: `toolCall`,
        id: 3,
        timestamp: 40,
        messageChunks: undefined,
      },
    ])

    chunks.utils.begin()
    chunks.utils.write({
      type: `insert`,
      value: { id: 4, messageId: 1, text: `again` },
    })
    chunks.utils.commit()
    await flushPromises()

    expect(collection.toArray.map(stripVirtualPropsDeep)[0]).toEqual({
      kind: `message`,
      id: 1,
      timestamp: 10,
      messageChunks: [`hello`, `world`, `again`],
    })
  })

  it(`rejects repeated source aliases across query branch unionAll inputs`, () => {
    const messages = createMessagesCollection(
      `union-all-query-messages-duplicate-alias`,
    )
    const toolCalls = createToolCallsCollection(
      `union-all-query-tools-duplicate-alias`,
    )

    expect(() =>
      createLiveQueryCollection((q) => {
        const messageRows = q.from({ row: messages })
        const toolCallRows = q.from({ row: toolCalls })

        return q.unionAll(messageRows, toolCallRows)
      }),
    ).toThrow(/Duplicate source alias "row"/)
  })

  it(`combines multiple sources into exclusive namespaced rows`, async () => {
    const messages = createMessagesCollection(`multi-source-messages-basic`)
    const toolCalls = createToolCallsCollection(`multi-source-tools-basic`)

    const collection = createLiveQueryCollection((q) =>
      q.unionAll({
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
      q.unionAll({
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
        .unionAll({
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
        .unionAll({
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
        .unionAll({
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
        .unionAll({
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
        .unionAll({
          message: visibleMessagesWithUsers,
          toolCall: toolCalls,
        })
        .orderBy(({ message, toolCall }) =>
          coalesce(message.timestamp, toolCall.timestamp),
        )
    })

    await collection.preload()

    expect(collection.toArray.map((row) => stripVirtualPropsDeep(row))).toEqual(
      [
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
      ],
    )
  })

  it(`supports joins after unionAll with branch-dependent keys`, async () => {
    const messages = createMessagesCollection(`multi-source-messages-join`)
    const toolCalls = createToolCallsCollection(`multi-source-tools-join`)
    const users = createUsersCollection(`multi-source-users-join`)

    const collection = createLiveQueryCollection((q) =>
      q
        .unionAll({
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

  it(`supports right joins after unionAll`, async () => {
    const messages = createMessagesCollection(
      `multi-source-messages-right-join`,
    )
    const toolCalls = createToolCallsCollection(`multi-source-tools-right-join`)
    const users = createUsersCollection(`multi-source-users-right-join`)

    const collection = createLiveQueryCollection((q) =>
      q
        .unionAll({
          message: messages,
          toolCall: toolCalls,
        })
        .rightJoin({ user: users }, ({ message, toolCall, user }) =>
          eq(coalesce(message.userId, toolCall.userId), user.id),
        )
        .orderBy(({ user }) => user.id),
    )

    await collection.preload()

    expect(collection.toArray.map((row) => stripVirtualPropsDeep(row))).toEqual(
      [
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
      ],
    )
  })

  it(`supports full joins after unionAll`, async () => {
    const messages = createMessagesCollection(`multi-source-messages-full-join`)
    const toolCalls = createToolCallsCollection(`multi-source-tools-full-join`)
    const users = createUsersCollection(`multi-source-users-full-join`)

    const collection = createLiveQueryCollection((q) =>
      q
        .unionAll({
          message: messages,
          toolCall: toolCalls,
        })
        .fullJoin({ user: users }, ({ message, toolCall, user }) =>
          eq(coalesce(message.userId, toolCall.userId), user.id),
        )
        .orderBy(({ message, toolCall, user }) =>
          coalesce(message.timestamp, toolCall.timestamp, user.id),
        ),
    )

    await collection.preload()

    expect(collection.toArray.map((row) => stripVirtualPropsDeep(row))).toEqual(
      [
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
      ],
    )
  })

  it(`does not lazy-load branch-dependent joins after unionAll`, async () => {
    const messages = createMessagesCollection(`multi-source-messages-no-lazy`)
    const toolCalls = createToolCallsCollection(`multi-source-tools-no-lazy`)
    const { collection: users, loadSubsetCalls } =
      createUsersCollectionWithLoadSubsetTracking(`multi-source-users-no-lazy`)

    const collection = createLiveQueryCollection((q) =>
      q
        .unionAll({
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

  it(`lazy-loads each branch when joining to a unionAll subquery`, async () => {
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
        .unionAll({
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

  it(`does not lazy-load computed unionAll subquery join projections`, async () => {
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
        .unionAll({
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
    expect(
      messageLoadSubsetCalls.every((call) => call.where === undefined),
    ).toBe(true)
    expect(toolLoadSubsetCalls.every((call) => call.where === undefined)).toBe(
      true,
    )
  })

  it(`does not lazy-load limited unionAll subquery branches`, async () => {
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
    const users = createUsersCollection(
      `multi-source-users-limited-subquery-join`,
    )

    const collection = createLiveQueryCollection((q) => {
      const firstMessage = q
        .from({ message: messages })
        .orderBy(({ message }) => message.timestamp)
        .limit(1)

      const events = q
        .unionAll({
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
    expect(
      messageLoadSubsetCalls.every((call) => call.where === undefined),
    ).toBe(true)
    expect(toolLoadSubsetCalls.some((call) => call.where)).toBe(true)
  })

  it(`supports distinct over selected unionAll rows`, async () => {
    const messages = createMessagesCollection(`multi-source-messages-distinct`)
    const toolCalls = createToolCallsCollection(`multi-source-tools-distinct`)

    const collection = createLiveQueryCollection((q) =>
      q
        .unionAll({
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
        .unionAll({
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
    const messages = createMessagesCollection(
      `multi-source-messages-join-error`,
    )
    const toolCalls = createToolCallsCollection(`multi-source-tools-join-error`)
    const users = createUsersCollection(`multi-source-users-join-error`)

    expect(() =>
      createLiveQueryCollection((q) =>
        q
          .from({ message: messages })
          .join({ toolCall: toolCalls, user: users }, ({ message, toolCall }) =>
            eq(message.id, toolCall.id),
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
        .unionAll({
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

    expect(collection.toArray.map((row) => stripVirtualPropsDeep(row))).toEqual(
      [
        {
          message: { id: 1, text: `hello`, chunks: [`hello`, `world`] },
          toolCall: null,
          timestamp: 10,
        },
        {
          message: null,
          toolCall: { id: 1, name: `search` },
          timestamp: 20,
        },
        {
          message: { id: 2, text: `secret`, chunks: [`hidden`] },
          toolCall: null,
          timestamp: 30,
        },
        {
          message: null,
          toolCall: { id: 3, name: `write` },
          timestamp: 40,
        },
      ],
    )
  })

  it(`materializes correlated collection includes from unionAll subquery children`, async () => {
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
    const users = createUsersCollection(
      `multi-source-users-collection-includes`,
    )

    const collection = createLiveQueryCollection((q) => {
      const events = q
        .unionAll({
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

  it(`materializes nested concat includes inside unionAll subquery child rows`, async () => {
    const runs = createCollection(
      mockSyncCollectionOptions<RunRow>({
        id: `multi-source-nested-concat-runs`,
        getKey: (run) => run.key,
        initialData: [{ key: `run-1`, order: `1`, status: `running` }],
      }),
    )
    const texts = createCollection(
      mockSyncCollectionOptions<TextRow>({
        id: `multi-source-nested-concat-texts`,
        getKey: (text) => text.key,
        initialData: [
          { key: `text-1`, runId: `run-1`, order: `1`, status: `streaming` },
        ],
      }),
    )
    const toolCalls = createCollection(
      mockSyncCollectionOptions<ToolCallRow>({
        id: `multi-source-nested-concat-tool-calls`,
        getKey: (toolCall) => toolCall.key,
        initialData: [],
      }),
    )
    const textDeltas = createCollection(
      mockSyncCollectionOptions<TextDeltaRow>({
        id: `multi-source-nested-concat-text-deltas`,
        getKey: (delta) => delta.key,
        initialData: [
          { key: `delta-1`, textId: `text-1`, order: `1`, delta: `Hello` },
          { key: `delta-2`, textId: `text-1`, order: `2`, delta: ` world` },
        ],
      }),
    )

    const timeline = createLiveQueryCollection((q) => {
      const runItemsSource = q
        .unionAll({
          text: texts,
          toolCall: toolCalls,
        })
        .select(({ text, toolCall }) => ({
          order: coalesce(text.order, toolCall.order, `~`),
          runId: coalesce(text.runId, toolCall.runId, ``),
          text: caseWhen(text.key, {
            key: text.key,
            runId: text.runId,
            order: text.order,
            status: text.status,
          }),
          textContent: concat(
            toArray(
              q
                .from({ chunk: textDeltas })
                .where(({ chunk }) => eq(chunk.textId, text.key))
                .orderBy(({ chunk }) => chunk.order)
                .select(({ chunk }) => chunk.delta),
            ),
          ),
          toolCall: caseWhen(toolCall.key, {
            key: toolCall.key,
            runId: toolCall.runId,
            order: toolCall.order,
            name: toolCall.name,
            status: toolCall.status,
          }),
        }))

      return q.from({ run: runs }).select(({ run }) => ({
        run: caseWhen(run.key, {
          key: run.key,
          order: run.order,
          status: run.status,
          items: q
            .from({ item: runItemsSource })
            .where(({ item }) => eq(item.runId, run.key))
            .orderBy(({ item }) => item.order)
            .select(({ item }) => ({
              text: caseWhen(item.text.key, {
                key: item.text.key,
                runId: item.text.runId,
                order: item.text.order,
                status: item.text.status,
                content: item.textContent,
              }),
              inactiveText: caseWhen(item.toolCall.key, {
                content: item.textContent,
              }),
              toolCall: item.toolCall,
            })),
        }),
      }))
    })

    await timeline.preload()

    const run = timeline.toArray[0]!.run
    expect(run).toBeDefined()
    const items = childRows(run.items)
    expect(items).toEqual([
      {
        text: {
          key: `text-1`,
          runId: `run-1`,
          order: `1`,
          status: `streaming`,
          content: `Hello world`,
        },
        inactiveText: null,
        toolCall: null,
      },
    ])

    const directItemChanges: Array<{
      type: string
      key: unknown
      content: string | null
    }> = []
    run.items.subscribeChanges((changes: Array<any>) => {
      for (const change of changes) {
        if (change.type !== `delete`) {
          directItemChanges.push({
            type: change.type,
            key: change.key,
            content: change.value.text.content,
          })
        }
      }
    })

    const itemLiveQuery = createLiveQueryCollection({
      query: (q) => q.from({ item: run.items }),
      startSync: true,
    })

    const liveItemChanges: Array<string | null> = []
    itemLiveQuery.subscribeChanges((changes: Array<any>) => {
      for (const change of changes) {
        if (change.type !== `delete`) {
          liveItemChanges.push(change.value.text.content)
        }
      }
    })
    for (let i = 0; i < 10 && itemLiveQuery.size === 0; i++) {
      await flushPromises()
    }
    expect(itemLiveQuery.toArray[0]!.text.content).toBe(`Hello world`)

    textDeltas.insert({
      key: `delta-3`,
      textId: `text-1`,
      order: `3`,
      delta: `!`,
    })
    await flushPromises()

    expect(childRows(run.items)[0]!.text.content).toBe(`Hello world!`)
    expect(childRows(run.items)[0]!.inactiveText).toBeNull()
    expect(itemLiveQuery.toArray[0]!.text.content).toBe(`Hello world!`)
    expect(itemLiveQuery.toArray[0]!.inactiveText).toBeNull()
    directItemChanges.length = 0
    liveItemChanges.length = 0

    textDeltas.insert({
      key: `delta-4`,
      textId: `text-1`,
      order: `4`,
      delta: ` Again`,
    })
    await flushPromises()
    await flushPromises()

    expect(childRows(run.items)[0]!.text.content).toBe(`Hello world! Again`)
    expect(childRows(run.items)[0]!.inactiveText).toBeNull()
    expect(itemLiveQuery.toArray[0]!.text.content).toBe(`Hello world! Again`)
    expect(itemLiveQuery.toArray[0]!.inactiveText).toBeNull()

    textDeltas.insert({
      key: `delta-5`,
      textId: `text-1`,
      order: `5`,
      delta: ` Done`,
    })
    await flushPromises()
    await flushPromises()

    expect(childRows(run.items)[0]!.text.content).toBe(
      `Hello world! Again Done`,
    )
    expect(childRows(run.items)[0]!.inactiveText).toBeNull()
    expect(itemLiveQuery.toArray[0]!.text.content).toBe(
      `Hello world! Again Done`,
    )
    expect(itemLiveQuery.toArray[0]!.inactiveText).toBeNull()
    expect(directItemChanges.map((change) => change.key)).toEqual([
      `text:string:text-1`,
      `text:string:text-1`,
    ])
    expect(directItemChanges.map((change) => change.content)).toEqual([
      `Hello world! Again`,
      `Hello world! Again Done`,
    ])
    expect(liveItemChanges).toEqual([
      `Hello world! Again`,
      `Hello world! Again Done`,
    ])
  })
})
