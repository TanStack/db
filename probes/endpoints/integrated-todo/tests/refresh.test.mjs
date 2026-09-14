import { test } from 'node:test'
import assert from 'node:assert/strict'
import { refreshAfterMutation } from '../src/refresh.server.ts'

test('unknown and duplicate read identities reject before the write', async () => {
  let writes = 0
  const mutate = async () => {
    writes++
  }
  for (const reads of [[{ id: 'other' }], [{ id: 'known' }, { id: 'known' }]]) {
    await assert.rejects(
      refreshAfterMutation(reads, { known: async () => [] }, mutate),
      /Unknown or duplicate/,
    )
  }
  assert.equal(writes, 0)
})

test('opaque writes still refresh every requested read after the handler completes', async () => {
  let committed = false
  const observed = []
  const result = await refreshAfterMutation(
    [{ id: 'todo' }, { id: 'other-table-view' }],
    {
      todo: async () => {
        assert.ok(committed)
        observed.push('todo')
        return [{ id: 'a' }]
      },
      'other-table-view': async () => {
        assert.ok(committed)
        observed.push('other')
        return []
      },
    },
    async () => {
      committed = true
      return { affectedRows: 0 }
    },
  )
  assert.deepEqual(observed, ['todo', 'other'])
  assert.deepEqual(result, {
    kind: 'confirmed',
    handler: { kind: 'success', result: { affectedRows: 0 } },
    snapshots: [
      { id: 'todo', rows: [{ id: 'a' }] },
      { id: 'other-table-view', rows: [] },
    ],
  })
})

test('a rejected handler is not retried and still reconciles reads', async () => {
  let writes = 0,
    reads = 0
  const response = await refreshAfterMutation(
    [{ id: 'query' }],
    {
      query: async () => {
        reads++
        return []
      },
    },
    async () => {
      writes++
      throw Error('write rejected')
    },
  )
  assert.equal(writes, 1)
  assert.equal(reads, 1)
  assert.deepEqual(response, {
    kind: 'confirmed',
    handler: { kind: 'error', message: 'write rejected' },
    snapshots: [{ id: 'query', rows: [] }],
  })
})

test('a later SQL failure preserves committed effects in the reconciliation response', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = new PGlite()
  try {
    await pg.exec('CREATE TABLE effects(id integer PRIMARY KEY)')
    let writes = 0
    const response = await refreshAfterMutation(
      [{ id: 'effects' }],
      {
        effects: async () =>
          (await pg.query('SELECT id FROM effects ORDER BY id')).rows,
      },
      async () => {
        writes++
        await pg.exec('INSERT INTO effects VALUES (1)')
        await pg.exec('INSERT INTO effects VALUES (1)')
      },
    )
    assert.equal(response.handler.kind, 'error')
    assert.match(response.handler.message, /duplicate key/)
    assert.equal(response.kind, 'confirmed')
    assert.deepEqual(response.snapshots, [{ id: 'effects', rows: [{ id: 1 }] }])
    assert.equal(writes, 1)
  } finally {
    await pg.close()
  }
})

test('exhausted reads retain handler success or failure without repeating the handler', async () => {
  await Promise.all(
    [false, true].map(async (fails) => {
      let writes = 0,
        reads = 0
      const response = await refreshAfterMutation(
        [{ id: 'query' }],
        {
          query: async () => {
            reads++
            throw Error('backend down')
          },
        },
        async () => {
          writes++
          if (fails) throw Error('handler failed')
          return 'ok'
        },
      )
      assert.equal(response.kind, 'read-error')
      assert.deepEqual(
        response.handler,
        fails
          ? { kind: 'error', message: 'handler failed' }
          : { kind: 'success', result: 'ok' },
      )
      assert.equal(writes, 1)
      assert.equal(reads, 4)
    }),
  )
})
