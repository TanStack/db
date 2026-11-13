import { createCollection, createLiveQueryCollection, eq } from '@tanstack/db'
import { afterEach, expect, it, vi } from 'vitest'
import {
  PowerSyncClient,
  StreamError,
  powerSyncCollectionOptions,
} from '../src/index.js'
import { createSubsetHandlers } from '../src/subsets.js'
import { FakeService } from './fake-service'
import type { StreamSubscription } from '../src/index.js'

type Task = { id: string; title: string; board?: string }

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

function setup() {
  const service = new FakeService()
  const client = new PowerSyncClient({
    endpoint: 'http://localhost:8080',
    getToken: () => 'token',
    fetch: service.fetch,
    retryDelayMs: 1,
  })
  return { service, client }
}

function tasks(
  client: PowerSyncClient,
  options: { streams?: Array<StreamSubscription>; table?: string } = {},
) {
  const collection = createCollection(
    powerSyncCollectionOptions<Task>({
      client,
      table: options.table ?? 'tasks',
      streams: options.streams ?? [{ name: 'tasks' }],
      parse: (row) => row as Task,
    }),
  )
  cleanups.push(() => collection.cleanup())
  return collection
}

it('syncs rows of its table once a checkpoint completes', async () => {
  const { service, client } = setup()
  const collection = tasks(client, {
    streams: [{ name: 'tasks', parameters: { board: 'work' } }],
  })
  const ready = collection.preload()

  await service.waitForRequest(1)
  expect(service.lastRequest.streams).toEqual({
    include_defaults: false,
    subscriptions: [
      {
        stream: 'tasks',
        parameters: { board: 'work' },
        override_priority: null,
      },
    ],
  })

  service.checkpoint(['a'])
  service.put('a', 'tasks', '1', { title: 'first' })
  service.put('a', 'other', '1', { title: 'ignored' })
  await new Promise((r) => setTimeout(r, 10))
  expect(collection.size).toBe(0)

  service.complete()
  await ready
  expect(collection.toArray).toMatchObject([{ id: '1', title: 'first' }])
  expect(client.status.state).toBe('ready')

  await collection.cleanup()
  expect(service.aborted).toBe(true)
  expect(client.status.state).toBe('idle')
})

it('shares one connection, requesting the union of streams', async () => {
  const { service, client } = setup()
  const first = tasks(client, { streams: [{ name: 'tasks' }] })
  const second = tasks(client, { streams: [{ name: 'lists' }], table: 'lists' })
  const ready = Promise.all([first.preload(), second.preload()])

  await service.waitForRequest(1)
  expect(
    service.lastRequest.streams.subscriptions.map((s: any) => s.stream),
  ).toEqual(['tasks', 'lists'])
  service.checkpoint(['a', 'b'])
  service.put('a', 'tasks', '1', { title: 'task' })
  service.put('b', 'lists', '1', { title: 'list' })
  service.complete()
  await ready
  expect(first.get('1')?.title).toBe('task')
  expect(second.get('1')?.title).toBe('list')

  // A new collection on an already-synced table starts with the cached rows.
  const third = tasks(client, { streams: [] })
  await third.preload()
  expect(third.get('1')?.title).toBe('task')

  // Stopping a collection restarts with the remaining streams, resuming buckets.
  await second.cleanup()
  await service.waitForRequest(2)
  expect(
    service.lastRequest.streams.subscriptions.map((s: any) => s.stream),
  ).toEqual(['tasks'])
  expect(service.lastRequest.buckets).toEqual([
    { name: 'a', after: '1' },
    { name: 'b', after: '2' },
  ])
})

