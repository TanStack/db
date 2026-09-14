import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DbClient } from '@tanstack/db'
import { endpointRuntime, type Todo } from '../src/runtime'
import {
  registerQuery,
  refreshRegisteredMutation,
} from '../src/registry.server'

const row = (text: string): Todo => ({
  id: 'row',
  text,
  completed: false,
  createdAt: new Date('2026-01-01'),
})
const model = (relation: string) => ({
  relation,
  order: ['id'] as const,
  membership: { kind: 'all' as const },
})
const envelope = (snapshots: unknown[], unaffected: unknown[]) => ({
  kind: 'confirmed',
  handler: { kind: 'success', result: null },
  snapshots,
  unaffected,
})

test('an unchanged optimistic value still executes and reconciles the server mutation', async () => {
  const core = new DbClient({ endpointScope: 'alice' }),
    client = endpointRuntime(core)
  const a = client.bindQuery('a', async () => [row('old')], model('a'))
  await a.preload()
  let calls = 0
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    const action = client.bindMutation(
      'noop-guess',
      async () => {
        calls++
        await held
        return envelope([{ id: 'a', rows: [row('server correction')] }], [])
      },
      () =>
        a.update('row', (draft) => {
          draft.text = 'old'
        }),
    )
    const tx = action({})
    assert.equal(tx.mutations.length, 0)
    assert.equal(tx.state, 'persisting')
    assert.equal(calls, 1)
    release()
    await tx.isPersisted.promise
    assert.equal(a.get('row')!.text, 'server correction')
  } finally {
    release()
    await core.cleanup()
  }
})

test('selective authority retires optimism while leaving unrelated external writes undiscovered', async () => {
  const core = new DbClient({ endpointScope: 'alice' }),
    client = endpointRuntime(core)
  const server = { a: row('a'), b: row('b') }
  const counts = { a: 0, b: 0 }
  const read = (id: 'a' | 'b') => async () => {
    counts[id]++
    return [{ ...server[id] }]
  }
  const registry = {
    a: registerQuery('fixture', 'a', (x) => x, read('a'), undefined, [
      'primary/public/a',
    ]),
    b: registerQuery('fixture', 'b', (x) => x, read('b'), undefined, [
      'primary/public/b',
    ]),
  }
  const a = client.bindQuery('a', read('a'), model('a'))
  const b = client.bindQuery('b', read('b'), model('b'))
  await Promise.all([a.preload(), b.preload()])
  const before = { ...counts }
  let unrelatedBatches = 0
  const writeBatch = b.utils.writeBatch
  b.utils.writeBatch = (callback) => {
    unrelatedBatches++
    writeBatch(callback)
  }
  try {
    server.b = row('external')
    const action = client.bindMutation(
      'edit',
      ({ data }) =>
        refreshRegisteredMutation(
          data.reads!,
          registry,
          async () => {
            server.a = row('corrected')
          },
          { scope: data.scope },
          () => ['primary/public/a'],
        ),
      () =>
        a.update('row', (draft) => {
          draft.text = 'guess'
        }),
    )
    const tx = action({})
    assert.equal(a.get('row')!.text, 'guess')
    await tx.isPersisted.promise
    assert.equal(a.get('row')!.text, 'corrected')
    assert.equal(b.get('row')!.text, 'b')
    assert.deepEqual(counts, { a: before.a + 1, b: before.b })
    assert.equal(unrelatedBatches, 0, 'unaffected rows are not reinstalled')
    await b.utils.refetch({ throwOnError: true })
    assert.equal(b.get('row')!.text, 'external')
  } finally {
    await core.cleanup()
  }
})

test('unaffected responses cannot omit, duplicate, invent, or skip optimistic targets', async () => {
  for (const reply of [
    envelope([], [{ id: 'a' }, { id: 'b' }]),
    envelope([{ id: 'a', rows: [row('new')] }], []),
    envelope([{ id: 'a', rows: [row('new')] }], [{ id: 'b' }, { id: 'b' }]),
    envelope([{ id: 'a', rows: [row('new')] }], [{ id: 'unknown' }]),
    envelope(
      [
        { id: 'a', rows: [row('new')] },
        { id: 'b', rows: [row('new')] },
      ],
      [{ id: 'b' }],
    ),
  ]) {
    const core = new DbClient({ endpointScope: 'alice' }),
      client = endpointRuntime(core)
    const a = client.bindQuery('a', async () => [row('old')], model('a'))
    const b = client.bindQuery('b', async () => [row('old')], model('b'))
    await Promise.all([a.preload(), b.preload()])
    try {
      const action = client.bindMutation(
        'bad',
        async () => reply,
        () =>
          a.update('row', (draft) => {
            draft.text = 'guess'
          }),
      )
      await assert.rejects(
        action({}).isPersisted.promise,
        /authoritative endpoint response/,
      )
      assert.equal(a.get('row')!.text, 'old')
      assert.equal(b.get('row')!.text, 'old')
    } finally {
      await core.cleanup()
    }
  }
})

test('overlapping selective responses still require a fresh read after both handlers close', async () => {
  const core = new DbClient({ endpointScope: 'alice' }),
    client = endpointRuntime(core)
  const server = { a: 'old-a', b: 'old-b' }
  const a = client.bindQuery('a', async () => [row(server.a)], model('a'))
  const b = client.bindQuery('b', async () => [row(server.b)], model('b'))
  await Promise.all([a.preload(), b.preload()])
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    const first = client.bindMutation(
      'first',
      async () => {
        await held
        return envelope([{ id: 'a', rows: [row('stale-a')] }], [{ id: 'b' }])
      },
      () =>
        a.update('row', (draft) => {
          draft.text = 'guess-a'
        }),
    )({})
    const second = client.bindMutation(
      'second',
      async () => {
        server.a = 'latest-a'
        server.b = 'latest-b'
        return envelope([{ id: 'b', rows: [row('latest-b')] }], [{ id: 'a' }])
      },
      () =>
        b.update('row', (draft) => {
          draft.text = 'guess-b'
        }),
    )({})
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(second.state, 'persisting')
    release()
    await Promise.all([first.isPersisted.promise, second.isPersisted.promise])
    assert.equal(a.get('row')!.text, 'latest-a')
    assert.equal(b.get('row')!.text, 'latest-b')
  } finally {
    release()
    await core.cleanup()
  }
})
