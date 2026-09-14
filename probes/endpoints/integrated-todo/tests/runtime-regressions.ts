import { z } from 'zod'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DbClient } from '@tanstack/db'
import { endpointRuntime, type Todo } from '../src/runtime'
import { refreshAfterMutation } from '../src/refresh.server'
import './authority-regressions'
import './dependency-regressions'
const model = {
  relation: 'todo',
  order: ['id'] as const,
  membership: { kind: 'all' as const },
}
const row = (id: string): Todo => ({
  id,
  text: 'value',
  completed: false,
  createdAt: new Date('2026-01-01'),
})
const plain = ({ id, text, completed, createdAt }: Todo) => ({
  id,
  text,
  completed,
  createdAt,
})
const runtime = () => endpointRuntime(new DbClient({ endpointScope: 'alice' }))
const confirmed = (snapshots: unknown) => ({
  kind: 'confirmed',
  handler: { kind: 'success', result: null },
  snapshots,
})
test('endpoint refetch discovers external writes without a mutation', async () => {
  const client = runtime()
  let server = [row('original')]
  let reads = 0
  const collection = client.bindQuery('external', async () => {
    reads++
    return server.map((item) => ({ ...item }))
  }, model)
  await collection.preload()
  try {
    const initialReads = reads
    server = [{ ...row('external'), text: 'written elsewhere' }]
    assert.deepEqual([...collection.values()].map(plain), [row('original')])
    await collection.utils.refetch({ throwOnError: true })
    assert.equal(reads, initialReads + 1)
    assert.deepEqual([...collection.values()].map(plain), server)
    assert.equal(client.lastTransaction, undefined)
    assert.equal(client.readErrors.size, 0)
  } finally {
    await collection.cleanup()
  }
})
test('authority is installed before a post-commit handler error retires the overlay', async () => {
  const client = runtime(),
    server: Todo[] = []
  let reads = 0
  const read = async () => {
    reads++
    return [...server]
  }
  const collection = client.bindQuery('all', read, model)
  await collection.preload()
  try {
    const action = client.bindMutation(
      'insert',
      async ({ data }) =>
        refreshAfterMutation(data.reads!, { all: read }, async () => {
          server.push({ ...row('committed'), text: 'server correction' })
          throw Error('post-write failure')
        }),
      () => collection.insert(row('committed')),
    )
    const tx = action({})
    assert.equal(collection.get('committed')!.text, 'value')
    await assert.rejects(tx.isPersisted.promise, /post-write failure/)
    assert.deepEqual([...collection.values()].map(plain), server)
    assert.equal(reads, 2)
    assert.equal(client.readErrors.size, 0)
  } finally {
    await collection.cleanup()
  }
})
test('client ordering and optimistic inserts match PostgreSQL C order for Unicode IDs', async () => {
  const order: string[] = JSON.parse(process.argv[2])
  const client = runtime()
  const collection = client.bindQuery(
    'unicode',
    async () => order.slice(1).map(row),
    model,
  )
  await collection.preload()
  try {
    assert.deepEqual([...collection.keys()], order.slice(1))
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const action = client.bindMutation(
      'insert',
      async () => {
        await held
        return confirmed([{ id: 'unicode', rows: order.map(row) }])
      },
      () => collection.insert(row(order[0]!)),
    )
    const tx = action({})
    assert.deepEqual([...collection.keys()], order)
    release()
    await tx.isPersisted.promise
    assert.deepEqual([...collection.keys()], order)
  } finally {
    await collection.cleanup()
  }
})
test('malformed authority rejects before installing any collection snapshot', async () => {
  for (const malformed of [
    null,
    confirmed([
      { id: 'a', rows: [row('new')] },
      { id: 'b', rows: [row('dup'), row('dup')] },
    ]),
    confirmed([
      { id: 'a', rows: [row('new')] },
      { id: 'b', rows: [{ ...row('bad'), completed: 'false' }] },
    ]),
    confirmed([{ id: 'a', rows: [row('new')] }]),
    confirmed([
      { id: 'a', rows: [row('new')] },
      { id: 'a', rows: [] },
    ]),
  ]) {
    const client = runtime()
    const a = client.bindQuery('a', async () => [row('old')], model)
    const b = client.bindQuery('b', async () => [row('old')], model)
    await Promise.all([a.preload(), b.preload()])
    try {
      const action = client.bindMutation(
        'edit',
        async () => malformed,
        () =>
          a.update('old', (draft) => {
            draft.text = 'guess'
          }),
      )
      await assert.rejects(
        action({}).isPersisted.promise,
        /authoritative endpoint response/,
      )
      assert.deepEqual([...a.values()].map(plain), [row('old')])
      assert.deepEqual([...b.values()].map(plain), [row('old')])
      assert.equal(client.readErrors.size, 2)
    } finally {
      await Promise.all([a.cleanup(), b.cleanup()])
    }
  }
})

