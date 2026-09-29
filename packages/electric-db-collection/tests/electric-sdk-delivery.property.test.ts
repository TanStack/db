import fc from 'fast-check'
import { expect, it, vi } from 'vitest'
import { IR, createCollection } from '@tanstack/db'
import { ShapeStream } from '@electric-sql/client'
import { electricCollectionOptions } from '../src/electric'
import { oraclePropertyOptions } from '../../db/tests/oracle-config'
import { atCheckpoint, withElectricCleanup } from './electric-oracle-lifecycle'
import type { Message } from '@electric-sql/client'

/**
 * # Does the installed Electric SDK deliver the adapter's assumed protocol?
 *
 * The main adapter oracle controls callbacks below the SDK. This driver moves
 * the boundary outward: a finite HTTP provider sends real Electric responses,
 * and the installed ShapeStream owns framing, pause, snapshot, abort, and
 * silent-move behavior. The adapter must reconstruct the same overlapping
 * source relation and DNF visibility as the independent model.
 *
 * Response gates expose ordering without replacing the SDK. Dropping response
 * rows or silent reactivation deliberately breaks the driver and proves its
 * boundary assertions are live.
 */

type Item = { id: number; name: string }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

type Request = { url: URL; respond: (response: Response) => void }

// The finite provider only holds responses and observes each fetch's signal.
function controlledHttp() {
  const queued: Array<Request> = []
  const waiting: Array<{
    snapshot: boolean | undefined
    resolve: (request: Request) => void
    reject: (error: unknown) => void
  }> = []
  const active = new Set<() => void>()
  let closed = false
  const closedError = new Error(`Electric oracle HTTP provider closed`)
  const isSnapshot = (request: Request) =>
    request.url.searchParams.has(`subset__where`)
  const fetchClient: typeof fetch = (input, init) =>
    new Promise<Response>((resolve, reject) => {
      if (closed) {
        reject(closedError)
        return
      }
      const signal = init?.signal
      const url = new URL(String(input))
      const request: Request = {
        url,
        respond: (response) => {
          remove()
          resolve(response)
        },
      }
      const remove = () => {
        signal?.removeEventListener(`abort`, abort)
        active.delete(abort)
        const index = queued.indexOf(request)
        if (index >= 0) queued.splice(index, 1)
      }
      const abort = () => {
        remove()
        reject(
          signal?.reason ??
            new DOMException(`Provider request aborted`, `AbortError`),
        )
      }
      if (signal?.aborted) {
        abort()
        return
      }
      signal?.addEventListener(`abort`, abort, { once: true })
      active.add(abort)
      const index = waiting.findIndex(
        (waiter) =>
          waiter.snapshot === undefined ||
          waiter.snapshot === isSnapshot(request),
      )
      if (index >= 0) waiting.splice(index, 1)[0]!.resolve(request)
      else queued.push(request)
    })
  return {
    fetchClient,
    take: (snapshot = false): Promise<Request> => {
      if (closed) return Promise.reject(closedError)
      const index = queued.findIndex(
        (request) => isSnapshot(request) === snapshot,
      )
      if (index >= 0) return Promise.resolve(queued.splice(index, 1)[0]!)
      return new Promise((resolve, reject) =>
        waiting.push({ snapshot, resolve, reject }),
      )
    },
    takeAny: (): Promise<Request> => {
      if (closed) return Promise.reject(closedError)
      if (queued.length > 0) return Promise.resolve(queued.shift()!)
      return new Promise((resolve, reject) =>
        waiting.push({ snapshot: undefined, resolve, reject }),
      )
    },
    close: () => {
      closed = true
      for (const abort of [...active]) abort()
      for (const waiter of waiting.splice(0)) waiter.reject(closedError)
    },
    activeCount: () => active.size,
  }
}

const headers = (offset: number) => ({
  'electric-handle': `shape`,
  'electric-offset': `${offset}_0`,
  'electric-cursor': String(offset),
  'electric-up-to-date': `true`,
  'electric-schema': JSON.stringify({
    id: { type: `int4` },
    name: { type: `text` },
  }),
})
let sequence = 0