it('can request default streams', async () => {
  const { service, client } = setup()
  const collection = createCollection(
    powerSyncCollectionOptions<Task>({
      client,
      table: 'tasks',
      streams: [],
      includeDefaultStreams: true,
      parse: (row) => row as Task,
    }),
  )
  cleanups.push(() => collection.cleanup())
  const ready = collection.preload()

  await service.waitForRequest(1)
  expect(service.lastRequest.streams).toEqual({
    include_defaults: true,
    subscriptions: [],
  })
  service.checkpoint(['a'])
  service.put('a', 'tasks', '1', { title: 'task' })
  service.complete()

  await ready
})

it('reports rows from streams requested by other collections', async () => {
  const { service, client } = setup()
  const requesting = tasks(client, {
    streams: [{ name: 'everything' }],
    table: 'lists',
  })
  const passive = tasks(client, { streams: [] })
  const ready = Promise.all([requesting.preload(), passive.preload()])

  await service.waitForRequest(1)
  service.sync('a', 'tasks', { '1': { title: 'from another stream' } })
  await ready
  expect(passive.get('1')?.title).toBe('from another stream')
  expect(requesting.size).toBe(0)

  service.checkpoint(['a'])
  service.remove('a', 'tasks', '1')
  service.complete()
  await vi.waitFor(() => expect(passive.size).toBe(0))
})

it('requests streams for on-demand subsets', async () => {
  const { service, client } = setup()
  const getSubscriptions = vi.fn(() => [
    { name: 'board', parameters: { board: 'work' } },
  ])
  const collection = createCollection(
    powerSyncCollectionOptions<Task>({
      client,
      table: 'tasks',
      getSubscriptions,
      parse: (row) => row as Task,
    }),
  )
  cleanups.push(() => collection.cleanup())
  await collection.preload()

  const live = createLiveQueryCollection((q) =>
    q.from({ task: collection }).where(({ task }) => eq(task.board, 'work')),
  )
  let loaded = false
  const preload = live.preload().then(() => (loaded = true))

  await vi.waitFor(() => expect(getSubscriptions).toHaveBeenCalled())
  await vi.waitFor(() =>
    expect(service.lastRequest.streams.subscriptions).toHaveLength(1),
  )
  const requests = service.requests.length
  service.sync('a', 'tasks', { '1': { title: 'task', board: 'work' } })
  await preload
  expect(loaded).toBe(true)
  expect(live.toArray.map((t) => t.title)).toEqual(['task'])

  await live.cleanup()
  await service.waitForRequest(requests + 1)
  expect(service.lastRequest.streams.subscriptions).toEqual([])
})

it('confirms writes once the requested checkpoint is applied', async () => {
  const { service, client } = setup()
  const collection = tasks(client)
  const ready = collection.preload()
  await service.waitForRequest(1)
  service.sync('a', 'tasks', { '1': { title: 'before' } })
  await ready

  let confirmed = false
  const confirmation = collection.utils
    .confirmWrites()
    .then(() => (confirmed = true))
  await vi.waitFor(() => expect(service.checkpointRequests).toHaveLength(1))
  expect(service.checkpointRequests[0]).toMatchObject({
    checkpoint_request_id: '1',
  })

  // A checkpoint without the write checkpoint is not applied.
  service.sync('a', 'tasks', { '1': { title: 'stale' } })
  await new Promise((r) => setTimeout(r, 10))
  expect(confirmed).toBe(false)
  expect(collection.get('1')?.title).toBe('before')

  service.sync(
    'a',
    'tasks',
    { '1': { title: 'after' } },
    { writeCheckpoint: '1' },
  )
  await confirmation
  expect(collection.get('1')?.title).toBe('after')
})

it('confirms writes if the checkpoint is synced before the checkpoint request responds', async () => {
  const { service, client } = setup()
  const collection = tasks(client)
  const ready = collection.preload()
  await service.waitForRequest(1)
  service.sync('a', 'tasks', { '1': { title: 'before' } })
  await ready

  service.beforeCheckpointResponse = async () => {
    service.sync(
      'a',
      'tasks',
      { '1': { title: 'after' } },
      { writeCheckpoint: '1' },
    )
    await vi.waitFor(() => expect(collection.get('1')?.title).toBe('after'))
  }

  // There is no further checkpoint, so this relies on re-checking the last one.
  await collection.utils.confirmWrites()
})

