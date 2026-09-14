import { test } from 'node:test'
import { z } from 'zod'
import assert from 'node:assert/strict'
import { DbClient } from '@tanstack/db'
import { endpointRuntime, InvalidInputError } from '../src/runtime'

const model = {
  relation: 'validation',
  fields: ['id', 'value'],
  membership: { kind: 'all' as const },
}
const schema = z.object({ id: z.string(), value: z.number() })
const issue = {
  code: 'too_small',
  path: ['input', 'items', 0, 'name'],
  message: 'Required',
}
const rejected = {
  kind: 'not-started',
  code: 'INVALID_INPUT',
  message: 'Invalid mutation input',
  issues: [issue],
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const typedError = (error: unknown) => {
  assert.ok(error instanceof InvalidInputError)
  assert.equal(error.code, 'INVALID_INPUT')
  assert.deepEqual(error.issues, [issue])
  return true
}

test('invalid input retires only its own overlay without reads or retries', async () => {
  for (const optimistic of [false, true]) {
    const core = new DbClient({ endpointScope: 'oracle' })
    const client = endpointRuntime(core)
    let reads = 0,
      requests = 0
    const collection = client.bindQuery(
      'rows',
      async () => {
        reads++
        return [{ id: 'row', value: 1 }]
      },
      model,
      {},
      'fixture',
      schema,
    )
    await collection.preload()
    const baselineReads = reads
    try {
      const action = client.bindMutation(
        'invalid',
        async () => {
          requests++
          return rejected
        },
        () => {
          if (optimistic)
            collection.update('row', (row) => {
              row.value = 2
            })
        },
      )
      for (let i = 0; i < 3; i++) {
        const tx = action({})
        assert.equal(collection.get('row')!.value, optimistic ? 2 : 1)
        await assert.rejects(tx.isPersisted.promise, typedError)
        assert.equal(collection.get('row')!.value, 1)
        assert.equal(reads, baselineReads)
        assert.equal(requests, i + 1)
        assert.equal(client.readErrors.size, 0)
      }
      // No rejected obligation remains to block an explicit read later.
      await collection.utils.refetch({ throwOnError: true })
      assert.equal(reads, baselineReads + 1)
    } finally {
      await core.cleanup()
    }
  }
})

test('validation rejection does not retire an overlapping valid mutation', async () => {
  for (const rejectFirst of [false, true]) {
    const core = new DbClient({ endpointScope: 'oracle' })
    const client = endpointRuntime(core)
    let server = 1
    const collection = client.bindQuery(
      'rows',
      async () => [{ id: 'row', value: server }],
      model,
      {},
      'fixture',
      schema,
    )
    await collection.preload()
    const validGate = deferred<unknown>(),
      invalidGate = deferred<unknown>()
    const valid = client.bindMutation(
      'valid',
      () => validGate.promise,
      () =>
        collection.update('row', (row) => {
          row.value = 2
        }),
    )
    const invalid = client.bindMutation(
      'invalid',
      () => invalidGate.promise,
      () =>
        collection.update('row', (row) => {
          row.value = 3
        }),
    )
    try {
      const first = valid({}),
        second = invalid({})
      const failure = assert.rejects(second.isPersisted.promise, typedError)
      assert.equal(collection.get('row')!.value, 3)
      const response = {
        kind: 'confirmed',
        handler: { kind: 'success', result: null },
        snapshots: [{ id: 'rows', rows: [{ id: 'row', value: 20 }] }],
      }
      if (rejectFirst) {
        invalidGate.resolve(rejected)
        await failure
        assert.equal(first.state, 'persisting')
        assert.equal(collection.get('row')!.value, 2)
        server = 20
        validGate.resolve(response)
      } else {
        server = 20
        validGate.resolve(response)
        await new Promise((resolve) => setTimeout(resolve, 0))
        assert.equal(first.state, 'persisting')
        invalidGate.resolve(rejected)
      }
      await Promise.all([first.isPersisted.promise, failure])
      assert.equal(collection.get('row')!.value, 20)
      assert.equal(client.readErrors.size, 0)
    } finally {
      await core.cleanup()
    }
  }
})

test('transport errors and malformed validation responses are not closure evidence', async () => {
  for (const value of [
    undefined,
    { ...rejected, issues: [] },
    { ...rejected, code: 'OTHER' },
  ]) {
    const core = new DbClient({ endpointScope: 'oracle' })
    const client = endpointRuntime(core)
    const collection = client.bindQuery(
      'rows',
      async () => [{ id: 'row', value: 1 }],
      model,
      {},
      'fixture',
      schema,
    )
    await collection.preload()
    try {
      const action = client.bindMutation(
        'lost',
        async () => {
          if (value) return value
          throw new InvalidInputError('lost response', [issue])
        },
        () => {},
      )
      await assert.rejects(
        action({}).isPersisted.promise,
        value ? /Invalid or incomplete/ : InvalidInputError,
      )
      await assert.rejects(
        collection.utils.refetch({ throwOnError: true }),
        /outcome is unknown/,
      )
    } finally {
      await core.cleanup()
    }
  }
})
