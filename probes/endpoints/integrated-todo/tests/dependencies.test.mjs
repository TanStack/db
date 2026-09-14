import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  registerQuery,
  refreshRegisteredMutation,
} from '../src/registry.server.ts'

const request = (id, extra = {}) => ({
  id,
  definition: id,
  version: 'v1',
  params: {},
  hasBaseline: true,
  optimistic: false,
  ...extra,
})
function fixture(
  dependencies = { a: ['primary/public/a'], b: ['primary/public/b'] },
) {
  const calls = []
  const registry = Object.fromEntries(
    Object.entries(dependencies).map(([id, reads]) => [
      id,
      registerQuery(
        'v1',
        id,
        (x) => x,
        async () => {
          calls.push(id)
          return [{ id }]
        },
        undefined,
        reads,
      ),
    ]),
  )
  return { calls, registry }
}

test('disjoint complete dependencies skip reads after the handler closes', async () => {
  const { calls, registry } = fixture()
  let closed = false
  const result = await refreshRegisteredMutation(
    [request('a'), request('b')],
    registry,
    async () => {
      closed = true
    },
    { scope: 'alice' },
    () => {
      assert.equal(closed, true)
      return ['primary/public/a']
    },
  )
  assert.deepEqual(calls, ['a'])
  assert.deepEqual(result.unaffected, [{ id: 'b' }])
  assert.deepEqual(result.snapshots, [{ id: 'a', rows: [{ id: 'a' }] }])
})

test('optimistic targets and missing baselines require authority even for disjoint writes', async () => {
  for (const extra of [
    { optimistic: true },
    { hasBaseline: false },
    { optimistic: undefined },
  ]) {
    const { calls, registry } = fixture()
    await refreshRegisteredMutation(
      [request('a', extra), request('b')],
      registry,
      async () => {},
      { scope: 'alice' },
      () => [],
    )
    assert.deepEqual(calls, ['a'])
  }
})

test('unknown read or write effects cannot establish disjointness', async () => {
  for (const writes of [
    undefined,
    () => null,
    () => {
      throw Error('cannot inspect effects')
    },
  ]) {
    const { calls, registry } = fixture()
    await refreshRegisteredMutation(
      [request('a'), request('b')],
      registry,
      async () => {},
      { scope: 'alice' },
      writes,
    )
    assert.deepEqual(calls.sort(), ['a', 'b'])
  }
  const { calls, registry } = fixture({ a: null, b: ['primary/public/b'] })
  await refreshRegisteredMutation(
    [request('a'), request('b')],
    registry,
    async () => {},
    { scope: 'alice' },
    () => ['primary/public/a'],
  )
  assert.deepEqual(calls, ['a'])
})

test('admission includes skipped instances and runs before writes', async () => {
  const { registry } = fixture()
  let writes = 0
  const result = await refreshRegisteredMutation(
    [request('a'), request('b', { version: 'old' })],
    registry,
    async () => {
      writes++
    },
    { scope: 'alice' },
    () => ['primary/public/a'],
  )
  assert.equal(result.kind, 'not-started')
  assert.equal(writes, 0)
})

test('partial commit errors still reconcile the complete write set', async () => {
  const { calls, registry } = fixture()
  const result = await refreshRegisteredMutation(
    [request('a'), request('b')],
    registry,
    async () => {
      throw Error('after commit')
    },
    { scope: 'alice' },
    () => ['primary/public/b'],
  )
  assert.deepEqual(calls, ['b'])
  assert.equal(result.handler.kind, 'error')
  assert.deepEqual(result.unaffected, [{ id: 'a' }])
})

test('multi-relation queries include auth dependencies and distinguish schema and authority', async () => {
  const { calls, registry } = fixture({
    join: ['primary/public/a', 'primary/public/b'],
    auth: ['primary/public/users', 'primary/public/b'],
    sameName: ['primary/archive/a'],
    otherDatabase: ['other/public/a'],
  })
  const result = await refreshRegisteredMutation(
    Object.keys(registry).map((id) => request(id)),
    registry,
    async () => {},
    { scope: 'alice' },
    () => ['primary/public/a', 'primary/public/users'],
  )
  assert.deepEqual(calls, ['join', 'auth'])
  assert.deepEqual(result.unaffected, [
    { id: 'sameName' },
    { id: 'otherDatabase' },
  ])
})

test('parameterized unaffected identities survive the application transport serializer', async () => {
  const { createRequire } = await import('node:module')
  const { realpathSync } = await import('node:fs')
  const require = createRequire(
    realpathSync(
      new URL(
        '../node_modules/@tanstack/react-start/package.json',
        import.meta.url,
      ),
    ),
  )
  const { toJSON, fromJSON } = require('seroval')
  const { registry } = fixture()
  const ids = [
    JSON.stringify(['a', { completed: false }]),
    JSON.stringify(['a', { completed: true }]),
  ]
  const result = await refreshRegisteredMutation(
    ids.map((id) => request(id, { definition: 'a' })),
    registry,
    async () => {},
    { scope: 'alice' },
    () => ['primary/public/b'],
  )
  assert.deepEqual(
    fromJSON(toJSON(result)).unaffected,
    ids.map((id) => ({ id })),
  )
})
