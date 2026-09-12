import { expect, it, vi } from 'vitest'
import { createCollection } from '@tanstack/db'
import { initClient } from 'trailbase'
import { trailBaseCollectionOptions } from '../src/trailbase'
import type { Event } from 'trailbase'

type Row = { id: number; value: string }
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

// This fixture supplies complete SSE frames at Client.fetch. The real installed
// SDK still chooses the RecordApi route and decodes bytes into adapter events.
// It makes no claim about a live service or arbitrary split-frame delivery.
function createSdkBoundary(apiName: string) {
  const client = initClient(`http://trailbase-oracle.invalid`)
  const api = client.records<Row>(apiName)
  const requests: Array<string> = []
  const unexpected = new Error(`unexpected SDK request`)
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const cancel = vi.fn()
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
    },
    cancel,
  })
  const subscriptionPath = `/api/records/v1/${apiName}/subscribe/*`
  const listPath = `/api/records/v1/${apiName}?limit=256`
  const fetch = vi.spyOn(client, `fetch`).mockImplementation((path) => {
    requests.push(path)
    if (path === subscriptionPath)
      return Promise.resolve(
        new Response(body, {
          headers: { 'Content-Type': `text/event-stream` },
        }),
      )
    if (path === listPath)
      return Promise.resolve(new Response(JSON.stringify({ records: [] })))
    return Promise.reject(unexpected)
  })
  return {
    api,
    requests,
    subscriptionPath,
    listPath,
    unexpected,
    body,
    cancel,
    controller,
    fetch,
  }
}

it.each([`oracle_rows`, `other_rows`])(
  `connects the adapter wildcard through real SDK routing and decoding for %s`,
  async (apiName) => {
    const fixture = createSdkBoundary(apiName)
    const intervals = vi.spyOn(globalThis, `setInterval`)
    const cleared = vi.spyOn(globalThis, `clearInterval`)
    const collection = createCollection(
      trailBaseCollectionOptions({
        recordApi: fixture.api,
        getKey: (row: Row) => row.id,
        syncMode: `eager`,
        parse: {},
        serialize: {},
      }),
    )
    try {
      await collection.preload()
      expect(fixture.requests).toEqual([
        fixture.subscriptionPath,
        fixture.listPath,
      ])
      expect(collection.status).toBe(`ready`)
      expect(collection.toArray).toEqual([])
      expect(fixture.body.locked).toBe(true)
      fixture.controller.enqueue(
        new TextEncoder().encode(
          'data: {"Insert":{"id":7,"value":"decoded value"}}\n\n',
        ),
      )
      await turn()
      expect(
        collection.toArray.map(({ id, value }) => ({ id, value })),
      ).toEqual([{ id: 7, value: `decoded value` }])
      expect(collection.status).toBe(`ready`)
      expect(fixture.cancel).not.toHaveBeenCalled()
    } finally {
      try {
        await collection.cleanup()
        await turn()
        expect(fixture.body.locked).toBe(false)
        expect(fixture.cancel).toHaveBeenCalledOnce()
        for (const timer of intervals.mock.results) {
          if (timer.type === `return`)
            expect(cleared).toHaveBeenCalledWith(timer.value)
        }
      } finally {
        fixture.fetch.mockRestore()
        intervals.mockRestore()
        cleared.mockRestore()
      }
    }
  },
)

it(`connects the SDK subscribeAll convention to the wildcard response`, async () => {
  const fixture = createSdkBoundary(`oracle_rows`)
  let stream: ReadableStream<Event> | undefined
  try {
    stream = await fixture.api.subscribeAll()
    expect(fixture.requests).toEqual([fixture.subscriptionPath])
    const reader = stream.getReader()
    try {
      fixture.controller.enqueue(
        new TextEncoder().encode(
          'data: {"Insert":{"id":9,"value":"all records"}}\n\n',
        ),
      )
      expect(await reader.read()).toEqual({
        done: false,
        value: { Insert: { id: 9, value: `all records` } },
      })
    } finally {
      reader.releaseLock()
    }
  } finally {
    try {
      await stream?.cancel()
      await turn()
      expect(fixture.body.locked).toBe(false)
      expect(fixture.cancel).toHaveBeenCalledOnce()
    } finally {
      fixture.fetch.mockRestore()
    }
  }
})

it(`does not give a single-record SDK request the wildcard fixture`, async () => {
  const fixture = createSdkBoundary(`oracle_rows`)
  const subscribe = fixture.api.subscribe.bind(fixture.api)
  // Change the request before the SDK builds its URL, not the captured URL or
  // expected rows. The strict fetch fixture must reject this distinct request.
  const wrongArgument = vi
    .spyOn(fixture.api, `subscribe`)
    .mockImplementation(() => subscribe(7))
  const collection = createCollection(
    trailBaseCollectionOptions({
      recordApi: fixture.api,
      getKey: (row: Row) => row.id,
      syncMode: `eager`,
      parse: {},
      serialize: {},
    }),
  )
  try {
    await expect(collection.preload()).rejects.toBe(fixture.unexpected)
    expect(wrongArgument).toHaveBeenCalledExactlyOnceWith(`*`)
    expect(fixture.requests).toEqual([
      `/api/records/v1/oracle_rows/subscribe/7`,
    ])
    expect(collection.status).toBe(`error`)
    expect(collection.toArray).toEqual([])
    expect(fixture.cancel).not.toHaveBeenCalled()
  } finally {
    try {
      await collection.cleanup()
      await fixture.body.cancel()
      expect(fixture.body.locked).toBe(false)
    } finally {
      wrongArgument.mockRestore()
      fixture.fetch.mockRestore()
    }
  }
})