test('generated invalid snapshots cannot partly replace the confirmed baseline', async () => {
  const fc = await import('fast-check')
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        fault: fc.constantFrom(
          'duplicate-row',
          'missing-query',
          'extra-query',
          'invalid-value',
        ),
        text: fc.string(),
        invalidLast: fc.boolean(),
      }),
      async ({ fault, text, invalidLast }) => {
        const client = runtime()
        const a = client.bindQuery('a', async () => [row('old')], model)
        const b = client.bindQuery('b', async () => [row('old')], model)
        await Promise.all([a.preload(), b.preload()])
        const snapshots: Array<{ id: string; rows: unknown[] }> = [
          'a',
          'b',
        ].map((id) => ({ id, rows: [{ ...row('new'), text }] }))
        const damaged = snapshots[invalidLast ? 1 : 0]!
        if (fault === 'duplicate-row')
          damaged.rows.push({ ...row('new'), text })
        if (fault === 'missing-query') snapshots.splice(invalidLast ? 1 : 0, 1)
        if (fault === 'extra-query')
          snapshots.push({ id: 'unexpected', rows: [] })
        if (fault === 'invalid-value')
          damaged.rows = [{ ...row('new'), completed: 0 }]
        try {
          const action = client.bindMutation(
            'edit',
            async () => confirmed(snapshots),
            () =>
              a.update('old', (draft) => {
                draft.text = 'guess'
              }),
          )
          await assert.rejects(
            action({}).isPersisted.promise,
            /authoritative endpoint response/,
          )
          assert.deepEqual([...a.values()].map(plain), [row('old')])
          assert.deepEqual([...b.values()].map(plain), [row('old')])
          assert.equal(client.readErrors.size, 2)
        } finally {
          await Promise.all([a.cleanup(), b.cleanup()])
        }
      },
    ),
    { numRuns: 100, seed: 912026 },
  )
})

test('non-fixture scopes reconcile application rows without Todo fields', async () => {
  const client = endpointRuntime(
    new DbClient({ endpointScope: 'kitchen-session' }),
  )
  const initial = {
    id: 'ingredient',
    name: 'Flour',
    count: 1,
    expires: new Date('2027-01-01'),
  }
  let server = [initial]
  const collection = client.bindQuery(
    'ingredients',
    async () => server,
    {
      relation: 'ingredients',
      order: ['id'],
      membership: { kind: 'all' },
    },
    {},
    'application',
    z.object({
      id: z.string(),
      name: z.string(),
      count: z.number(),
      expires: z.date(),
    }),
  )
  await collection.preload()
  try {
    const action = client.bindMutation(
      'count',
      async () => {
        server = [{ ...initial, count: 3 }]
        return confirmed([{ id: 'ingredients', rows: server }])
      },
      () =>
        collection.update('ingredient', (draft) => {
          draft.count = 2
        }),
    )
    const tx = action({})
    assert.equal(collection.get('ingredient')!.count, 2)
    await tx.isPersisted.promise
    assert.deepEqual(
      [...collection.values()].map(({ id, name, count, expires }) => ({
        id,
        name,
        count,
        expires,
      })),
      server,
    )
    const malformed = client.bindMutation(
      'invalid-count',
      async () =>
        confirmed([
          { id: 'ingredients', rows: [{ ...initial, count: 'not a number' }] },
        ]),
      () =>
        collection.update('ingredient', (draft) => {
          draft.count = 4
        }),
    )
    await assert.rejects(
      malformed({}).isPersisted.promise,
      /authoritative endpoint response/,
    )
    assert.equal(collection.get('ingredient')!.count, 3)
  } finally {
    await collection.cleanup()
  }
})
