import { Buffer } from 'node:buffer'
import { createCollection } from '@tanstack/db'
import { ConvexClient } from 'convex/browser'
import { ConvexReactClient } from 'convex/react'
import { makeFunctionReference } from 'convex/server'
import { convexToJson } from 'convex/values'
import { describe, expect, it, vi } from 'vitest'
import { convexCollectionOptions } from '../src/index'
import { mutation, query } from './helpers'
import type { Value } from 'convex/values'

// Only the transport is controlled. Both clients, their caches, subscriptions,
// mutation timestamp barriers, decoding, and the DB Collection are real.
class Socket {
  static instances: Array<Socket> = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null
  sent: Array<Record<string, unknown>> = []
  constructor(_url: string) {
    Socket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>)
  }
  close() {
    queueMicrotask(() => this.onclose?.({ code: 1000, reason: `` }))
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
  open() {
    this.onopen?.()
  }
}

function timestamp(value: number): string {
  const bytes = Buffer.alloc(8)
  bytes.writeBigUInt64LE(BigInt(value))
  return bytes.toString(`base64`)
}

function server(socket: Socket) {
  let time = 0
  let querySet = 0
  return {
    snapshot(rows: Value) {
      const changes = socket.sent.filter((msg) => msg.type === `ModifyQuerySet`)
      const version = changes.at(-1)?.newVersion as number
      const modifications = changes.flatMap(
        (msg) => msg.modifications as Array<{ type: string; queryId: number }>,
      )
      const id = modifications.find((mod) => mod.type === `Add`)!.queryId
      socket.receive({
        type: `Transition`,
        startVersion: { querySet, ts: timestamp(time), identity: 0 },
        endVersion: { querySet: version, ts: timestamp(++time), identity: 0 },
        modifications: [
          {
            type: `QueryUpdated`,
            queryId: id,
            value: convexToJson(rows),
            logLines: [],
            journal: null,
          },
        ],
      })
      querySet = version
    },
    acknowledge(success = true) {
      const request = [...socket.sent]
        .reverse()
        .find((msg) => msg.type === `Mutation`)!
      socket.receive(
        success
          ? {
              type: `MutationResponse`,
              requestId: request.requestId,
              success: true,
              result: null,
              ts: timestamp(time + 1),
              logLines: [],
            }
          : {
              type: `MutationResponse`,
              requestId: request.requestId,
              success: false,
              result: `permission denied`,
              logLines: [],
            },
      )
    },
  }
}

