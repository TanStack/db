import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { DbClient } from '@tanstack/db'
import { endpointRuntime, type Todo } from '../../../../integrated-todo/src/runtime'
import { refreshAfterMutation } from '../../../../integrated-todo/src/refresh.server'

const model = { relation: 'todo', order: ['id'] as const, membership: { kind: 'all' as const } }
const row = (id: string, completed = false): Todo => ({ id, text: 'new', completed, createdAt: new Date('2026-01-01T00:00:00Z') })
const reports: Record<string, unknown> = {}

// Loaded, stable, one-query client; a nonempty coherent guess; no concurrency.
{
  const runtime = endpointRuntime(new DbClient({ endpointScope: 'alice' }))
  const server: Todo[] = []
  let reads = 0
  const read = async () => { reads++; return [...server] }
  const collection = runtime.bindQuery('all', read, model)
  await collection.preload()
  const action = runtime.bindMutation('insert', async ({ data }) => refreshAfterMutation(
    data.reads!, { all: read }, async () => {
      server.push(row('committed'))
      throw Error('post-write handler failure')
    },
  ), () => { collection.insert(row('committed')) })
  const tx = action({})
  const optimistic = [...collection.keys()]
  await assert.rejects(tx.isPersisted.promise, /post-write handler failure/)
  reports.postCommitHandlerFailure = {
    optimistic, transaction: tx.state, server: server.map(r => r.id),
    client: [...collection.keys()], totalReadCalls: reads,
    surfacedCommittedReadErrors: [...runtime.readErrors],
  }
  assert.equal(server.length, 1)
  assert.equal(collection.size, 0)
  assert.equal(reads, 1, 'Only the initial read ran; post-write reads never ran')
  assert.equal(runtime.readErrors.size, 0)
  await collection.cleanup()
}

// Same runtime key produced by two accepted declarations means one shared handle.
{
  const runtime = endpointRuntime(new DbClient({ endpointScope: 'alice' }))
  const first = runtime.bindQuery('collision:TodoApp:rows', async () => [row('active', false)], {
    ...model, membership: { kind: 'completed', value: false },
  })
  const second = runtime.bindQuery('collision:TodoApp:rows', async () => [row('done', true)], {
    ...model, membership: { kind: 'completed', value: true },
  })
  await Promise.all([first.preload(), second.preload()])
  reports.duplicateIdentityRuntime = {
    sameHandle: first === second, first: [...first.values()], second: [...second.values()],
    expectedFirstKeys: ['active'], expectedSecondKeys: ['done'],
  }
  assert.equal(first, second)
  assert.deepEqual([...second.keys()], ['active'])
  await first.cleanup()
}

// Input order is already SQL order for the default PG collation, as checked by
// pg-order.mjs. The actual collection comparator reverses these two string keys.
{
  const runtime = endpointRuntime(new DbClient({ endpointScope: 'alice' }))
  const sqlOrder = ['\uE000', '\u{10000}']
  const collection = runtime.bindQuery('unicode-order', async () => sqlOrder.map(id => row(id)), model)
  await collection.preload()
  reports.unicodeOrder = { rpcOrder: sqlOrder, collectionOrder: [...collection.keys()] }
  assert.deepEqual([...collection.keys()], [...sqlOrder].reverse())
  await collection.cleanup()
}

// Control: an insert excluded by its authored source still reaches another query
// that accepts it, and settles correctly. This is not a zero-effect transaction.
{
  const runtime = endpointRuntime(new DbClient({ endpointScope: 'alice' }))
  const active = runtime.bindQuery('active', async () => [], { ...model, membership: { kind: 'completed', value: false } })
  const all = runtime.bindQuery('all', async () => [], model)
  await Promise.all([active.preload(), all.preload()])
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const inserted = row('done', true)
  const action = runtime.bindMutation('insert', async () => {
    await held
    return { kind: 'confirmed', snapshots: [{ id: 'active', rows: [] }, { id: 'all', rows: [inserted] }] }
  }, () => { active.insert(inserted) })
  const tx = action({})
  assert.equal(active.size, 0)
  assert.deepEqual([...all.keys()], ['done'])
  release()
  await tx.isPersisted.promise
  assert.equal(active.size, 0)
  assert.deepEqual([...all.keys()], ['done'])
  reports.sourceExcludedInsertControl = 'passed optimistic fanout and settlement'
  await Promise.all([active.cleanup(), all.cleanup()])
}

console.log(JSON.stringify(reports, null, 2))
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(reports, null, 2) + '\n')