it('resumes buckets after reconnecting and handles bucket resets', async () => {
  const { service, client } = setup()
  const collection = tasks(client)
  const ready = collection.preload()
  await service.waitForRequest(1)
  service.sync('a', 'tasks', { '1': { title: 'one' }, '2': { title: 'two' } })
  await ready

  service.close()
  await service.waitForRequest(2)
  expect(service.lastRequest.buckets).toEqual([{ name: 'a', after: '2' }])

  // Re-sending an operation id that was already seen resets bucket state, re-downloading from scratch.
  service.checkpoint(['a'])
  service.data('a', [
    { op: 'PUT', object_type: 'tasks', object_id: '1', data: '{}', op_id: '1' },
  ])
  await service.waitForRequest(3)
  expect(service.lastRequest.buckets).toEqual([])

  // Row 2 is no longer part of the bucket, so it should be removed.
  service.sync('a', 'tasks', { '1': { title: 'one' } })
  await vi.waitFor(() => expect(collection.size).toBe(1))
  expect(collection.get('1')?.title).toBe('one')
})

it('fails the first load of collections whose streams have errors', async () => {
  const { service, client } = setup()
  const failing = tasks(client, { streams: [{ name: 'invalid' }] })
  const working = tasks(client, {
    streams: [{ name: 'valid' }],
    table: 'lists',
  })
  const failed = failing.preload()
  const ready = working.preload()

  await service.waitForRequest(1)
  service.checkpoint([], {
    streams: [
      {
        name: 'invalid',
        is_default: false,
        errors: [{ subscription: 0, message: 'bad parameters' }],
      },
      { name: 'valid', is_default: false, errors: [] },
    ],
  })
  service.complete()

  await expect(failed).rejects.toThrow(StreamError)
  expect(failing.status).toBe('error')

  // The failed collection released its stream, so the client reconnects without it.
  await service.waitForRequest(2)
  expect(
    service.lastRequest.streams.subscriptions.map((s: any) => s.stream),
  ).toEqual(['valid'])
  service.sync('b', 'lists', {})
  await ready
  const error = failing.health.error?.cause as StreamError
  expect(error.stream.name).toBe('invalid')
  expect(error.messages).toEqual(['bad parameters'])
  expect(working.health.hasErrors).toBe(false)
})

it('reports connection errors after the first load until a checkpoint is applied', async () => {
  const { service, client } = setup()
  const collection = tasks(client)
  const ready = collection.preload()
  await service.waitForRequest(1)
  service.sync('a', 'tasks', { '1': { title: 'one' } })
  await ready

  service.close()
  await vi.waitFor(() => expect(collection.health.failureReason).not.toBeNull())
  expect(collection.health.failureReason?.message).toMatch('Sync stream ended')
  expect(collection.status).toBe('ready')

  await service.waitForRequest(2)
  service.sync('a', 'tasks', {})
  await vi.waitFor(() => expect(collection.health.failureReason).toBeNull())
  expect(collection.get('1')?.title).toBe('one')
})