describe.each([`javascript`, `react`] as const)(
  `real Convex %s client`,
  (kind) => {
    function setup() {
      const options = {
        webSocketConstructor: Socket as unknown as typeof WebSocket,
        unsavedChangesWarning: false,
        logger: false as const,
      }
      const client =
        kind === `javascript`
          ? new ConvexClient(`https://test.convex.cloud`, options)
          : new ConvexReactClient(`https://test.convex.cloud`, options)
      const collection = createCollection(
        convexCollectionOptions({
          client,
          query,
          queryArgs: { owner: `alice` },
          getKey: (row) => row._id,
          gcTime: 0,
          onUpdate: async ({ transaction }) => {
            await client.mutation(mutation, {
              text: transaction.mutations[0].modified.text,
            })
          },
        }),
      )
      collection.startSyncImmediate()
      const socket = Socket.instances.at(-1)!
      socket.open()
      return { client, collection, socket, remote: server(socket) }
    }

    it(`subscribes with generated function names and typed args`, async () => {
      const { client, collection, socket, remote } = setup()
      try {
        const subscription = socket.sent.find(
          (msg) => msg.type === `ModifyQuerySet`,
        )!
        expect(subscription.modifications).toMatchObject([
          { type: `Add`, udfPath: `tasks:list`, args: [{ owner: `alice` }] },
        ])
        remote.snapshot([{ _id: `a`, text: `hello` }])
        await collection.preload()
        expect(collection.get(`a`)?.text).toBe(`hello`)
        remote.snapshot([])
        expect(collection.size).toBe(0)
        await collection.cleanup()
        expect(socket.sent.at(-1)).toMatchObject({
          type: `ModifyQuerySet`,
          modifications: [{ type: `Remove` }],
        })
      } finally {
        await collection.cleanup()
        await client.close()
      }
    })

    it(`waits for a query transition past the mutation timestamp before settling`, async () => {
      const { client, collection, remote } = setup()
      try {
        remote.snapshot([{ _id: `a`, text: `old` }])
        await collection.preload()
        const seen: Array<string | undefined> = []
        const subscription = collection.subscribeChanges(() => {
          seen.push(collection.get(`a`)?.text)
        })
        const transaction = collection.update(`a`, (row) => {
          row.text = `optimistic`
        })
        remote.acknowledge()
        await Promise.resolve()
        expect(transaction.state).toBe(`persisting`)
        expect(collection.get(`a`)?.text).toBe(`optimistic`)
        remote.snapshot([{ _id: `a`, text: `server` }])
        await transaction.isPersisted.promise
        expect(collection.get(`a`)?.text).toBe(`server`)
        expect(seen).not.toContain(`old`)
        subscription.unsubscribe()
      } finally {
        await collection.cleanup()
        await client.close()
      }
    })

    it(`resubscribes and replays an in-flight mutation after reconnect`, async () => {
      vi.useFakeTimers()
      const { client, collection, socket, remote } = setup()
      try {
        remote.snapshot([{ _id: `a`, text: `old` }])
        await collection.preload()
        const transaction = collection.update(`a`, (row) => {
          row.text = `optimistic`
        })
        socket.onclose?.({ code: 1006, reason: `network lost` })
        await vi.advanceTimersByTimeAsync(3000)
        const replacement = Socket.instances.at(-1)!
        expect(replacement).not.toBe(socket)
        replacement.open()
        expect(
          replacement.sent.some((message) => message.type === `Mutation`),
        ).toBe(true)
        expect(collection.get(`a`)?.text).toBe(`optimistic`)
        const nextRemote = server(replacement)
        nextRemote.acknowledge()
        nextRemote.snapshot([{ _id: `a`, text: `reconnected` }])
        await transaction.isPersisted.promise
        expect(collection.get(`a`)?.text).toBe(`reconnected`)
      } finally {
        await collection.cleanup()
        // close() uses a microtask, which fake timers otherwise hold.
        const closed = client.close()
        await vi.runAllTimersAsync()
        await closed
        vi.useRealTimers()
      }
    })

    it(`rolls back on an actual Convex mutation failure`, async () => {
      const { client, collection, remote } = setup()
      try {
        remote.snapshot([{ _id: `a`, text: `old` }])
        await collection.preload()
        const transaction = collection.update(`a`, (row) => {
          row.text = `optimistic`
        })
        remote.acknowledge(false)
        await expect(transaction.isPersisted.promise).rejects.toThrow(
          `permission denied`,
        )
        expect(collection.get(`a`)?.text).toBe(`old`)
      } finally {
        await collection.cleanup()
        await client.close()
      }
    })
  },
)

it(`preserves Convex integers, special floats, nested values, and bytes`, async () => {
  const client = new ConvexClient(`https://test.convex.cloud`, {
    webSocketConstructor: Socket as unknown as typeof WebSocket,
    unsavedChangesWarning: false,
    logger: false,
  })
  const valuesQuery = makeFunctionReference<
    `query`,
    {},
    Array<{ _id: string; payload: Value }>
  >(`values:list`)
  const collection = createCollection(
    convexCollectionOptions({
      client,
      query: valuesQuery,
      queryArgs: {},
      getKey: (row) => row._id,
      gcTime: 0,
    }),
  )
  collection.startSyncImmediate()
  const socket = Socket.instances.at(-1)!
  socket.open()
  const remote = server(socket)
  try {
    const values: Array<Value> = [
      9223372036854775807n,
      NaN,
      Infinity,
      -Infinity,
      -0,
      { nested: [null, true, `hello`, { key: `value` }] },
      new Uint8Array([1, 2]).buffer,
    ]
    for (const payload of values) {
      remote.snapshot([{ _id: `a`, payload }])
      await collection.preload()
      const actual = collection.get(`a`)!.payload
      if (payload instanceof ArrayBuffer)
        expect([...new Uint8Array(actual as ArrayBuffer)]).toEqual([
          ...new Uint8Array(payload),
        ])
      else expect(actual).toEqual(payload)
    }
    const changed = vi.fn()
    const listener = collection.subscribeChanges(changed)
    remote.snapshot([{ _id: `a`, payload: new Uint8Array([3, 4]).buffer }])
    expect(changed).toHaveBeenCalledOnce()
    listener.unsubscribe()
    expect([
      ...new Uint8Array(collection.get(`a`)!.payload as ArrayBuffer),
    ]).toEqual([3, 4])
  } finally {
    await collection.cleanup()
    await client.close()
  }
})

it(`rejects preload for a disabled JavaScript client`, async () => {
  const client = new ConvexClient(`https://test.convex.cloud`, {
    disabled: true,
  })
  const collection = createCollection(
    convexCollectionOptions({
      client,
      query,
      queryArgs: { owner: `alice` },
      getKey: (row) => row._id,
      gcTime: 0,
    }),
  )
  await expect(collection.preload()).rejects.toThrow(`disabled Convex client`)
  await collection.cleanup()
  await client.close()
})