async function checkSnapshots(width: number, name: string, dropRows = false) {
  const http = controlledHttp()
  const batches: Array<Array<Message<Item>>> = []
  let delivery = deferred<void>()
  const subscribe = ShapeStream.prototype.subscribe
  const spy = vi
    .spyOn(ShapeStream.prototype, `subscribe`)
    .mockImplementation(function (this: ShapeStream, callback, onError) {
      return subscribe.call(
        this,
        (messages) => {
          const snapshot = messages.some(
            (message) => message.headers.control === `snapshot-end`,
          )
          batches.push(structuredClone(messages) as Array<Message<Item>>)
          const result = callback(
            dropRows && snapshot
              ? messages.filter((message) => !(`value` in message))
              : messages,
          )
          delivery.resolve()
          return result
        },
        onError,
      )
    })
  const collection = createCollection(
    electricCollectionOptions<Item>({
      id: `sdk-snapshot-${++sequence}`,
      shapeOptions: {
        url: `http://test-url/snapshot-${sequence}`,
        params: { table: `rows` },
        fetchClient: http.fetchClient,
      },
      syncMode: `on-demand`,
      startSync: true,
      getKey: (row) => row.id,
    }),
  )
  const rows = () =>
    collection.toArray
      .map(({ id, name: value }) => ({ id, name: value }))
      .sort((a, b) => a.id - b.id)
  const source = Array.from({ length: width }, (_unused, index) => ({
    id: index + 1,
    name: `${name}-${index}`,
  }))
  const expected = new Map<number, Item>()
  return withElectricCleanup(async () => {
    // A cold on-demand request may acquire a snapshot while the initial live
    // poll is still pending; requestSnapshot owns pausing that poll.
    await atCheckpoint(http.take(), `initial live request`)
    expect(rows()).toEqual([])
    for (const [index, lowerBound] of [1, 2, width + 1].entries()) {
      // Distinct predicates prevent request deduplication; the second response
      // overlaps prior rows and changes their payload, and the last is empty.
      if (index === 1) for (const item of source) item.name += `-changed`
      const responseRows = source
        .filter((item) => item.id >= lowerBound)
        .map((item) => ({ ...item }))
      const before = rows()
      delivery = deferred<void>()
      const loading = collection._sync.loadSubset({
        where: new IR.Func(`gte`, [
          new IR.PropRef([`id`]),
          new IR.Value(lowerBound),
        ]),
      })
      // Observe rejection immediately even while the HTTP delivery is held.
      const completion = Promise.resolve(loading).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      )
      const request = await atCheckpoint(http.take(true), `snapshot request`)
      expect(request.url.searchParams.get(`subset__where`)).toContain(`id`)
      expect(rows()).toEqual(before)
      const data = responseRows.map((item) => ({
        key: String(item.id),
        value: { ...item, id: String(item.id) },
        headers: { operation: `insert` },
      }))
      request.respond(
        new Response(
          JSON.stringify({
            metadata: {
              xmin: `10`,
              xmax: `20`,
              xip_list: [],
              database_lsn: `10`,
              snapshot_mark: index + 1,
            },
            data,
          }),
          { headers: headers(index + 2) },
        ),
      )
      // This is subscriber delivery after the real SDK adds both boundaries,
      // not an assumption that loadSubset's Promise means rows were applied.
      await atCheckpoint(delivery.promise, `snapshot delivery`)
      const batch = batches.at(-1)!
      expect(batch.slice(-2).map((message) => message.headers.control)).toEqual(
        [`snapshot-end`, `subset-end`],
      )
      expect(batch.filter((message) => `value` in message)).toHaveLength(
        responseRows.length,
      )
      for (const item of responseRows) expected.set(item.id, item)
      expect(rows(), `snapshot ${index} applied rows`).toEqual(
        [...expected.values()].sort((a, b) => a.id - b.id),
      )
      const outcome = await atCheckpoint(
        completion,
        `snapshot request completion`,
      )
      if (!outcome.ok) throw outcome.error
    }
    await atCheckpoint(http.take(), `resumed live request`)
  }, [
    () => collection.cleanup(),
    () => {
      expect(http.activeCount()).toBe(0)
    },
    () => http.close(),
    () => {
      spy.mockRestore()
    },
    () => {
      expect(http.activeCount()).toBe(0)
    },
  ])
}

