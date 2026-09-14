import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  registerQuery,
  refreshRegisteredMutation,
} from '../src/registry.server.ts'

const token = (result, id) =>
  result.certificates?.find((entry) => entry.id === id)?.certificate
function fixture() {
  const revisions = { a: 0, b: 0 }
  const calls = { a: 0, b: 0 }
  const registry = Object.fromEntries(
    ['a', 'b'].map((id) => [
      id,
      registerQuery(
        'v1',
        id,
        (value) => value,
        async () => {
          calls[id]++
          return [{ id, value: revisions[id] }]
        },
        async () => String(revisions[id]),
      ),
    ]),
  )
  const requests = ['a', 'b'].map((id) => ({
    id,
    definition: id,
    version: 'v1',
    params: {},
  }))
  const run = (reads = requests, mutate = async () => {}) =>
    refreshRegisteredMutation(reads, registry, mutate, { scope: 'alice' })
  return { revisions, calls, registry, requests, run }
}

test('only a server-issued baseline with unchanged complete dependencies skips a read', async () => {
  const f = fixture()
  const first = await f.run()
  assert.equal((first.certificates ?? []).length, 2)
  const requests = f.requests.map((r) => ({
    ...r,
    certificate: token(first, r.id),
  }))
  f.revisions.a++
  const next = await f.run(requests)
  assert.deepEqual(f.calls, { a: 2, b: 1 })
  assert.deepEqual(next.unchanged, [
    { id: 'b', certificate: token(first, 'b') },
  ])
  assert.deepEqual(next.snapshots, [{ id: 'a', rows: [{ id: 'a', value: 1 }] }])
})

test('unknown, cross-scope, cross-instance and expired baselines refresh', async () => {
  const f = fixture(),
    first = await f.run()
  const wrong = f.requests.map((r) => ({
    ...r,
    certificate: token(first, 'a') ?? 'missing',
  }))
  await refreshRegisteredMutation(wrong, f.registry, async () => {}, {
    scope: 'bob',
  })
  assert.deepEqual(f.calls, { a: 2, b: 2 })
  await f.run(wrong)
  assert.deepEqual(f.calls, { a: 2, b: 3 })
  await f.run(
    f.requests.map((r) => ({ ...r, certificate: 'evicted-or-forged' })),
  )
  assert.deepEqual(f.calls, { a: 3, b: 4 })
})

test('unknown dependencies refresh and cannot reuse an older certificate', async () => {
  let stamp = '0',
    reads = 0
  const registry = {
    a: registerQuery(
      'v1',
      'a',
      (x) => x,
      async () => {
        reads++
        return []
      },
      async () => stamp,
    ),
  }
  const request = { id: 'a', definition: 'a', version: 'v1', params: {} }
  const run = (certificate) =>
    refreshRegisteredMutation(
      [{ ...request, certificate }],
      registry,
      async () => {},
      { scope: 'alice' },
    )
  const first = await run()
  stamp = undefined
  const second = await run(token(first, 'a'))
  assert.equal(reads, 2)
  assert.equal(token(second, 'a'), undefined)
  assert.equal(second.unchanged?.length ?? 0, 0)
})

test('a revision is captured before its rows, never after them', async () => {
  let revision = 0,
    reads = 0
  const registry = {
    a: registerQuery(
      'v1',
      'a',
      (x) => x,
      async () => {
        reads++
        const rows = [{ id: 'a', revision }]
        revision++
        return rows
      },
      async () => String(revision),
    ),
  }
  const request = { id: 'a', definition: 'a', version: 'v1', params: {} }
  const first = await refreshRegisteredMutation(
    [request],
    registry,
    async () => {},
    { scope: 'alice' },
  )
  await refreshRegisteredMutation(
    [{ ...request, certificate: token(first, 'a') }],
    registry,
    async () => {},
    { scope: 'alice' },
  )
  assert.equal(reads, 2, 'a later stamp would falsely certify old rows')
})

test('evicting a server baseline only forces a full read', async () => {
  const f = fixture(),
    first = await f.run()
  for (let i = 0; i < 501; i++) await f.run()
  const before = { ...f.calls }
  await f.run(
    f.requests.map((r) => ({ ...r, certificate: token(first, r.id) })),
  )
  assert.deepEqual(f.calls, { a: before.a + 1, b: before.b + 1 })
})

test('parameterized baseline identities survive the actual transport serializer', async () => {
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
  const id = '["query",{"completed":false}]'
  const query = registerQuery(
    'v1',
    'todo',
    (x) => x,
    async () => [],
    async () => '0',
  )
  const result = await refreshRegisteredMutation(
    [{ id, definition: 'query', version: 'v1', params: { completed: false } }],
    { query },
    async () => {},
    { scope: 'alice' },
  )
  const copy = fromJSON(toJSON(result))
  assert.equal(
    Array.isArray(copy.certificates)
      ? copy.certificates[0].id
      : Object.keys(copy.certificates)[0],
    id,
  )
})