it('reports a stream error once while it persists, and clears it once resolved', async () => {
  const { service, client } = setup()
  const collection = tasks(client)
  const ready = collection.preload()
  await service.waitForRequest(1)
  service.sync('a', 'tasks', { '1': { title: 'one' } })
  await ready

  const failingCheckpoint = () => {
    service.checkpoint(['a'], {
      streams: [
        {
          name: 'tasks',
          is_default: false,
          errors: [{ subscription: 0, message: 'revoked' }],
        },
      ],
    })
    service.complete()
  }

  // A checkpoint that fails this collection's stream does not end the
  // connection outage either.
  service.close()
  await service.waitForRequest(2)
  failingCheckpoint()
  await vi.waitFor(() => {
    const errors = collection.health.failureReason?.errors ?? []
    expect(errors.map((e) => e.cause)).toEqual([
      expect.objectContaining({ message: 'Sync stream ended; reconnecting' }),
      expect.any(StreamError),
    ])
  })
  const reported = collection.health.failureReason!.errors

  // The client repeats the error with each checkpoint and reconnect, which
  // is not a new failure.
  failingCheckpoint()
  service.close()
  await service.waitForRequest(3)
  failingCheckpoint()
  await new Promise((r) => setTimeout(r, 10))
  expect(collection.health.failureReason?.errors).toEqual(reported)

  service.close()
  await service.waitForRequest(4)
  service.sync('a', 'tasks', {})
  await vi.waitFor(() => expect(collection.health.failureReason).toBeNull())
  expect(collection.status).toBe('ready')
})

it('stops syncing when rows cannot be parsed', async () => {
  const { service, client } = setup()
  const collection = createCollection(
    powerSyncCollectionOptions<Task>({
      client,
      table: 'tasks',
      streams: [{ name: 'tasks' }],
      parse: (row) => {
        if (typeof row.title !== 'string') throw new Error('missing title')
        return row as Task
      },
    }),
  )
  cleanups.push(() => collection.cleanup())
  const ready = collection.preload()
  await service.waitForRequest(1)
  service.sync('a', 'tasks', { '1': { title: 'one' } })
  await ready

  service.sync('a', 'tasks', { '2': {} })
  await vi.waitFor(() =>
    expect(collection.health.error?.message).toBe('missing title'),
  )
  expect(collection.status).toBe('ready')
  expect(collection.toArray.map((t) => t.id)).toEqual(['1'])
  // The collection released its streams and listener, ending the sync request.
  expect(service.aborted).toBe(true)
  expect(client.status.state).toBe('idle')
})

it('reports stream errors of loaded subsets until they are unloaded', async () => {
  const { service, client } = setup()
  const collection = createCollection(
    powerSyncCollectionOptions<Task>({
      client,
      table: 'tasks',
      getSubscriptions: () => [
        { name: 'board', parameters: { board: 'work' } },
      ],
      parse: (row) => row as Task,
    }),
  )
  cleanups.push(() => collection.cleanup())
  await collection.preload()

  const live = createLiveQueryCollection((q) =>
    q.from({ task: collection }).where(({ task }) => eq(task.board, 'work')),
  )
  const loaded = live.preload()
  await vi.waitFor(() =>
    expect(service.lastRequest.streams.subscriptions).toHaveLength(1),
  )
  service.sync('a', 'tasks', { '1': { title: 'task', board: 'work' } })
  await loaded

  service.checkpoint(['a'], {
    streams: [
      {
        name: 'board',
        is_default: false,
        errors: [{ subscription: 0, message: 'revoked' }],
      },
    ],
  })
  service.complete()
  await vi.waitFor(() =>
    expect(collection.health.failureReason?.cause).toBeInstanceOf(StreamError),
  )

  await live.cleanup()
  expect(collection.health.failureReason).toBeNull()
})

it('serializes loads of the same subset options, releasing one acquisition', async () => {
  const { service, client } = setup()
  const handlers = createSubsetHandlers(
    client,
    () => [{ name: 'board', parameters: { board: 'work' } }],
    () => true,
    { onError: () => {}, onRelease: () => {} },
  )
  cleanups.push(async () => handlers.cleanup())
  const options = {}
  const first = handlers.loadSubset!(options)
  const second = handlers.loadSubset!(options)
  await vi.waitFor(() =>
    expect(service.lastRequest.streams.subscriptions).toHaveLength(1),
  )
  service.sync('a', 'tasks', {})
  await Promise.all([first, second])

  // Without leases or listeners, the client disconnects.
  handlers.unloadSubset!(options)
  await vi.waitFor(() => expect(client.status.state).toBe('idle'))
  expect(service.aborted).toBe(true)
})