it(`applies installed-SDK snapshot deliveries against an independent overlapping source`, async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 2, max: 4 }),
      fc.string({ maxLength: 10 }),
      (width, name) => checkSnapshots(width, name),
    ),
    {
      seed: 20260917,
      ...oraclePropertyOptions(12, `electric.sdk-snapshot-delivery`),
    },
  )
})

it(`rejects a snapshot driver that delivers boundaries but drops response rows`, async () => {
  await expect(checkSnapshots(2, `payload`, true)).rejects.toMatchObject({
    name: `AssertionError`,
    message: expect.stringContaining(`snapshot 0 applied rows`),
  })
})

it(`lets requestSnapshot own the warm-stream transport transition`, async () => {
  const http = controlledHttp()
  let delivery = deferred<void>()
  const subscribe = ShapeStream.prototype.subscribe
  const spy = vi
    .spyOn(ShapeStream.prototype, `subscribe`)
    .mockImplementation(function (this: ShapeStream, callback, onError) {
      return subscribe.call(
        this,
        (messages) => {
          const result = callback(messages)
          delivery.resolve()
          return result
        },
        onError,
      )
    })
  const collection = createCollection(
    electricCollectionOptions<Item>({
      id: `sdk-warm-snapshot-${++sequence}`,
      shapeOptions: {
        url: `http://test-url/warm-snapshot-${sequence}`,
        params: { table: `rows` },
        fetchClient: http.fetchClient,
      },
      syncMode: `on-demand`,
      startSync: true,
      getKey: (row) => row.id,
    }),
  )

  return withElectricCleanup(async () => {
    const initial = await atCheckpoint(http.take(), `initial live request`)
    initial.respond(
      new Response(
        JSON.stringify([
          {
            headers: {
              control: `up-to-date`,
              global_last_seen_lsn: `1`,
            },
          },
        ]),
        { headers: headers(1) },
      ),
    )
    await atCheckpoint(delivery.promise, `initial up-to-date delivery`)

    // Hold the next live poll. The installed SDK's requestSnapshot owns the
    // pause/abort transition from this poll to the subset request.
    await atCheckpoint(http.take(), `warm live poll`)
    delivery = deferred<void>()
    const loading = collection._sync.loadSubset({
      where: new IR.Func(`gte`, [new IR.PropRef([`id`]), new IR.Value(1)]),
    })
    const request = await atCheckpoint(
      http.takeAny(),
      `first request after warm loadSubset`,
    )
    expect(request.url.searchParams.has(`subset__where`)).toBe(true)
    expect(http.activeCount()).toBe(1)
    request.respond(
      new Response(
        JSON.stringify({
          metadata: {
            xmin: `10`,
            xmax: `20`,
            xip_list: [],
            database_lsn: `10`,
            snapshot_mark: 2,
          },
          data: [],
        }),
        { headers: headers(2) },
      ),
    )
    await atCheckpoint(delivery.promise, `warm snapshot delivery`)
    await atCheckpoint(Promise.resolve(loading), `warm snapshot completion`)
  }, [
    () => collection.cleanup(),
    () => http.close(),
    () => spy.mockRestore(),
    () => expect(http.activeCount()).toBe(0),
  ])
})

async function checkMembership(
  leftWidth: number,
  rightWidth: number,
  cycles: number,
  dropMoveIn = false,
) {
  const http = controlledHttp()
  let delivery = deferred<void>()
  const subscribe = ShapeStream.prototype.subscribe
  const spy = vi
    .spyOn(ShapeStream.prototype, `subscribe`)
    .mockImplementation(function (this: ShapeStream, callback, onError) {
      return subscribe.call(
        this,
        (messages) => {
          const result = callback(
            dropMoveIn
              ? messages.filter(
                  (message) => message.headers.event !== `move-in`,
                )
              : messages,
          )
          delivery.resolve()
          return result
        },
        onError,
      )
    })
  const collection = createCollection(
    electricCollectionOptions<Item>({
      id: `sdk-membership-${++sequence}`,
      shapeOptions: {
        url: `http://test-url/membership-${sequence}`,
        params: { table: `rows` },
        fetchClient: http.fetchClient,
      },
      startSync: true,
      getKey: (row) => row.id,
    }),
  )
  // A fixed OR of two AND groups. The expected state is just a bit set,
  // independent of the adapter's tag indexes and mutable DNF arrays.
  const width = leftWidth + rightWidth
  const left = (1 << leftWidth) - 1
  const right = ((1 << width) - 1) ^ left
  let active = left | right
  const groups = [left, right]
  const hashes = Array.from({ length: width }, (_unused, pos) => `hash_${pos}`)
  let offset = 0
  async function send(message: unknown, label: string) {
    delivery = deferred<void>()
    const request = await atCheckpoint(http.take(), `membership request`)
    request.respond(
      new Response(
        JSON.stringify([
          message,
          {
            headers: {
              control: `up-to-date`,
              global_last_seen_lsn: String(++offset),
            },
          },
        ]),
        { headers: headers(offset) },
      ),
    )
    await atCheckpoint(delivery.promise, `membership delivery`)
    const visible = groups.some((group) => (active & group) === group)
    expect(
      collection.toArray.map(({ id, name }) => ({ id, name })),
      label,
    ).toEqual(visible ? [{ id: 1, name: `member` }] : [])
  }
  async function move(
    event: `move-in` | `move-out`,
    pos: number,
    label: string,
  ) {
    if (event === `move-in`) active |= 1 << pos
    else active &= ~(1 << pos)
    await send(
      { headers: { event, patterns: [{ pos, value: hashes[pos] }] } },
      label,
    )
  }
  return withElectricCleanup(async () => {
    await send(
      {
        key: `1`,
        value: { id: `1`, name: `member` },
        headers: {
          operation: `insert`,
          tags: groups.map((group) =>
            hashes
              .map((hash, pos) => (group & (1 << pos) ? hash : ``))
              .join(`/`),
          ),
          active_conditions: hashes.map(() => true),
        },
      },
      `initial membership`,
    )
    // This is the supported move-out/in/out cycle in tags.test.ts. Both
    // disjuncts retain at least one live alternative until the final deletion;
    // no move-in is used to resurrect a row whose tag index was removed.
    for (let cycle = 0; cycle < cycles; cycle++) {
      await move(`move-out`, 0, `left inactive`)
      await move(`move-in`, 0, `silent left reactivation`)
      await move(`move-out`, leftWidth, `after silent move-in`)
      await move(`move-in`, leftWidth, `silent right reactivation`)
    }
    await move(`move-out`, 0, `one disjunct remains`)
    await move(`move-out`, leftWidth, `all disjuncts inactive`)
    await atCheckpoint(http.take(), `pending membership poll`)
  }, [
    () => collection.cleanup(),
    () => {
      expect(http.activeCount()).toBe(0)
    },
    () => http.close(),
    () => {
      spy.mockRestore()
    },
    () => {
      expect(http.activeCount()).toBe(0)
    },
  ])
}

it(`preserves DNF visibility through installed-SDK silent move-in cycles`, async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 2 }),
      fc.integer({ min: 1, max: 2 }),
      fc.integer({ min: 1, max: 3 }),
      (left, right, cycles) => checkMembership(left, right, cycles),
    ),
    {
      seed: 20260918,
      ...oraclePropertyOptions(12, `electric.sdk-dnf-membership`),
    },
  )
})

it(`detects dropped silent reactivation on the later move-out`, async () => {
  await expect(checkMembership(1, 1, 1, true)).rejects.toMatchObject({
    name: `AssertionError`,
    message: expect.stringContaining(`after silent move-in`),
  })
})
