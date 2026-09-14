import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DbClient } from '@tanstack/db'
import { endpointRuntime, type Todo } from '../src/runtime'

const model = {
  relation: 'todo',
  order: ['id'] as const,
  membership: { kind: 'all' as const },
}
const row = (text: string): Todo => ({
  id: 'row',
  text,
  completed: false,
  createdAt: new Date('2026-01-01'),
})
const turn = () => new Promise((resolve) => setTimeout(resolve, 0))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const response = (ids: string[], text: string) => ({
  kind: 'confirmed',
  handler: { kind: 'success', result: null },
  snapshots: ids.map((id) => ({ id, rows: [row(text)] })),
})

test('overlapping actions use authority read after both handlers close', async () => {
  const core = new DbClient({ endpointScope: 'alice' }),
    client = endpointRuntime(core)
  let server = '0',
    reads = 0
  const a = client.bindQuery(
    'a',
    async () => {
      reads++
      return [row(server)]
    },
    model,
  )
  await a.preload()
  const first = deferred<ReturnType<typeof response>>(),
    second = deferred<ReturnType<typeof response>>()
  const edit = (id: string, gate: typeof first, text: string) =>
    client.bindMutation(
      id,
      () => gate.promise,
      () =>
        a.update('row', (draft) => {
          draft.text = text
        }),
    )({})
  try {
    const ta = edit('first', first, '1'),
      tb = edit('second', second, '2')
    assert.equal(a.get('row')!.text, '2')
    server = '20'
    second.resolve(response(['a'], '20'))
    await turn()
    assert.equal(
      tb.state,
      'persisting',
      'overlap cannot settle from an unqualified inline snapshot',
    )
    first.resolve(response(['a'], '10'))
    await Promise.all([ta.isPersisted.promise, tb.isPersisted.promise])
    await turn()
    assert.equal(a.get('row')!.text, '20')
    assert.ok(reads > 1, 'a fresh read must cover the overlapping handlers')
  } finally {
    first.resolve(response(['a'], '10'))
    second.resolve(response(['a'], '20'))
    await core.cleanup()
  }
})

test('a held ordinary read cannot replace authority after its action retires', async () => {
  const core = new DbClient({ endpointScope: 'alice' }),
    client = endpointRuntime(core)
  let held: ReturnType<typeof deferred<Todo[]>> | undefined
  let server = '0'
  const a = client.bindQuery(
    'a',
    async () => (held ? held.promise : [row(server)]),
    model,
  )
  await a.preload()
  held = deferred()
  const read = a.utils.refetch()
  await turn()
  const stale = held
  held = undefined
  try {
    const action = client.bindMutation(
      'edit',
      async () => {
        server = '10'
        return response(['a'], server)
      },
      () =>
        a.update('row', (draft) => {
          draft.text = '1'
        }),
    )
    await action({}).isPersisted.promise
    stale.resolve([row('0')])
    await read
    await turn()
    assert.equal(a.get('row')!.text, '10')
    assert.equal(
      client.queryClient.getQueryData<Todo[]>(['a', 'alice'])?.[0]?.text,
      '10',
    )
  } finally {
    stale.resolve([row('0')])
    await core.cleanup()
  }
})

test('optimistic fanout publishes both collections before either subscriber runs', async () => {
  const core = new DbClient({ endpointScope: 'alice' }),
    client = endpointRuntime(core)
  const a = client.bindQuery('a', async () => [row('0')], model)
  const b = client.bindQuery('b', async () => [row('0')], model)
  await Promise.all([a.preload(), b.preload()])
  const observations: string[][] = []
  const subscriptions = [a, b].map((c) =>
    c.subscribeChanges(
      () => observations.push([a.get('row')!.text, b.get('row')!.text]),
      { includeInitialState: false },
    ),
  )
  const gate = deferred<ReturnType<typeof response>>()
  let tx
  try {
    tx = client.bindMutation(
      'edit',
      () => gate.promise,
      () =>
        a.update('row', (draft) => {
          draft.text = '1'
        }),
    )({})
    assert.ok(observations.length > 0)
    assert.ok(
      observations.every(([left, right]) => left === right),
      JSON.stringify(observations),
    )
  } finally {
    gate.resolve(response(['a', 'b'], '10'))
    await tx?.isPersisted.promise
    subscriptions.forEach((s) => s.unsubscribe())
    await core.cleanup()
  }
})

test('a collection created during a write joins authoritative coverage', async () => {
  const core = new DbClient({ endpointScope: 'alice' }),
    client = endpointRuntime(core)
  let server = '0'
  const a = client.bindQuery('a', async () => [row(server)], model)
  await a.preload()
  const gate = deferred<ReturnType<typeof response>>()
  const tx = client.bindMutation(
    'edit',
    () => gate.promise,
    () =>
      a.update('row', (draft) => {
        draft.text = '1'
      }),
  )({})
  try {
    const b = client.bindQuery('b', async () => [row(server)], model)
    const loaded = b.preload()
    server = '10'
    gate.resolve(response(['a'], server))
    await Promise.all([loaded, tx.isPersisted.promise])
    assert.equal(a.get('row')!.text, '10')
    assert.equal(b.get('row')!.text, '10')
  } finally {
    gate.resolve(response(['a'], '10'))
    await tx.isPersisted.promise
    await core.cleanup()
  }
})

test('reentrant actions preserve event order for every subscriber', async () => {
  const core = new DbClient({ endpointScope: 'alice' }),
    client = endpointRuntime(core)
  const a = client.bindQuery('a', async () => [row('0')], model)
  const b = client.bindQuery('b', async () => [row('0')], model)
  await Promise.all([a.preload(), b.preload()])
  const gates = [
    deferred<ReturnType<typeof response>>(),
    deferred<ReturnType<typeof response>>(),
  ]
  const action = client.bindMutation(
    'edit',
    ({ data }) => gates[data.input.index]!.promise,
    ({ input }: { input: { index: number } }) =>
      a.update('row', (draft) => {
        draft.text = String(input.index + 1)
      }),
  )
  let nested = false
  const transactions: ReturnType<typeof action>[] = []
  const observed: string[] = []
  const subscriptions = [
    a.subscribeChanges(
      () => {
        if (!nested) {
          nested = true
          transactions.push(action({ index: 1 }))
        }
      },
      { includeInitialState: false },
    ),
    a.subscribeChanges(
      (changes) => {
        observed.push(...changes.map((change) => change.value.text))
      },
      { includeInitialState: false },
    ),
  ]
  try {
    transactions.push(action({ index: 0 }))
    assert.deepEqual(observed, ['1', '2'])
    assert.equal(a.get('row')!.text, '2')
    assert.equal(b.get('row')!.text, '2')
  } finally {
    gates.forEach((gate) => gate.resolve(response(['a', 'b'], '0')))
    await Promise.all(transactions.map((tx) => tx.isPersisted.promise))
    subscriptions.forEach((s) => s.unsubscribe())
    await core.cleanup()
  }
})

test('local rollback publishes every recipient together and does not cancel remote coverage', async () => {
  const core = new DbClient({ endpointScope: 'alice' }),
    client = endpointRuntime(core)
  const a = client.bindQuery('a', async () => [row('0')], model),
    b = client.bindQuery('b', async () => [row('0')], model)
  await Promise.all([a.preload(), b.preload()])
  const gate = deferred<ReturnType<typeof response>>()
  const tx = client.bindMutation(
    'edit',
    () => gate.promise,
    () =>
      a.update('row', (draft) => {
        draft.text = '1'
      }),
  )({})
  void tx.isPersisted.promise.catch(() => {})
  const observed: string[][] = []
  const subscriptions = [a, b].map((c) =>
    c.subscribeChanges(
      () => observed.push([a.get('row')!.text, b.get('row')!.text]),
      { includeInitialState: false },
    ),
  )
  try {
    tx.rollback()
    assert.ok(
      observed.every(([left, right]) => left === right),
      JSON.stringify(observed),
    )
    gate.resolve(response(['a', 'b'], '10'))
    await turn()
    assert.equal(tx.state, 'failed')
    assert.equal(a.get('row')!.text, '10')
    assert.equal(b.get('row')!.text, '10')
  } finally {
    gate.resolve(response(['a', 'b'], '10'))
    subscriptions.forEach((s) => s.unsubscribe())
    await core.cleanup()
  }
})

test('a retired read cannot block initial coverage of the restarted collection', async () => {
  const core = new DbClient({ endpointScope: 'alice' }),
    client = endpointRuntime(core)
  let held = false,
    server = '0'
  const obsolete = deferred<Todo[]>()
  const a = client.bindQuery(
    'a',
    async () => (held ? obsolete.promise : [row(server)]),
    model,
  )
  await a.preload()
  held = true
  const read = a.utils.refetch()
  await turn()
  try {
    await a.cleanup()
    held = false
    server = '10'
    await a.preload()
    assert.equal(a.get('row')!.text, '10')
    obsolete.resolve([row('0')])
    await read
    await turn()
    assert.equal(a.get('row')!.text, '10')
  } finally {
    obsolete.resolve([row('0')])
    await core.cleanup()
  }
})

test('an unsent authored failure does not leave a remote obligation', async () => {
  const core = new DbClient({ endpointScope: 'alice' }),
    client = endpointRuntime(core)
  const a = client.bindQuery('a', async () => [row('0')], model)
  await a.preload()
  let sent = 0
  try {
    const bad = client.bindMutation(
      'bad',
      async () => {
        sent++
        return response(['a'], 'bad')
      },
      () => {
        a.update('row', (draft) => {
          draft.text = 'guess'
        })
        throw Error('authored failure')
      },
    )
    assert.throws(() => bad({}), /authored failure/)
    assert.equal(sent, 0)
    assert.equal(a.get('row')!.text, '0')
    const good = client.bindMutation(
      'good',
      async () => response(['a'], '10'),
      () =>
        a.update('row', (draft) => {
          draft.text = '1'
        }),
    )
    await good({}).isPersisted.promise
    assert.equal(a.get('row')!.text, '10')
  } finally {
    await core.cleanup()
  }
})

test('a known read failure recovers without repeating its write', async () => {
  const core = new DbClient({ endpointScope: 'alice' }),
    client = endpointRuntime(core)
  let server = '0',
    writes = 0
  const a = client.bindQuery('a', async () => [row(server)], model)
  await a.preload()
  try {
    const action = client.bindMutation(
      'edit',
      async () => {
        writes++
        server = '10'
        return {
          kind: 'read-error',
          handler: { kind: 'success', result: null },
          message: 'reads exhausted',
        }
      },
      () =>
        a.update('row', (draft) => {
          draft.text = '1'
        }),
    )
    await assert.rejects(action({}).isPersisted.promise, /reads exhausted/)
    assert.equal(client.readErrors.size, 1)
    await a.utils.refetch({ throwOnError: true })
    await turn()
    assert.equal(a.get('row')!.text, '10')
    assert.equal(client.readErrors.size, 0)
    assert.equal(writes, 1)
  } finally {
    await core.cleanup()
  }
})

test('a later healthy response cannot discharge an unknown remote write', async () => {
  const core = new DbClient({ endpointScope: 'alice' }),
    client = endpointRuntime(core)
  const a = client.bindQuery('a', async () => [row('0')], model)
  await a.preload()
  try {
    const lost = client.bindMutation(
      'lost',
      async () => {
        throw Error('transport lost')
      },
      () =>
        a.update('row', (draft) => {
          draft.text = '1'
        }),
    )
    await assert.rejects(lost({}).isPersisted.promise, /transport lost/)
    const good = client.bindMutation(
      'good',
      async () => response(['a'], '20'),
      () =>
        a.update('row', (draft) => {
          draft.text = '2'
        }),
    )
    await assert.rejects(good({}).isPersisted.promise, /unknown/)
    assert.match(client.readErrors.get('a')!, /unknown/)
    assert.equal(a.get('row')!.text, '0')
  } finally {
    await core.cleanup()
  }
})

test('a new action invalidates an in-flight repair without waiting for its obsolete read', async () => {
  const core = new DbClient({ endpointScope: 'alice' }),
    client = endpointRuntime(core)
  let server = '0',
    holdNext = false,
    reading = false
  const oldRead = deferred<Todo[]>()
  const a = client.bindQuery(
    'a',
    async () => {
      if (holdNext) {
        holdNext = false
        reading = true
        return oldRead.promise
      }
      return [row(server)]
    },
    model,
  )
  await a.preload()
  const gates = [
    deferred<ReturnType<typeof response>>(),
    deferred<ReturnType<typeof response>>(),
  ]
  const edit = (index: number) =>
    client.bindMutation(
      'edit' + index,
      () => gates[index]!.promise,
      () =>
        a.update('row', (draft) => {
          draft.text = String(index + 1)
        }),
    )({})
  const first = edit(0),
    second = edit(1)
  try {
    server = '20'
    holdNext = true
    gates[0]!.resolve(response(['a'], '10'))
    gates[1]!.resolve(response(['a'], '20'))
    await turn()
    assert.equal(reading, true)
    const third = client.bindMutation(
      'third',
      async () => {
        server = '30'
        return response(['a'], '30')
      },
      () =>
        a.update('row', (draft) => {
          draft.text = '3'
        }),
    )({})
    await Promise.all([
      first.isPersisted.promise,
      second.isPersisted.promise,
      third.isPersisted.promise,
    ])
    assert.equal(a.get('row')!.text, '30')
    oldRead.resolve([row('20')])
    await turn()
    assert.equal(a.get('row')!.text, '30')
  } finally {
    oldRead.resolve([row('20')])
    await core.cleanup()
  }
})

test('shared snapshots preserve extra columns and collection-local optimistic ownership', async () => {
  const core = new DbClient({ endpointScope: 'alice' }),
    client = endpointRuntime(core)
  const original = { ...row('0'), score: null as number | null }
  const a = client.bindQuery('a', async () => [original], model),
    b = client.bindQuery('b', async () => [original], model)
  await Promise.all([a.preload(), b.preload()])
  try {
    const edit = client.bindMutation(
      'shared',
      async () => ({
        kind: 'confirmed-shared',
        handler: { kind: 'success', result: null },
        pool: [{ ...row('server'), score: 7 }],
        snapshots: [
          { id: 'a', indexes: [0] },
          { id: 'b', indexes: [0] },
        ],
      }),
      () =>
        a.update('row', (draft) => {
          draft.text = 'guess'
        }),
    )
    await edit({}).isPersisted.promise
    assert.equal(a.get('row')!.score, 7)
    assert.equal(b.get('row')!.text, 'server')
    const local = core.createTransaction({
      autoCommit: false,
      mutationFn: async () => {},
    })
    local.mutate(() =>
      a.update('row', (draft) => {
        draft.text = 'local'
      }),
    )
    assert.equal(
      b.get('row')!.text,
      'server',
      'shared transport objects cannot couple local overlays',
    )
    local.rollback()
    void local.isPersisted.promise.catch(() => {})
  } finally {
    await core.cleanup()
  }
})

test('malformed shared indexes reject before installing any authority', async () => {
  for (const indexes of [[1], [-1], [0.5], [0, 0]]) {
    const core = new DbClient({ endpointScope: 'alice' }),
      client = endpointRuntime(core)
    const a = client.bindQuery('a', async () => [row('baseline')], model)
    await a.preload()
    try {
      const edit = client.bindMutation(
        'invalid',
        async () => ({
          kind: 'confirmed-shared',
          handler: { kind: 'success', result: null },
          pool: [row('wrong')],
          snapshots: [{ id: 'a', indexes }],
        }),
        () =>
          a.update('row', (draft) => {
            draft.text = 'guess'
          }),
      )
      await assert.rejects(
        edit({}).isPersisted.promise,
        /Invalid or incomplete/,
      )
      assert.equal(a.get('row')!.text, 'baseline')
    } finally {
      await core.cleanup()
    }
  }
})

test('authority cannot silently omit a selected scalar column', async () => {
  const core = new DbClient({ endpointScope: 'alice' }),
    client = endpointRuntime(core)
  const a = client.bindQuery(
    'a',
    async () => [{ ...row('baseline'), score: 3 }],
    { ...model, fields: ['id', 'text', 'completed', 'createdAt', 'score'] },
  )
  await a.preload()
  try {
    const edit = client.bindMutation(
      'missing-column',
      async () => response(['a'], 'wrong'),
      () =>
        a.update('row', (draft) => {
          draft.text = 'guess'
        }),
    )
    await assert.rejects(edit({}).isPersisted.promise, /Invalid or incomplete/)
    assert.equal(a.get('row')!.score, 3)
  } finally {
    await core.cleanup()
  }
})

test('parameterized collections have stable distinct identities and send every retained instance', async () => {
  const { registerQuery, refreshRegisteredMutation } =
    await import('../src/registry.server')
  const core = new DbClient({ endpointScope: 'alice' }),
    client = endpointRuntime(core)
  let completed = false
  const template = {
    ...model,
    membership: {
      kind: 'expression' as const,
      expression: {
        op: 'eq' as const,
        column: 'completed',
        value: { parameter: 'completed' },
      },
    },
  }
  const rpc = async ({
    data,
  }: {
    data: { input: { completed: boolean; tag: string } }
  }) =>
    data.input.completed === completed
      ? [{ ...row('authority'), completed }]
      : []
  const params = { completed: false, tag: 'a' }
  const a = client.bindQuery('shared', rpc, template, params, 'v1')
  const again = client.bindQuery(
    'shared',
    rpc,
    template,
    { tag: 'a', completed: false },
    'v1',
  )
  const b = client.bindQuery(
    'shared',
    rpc,
    template,
    { completed: true, tag: 'a' },
    'v1',
  )
  assert.equal(a, again)
  assert.notEqual(a, b)
  params.completed = true
  await Promise.all([a.preload(), b.preload()])
  assert.equal(a.size, 1)
  assert.equal(b.size, 0)
  assert.equal(a.subscriberCount, 0)
  assert.equal(b.subscriberCount, 0)
  let observed: ReadonlyArray<{
    id: string
    definition: string
    version: string
    params: unknown
  }> = []
  const registry = {
    shared: registerQuery(
      'v1',
      'todo',
      (value) => {
        const input = value as { completed: boolean; tag: string }
        assert.equal(typeof input.completed, 'boolean')
        return input
      },
      async (input) => rpc({ data: { input } }),
    ),
  }
  const action = client.bindMutation(
    'edit',
    async ({ data }) => {
      observed = data.reads ?? []
      return refreshRegisteredMutation(
        data.reads ?? [],
        registry,
        async () => {
          completed = true
        },
        { scope: 'alice' },
      )
    },
    () =>
      a.update('row', (draft) => {
        draft.completed = true
      }),
  )
  try {
    const tx = action({})
    assert.equal(a.size, 0)
    assert.equal(b.size, 1)
    await tx.isPersisted.promise
    assert.equal(observed.length, 2)
    assert.deepEqual(
      observed.map((r) => r.params),
      [
        { completed: false, tag: 'a' },
        { completed: true, tag: 'a' },
      ],
    )
    assert.ok(
      observed.every((r) => r.definition === 'shared' && r.version === 'v1'),
    )
    assert.equal(a.size, 0)
    assert.equal(b.size, 1)
    assert.throws(
      () =>
        client.bindQuery(
          'shared',
          rpc,
          template,
          { completed: false, tag: 'a' },
          'v2',
        ),
      /definition changed/,
    )
    await b.cleanup()
    const noop = client.bindMutation(
      'noop',
      async ({ data }) => {
        observed = data.reads ?? []
        return refreshRegisteredMutation(
          data.reads ?? [],
          registry,
          async () => null,
          { scope: 'alice' },
        )
      },
      () => a.insert({ ...row('temporary'), completed: false }),
    )
    await noop({}).isPersisted.promise
    assert.equal(observed.length, 1)
    await b.preload()
    assert.equal(b.size, 1)
  } finally {
    await core.cleanup()
  }
})

test('registry admission rejection closes the operation and permits a later healthy mutation', async () => {
  const core = new DbClient({ endpointScope: 'alice' }),
    client = endpointRuntime(core)
  let server = 'baseline'
  const collection = client.bindQuery('a', async () => [row(server)], model)
  await collection.preload()
  try {
    const rejected = client.bindMutation(
      'rejected',
      async () => ({ kind: 'not-started', message: 'Stale query definition' }),
      () =>
        collection.update('row', (draft) => {
          draft.text = 'guess'
        }),
    )
    await assert.rejects(
      rejected({}).isPersisted.promise,
      /Stale query definition/,
    )
    assert.equal(collection.get('row')!.text, 'baseline')
    const healthy = client.bindMutation(
      'healthy',
      async () => {
        server = 'confirmed'
        return response(['a'], server)
      },
      () =>
        collection.update('row', (draft) => {
          draft.text = 'next'
        }),
    )
    await healthy({}).isPersisted.promise
    assert.equal(collection.get('row')!.text, 'confirmed')
  } finally {
    await core.cleanup()
  }
})

test('incompatible cross-module projections reject before creating an optimistic recipient', async () => {
  const core = new DbClient({ endpointScope: 'alice' }),
    client = endpointRuntime(core)
  try {
    const a = client.bindQuery(
      'module-a',
      async () => [{ ...row('a'), score: 1 }],
      { ...model, fields: ['id', 'text', 'completed', 'createdAt', 'score'] },
    )
    await a.preload()
    assert.throws(
      () =>
        client.bindQuery('module-b', async () => [row('b')], {
          ...model,
          fields: ['id', 'text', 'completed', 'createdAt'],
        }),
      /projection/,
    )
  } finally {
    await core.cleanup()
  }
})

test('a parameter instance created during a mutation joins fresh authoritative coverage', async () => {
  const core = new DbClient({ endpointScope: 'alice' }),
    client = endpointRuntime(core)
  let completed = false
  const template = {
    ...model,
    membership: {
      kind: 'expression' as const,
      expression: {
        op: 'eq' as const,
        column: 'completed',
        value: { parameter: 'completed' },
      },
    },
  }
  const rpc = async ({ data }: { data: { input: { completed: boolean } } }) =>
    data.input.completed === completed ? [{ ...row('server'), completed }] : []
  const a = client.bindQuery(
    'shared',
    rpc,
    template,
    { completed: false },
    'v1',
  )
  await a.preload()
  const gate = deferred<void>()
  const action = client.bindMutation(
    'edit',
    async ({ data }) => {
      await gate.promise
      completed = true
      return {
        kind: 'confirmed',
        handler: { kind: 'success', result: null },
        snapshots: (data.reads ?? []).map(({ id }) => ({ id, rows: [] })),
      }
    },
    () =>
      a.update('row', (draft) => {
        draft.completed = true
      }),
  )
  try {
    const tx = action({})
    const b = client.bindQuery(
      'shared',
      rpc,
      template,
      { completed: true },
      'v1',
    )
    const ready = b.preload()
    gate.resolve()
    await Promise.all([ready, tx.isPersisted.promise])
    assert.equal(a.size, 0)
    assert.equal(b.size, 1)
    assert.equal(b.get('row')!.completed, true)
  } finally {
    gate.resolve()
    await core.cleanup()
  }
})

test('unchanged authority preserves confirmed rows and retires a wrong optimistic guess', async () => {
  const core = new DbClient({ endpointScope: 'alice' }),
    client = endpointRuntime(core)
  const a = client.bindQuery('a', async () => [row('a')], {
    ...model,
    relation: 'a',
  })
  const b = client.bindQuery('b', async () => [row('b')], {
    ...model,
    relation: 'b',
  })
  await Promise.all([a.preload(), b.preload()])
  let calls = 0
  const action = client.bindMutation(
    'edit',
    async ({ data }) => {
      calls++
      if (calls === 1)
        return {
          kind: 'confirmed',
          handler: { kind: 'success', result: null },
          snapshots: [
            { id: 'a', rows: [row('a1')] },
            { id: 'b', rows: [row('b')] },
          ],
          certificates: [
            { id: 'a', certificate: 'a1' },
            { id: 'b', certificate: 'b0' },
          ],
        }
      assert.equal(data.reads?.find((r) => r.id === 'b')?.certificate, 'b0')
      return {
        kind: 'confirmed',
        handler: { kind: 'success', result: null },
        snapshots: [{ id: 'a', rows: [row('a2')] }],
        certificates: [{ id: 'a', certificate: 'a2' }],
        unchanged: [{ id: 'b', certificate: 'b0' }],
      }
    },
    () =>
      b.update('row', (draft) => {
        draft.text = 'wrong guess'
      }),
  )
  try {
    await action({}).isPersisted.promise
    await action({}).isPersisted.promise
    assert.equal(a.get('row')!.text, 'a2')
    assert.equal(b.get('row')!.text, 'b')
  } finally {
    await core.cleanup()
  }
})

test('unmatched unchanged certificates cannot settle an action', async () => {
  const core = new DbClient({ endpointScope: 'alice' }),
    client = endpointRuntime(core)
  const a = client.bindQuery('a', async () => [row('baseline')], model)
  await a.preload()
  const action = client.bindMutation(
    'edit',
    async () => ({
      kind: 'confirmed',
      handler: { kind: 'success', result: null },
      snapshots: [],
      unchanged: [{ id: 'a', certificate: 'not-installed' }],
    }),
    () =>
      a.update('row', (draft) => {
        draft.text = 'guess'
      }),
  )
  try {
    await assert.rejects(
      action({}).isPersisted.promise,
      /Invalid or incomplete/,
    )
    assert.equal(a.get('row')!.text, 'baseline')
  } finally {
    await core.cleanup()
  }
})

test('overlapping unchanged responses still require a fresh authority read', async () => {
  const core = new DbClient({ endpointScope: 'alice' }),
    client = endpointRuntime(core)
  let serverA = 'a0',
    serverB = 'b0',
    reads = 0
  const a = client.bindQuery(
    'a',
    async () => {
      reads++
      return [row(serverA)]
    },
    { ...model, relation: 'a' },
  )
  const b = client.bindQuery(
    'b',
    async () => {
      reads++
      return [row(serverB)]
    },
    { ...model, relation: 'b' },
  )
  await Promise.all([a.preload(), b.preload()])
  const warm = client.bindMutation(
    'warm',
    async () => ({
      kind: 'confirmed',
      handler: { kind: 'success', result: null },
      snapshots: [
        { id: 'a', rows: [row(serverA)] },
        { id: 'b', rows: [row(serverB)] },
      ],
      certificates: [
        { id: 'a', certificate: 'a0' },
        { id: 'b', certificate: 'b0' },
      ],
    }),
    () =>
      a.update('row', (draft) => {
        draft.text = 'warm'
      }),
  )
  const gate = deferred<unknown>()
  try {
    await warm({}).isPersisted.promise
    const before = reads
    const first = client.bindMutation(
      'first',
      () => gate.promise,
      () =>
        a.update('row', (draft) => {
          draft.text = 'guess-a'
        }),
    )({})
    const second = client.bindMutation(
      'second',
      async () => ({
        kind: 'confirmed',
        handler: { kind: 'success', result: null },
        snapshots: [{ id: 'b', rows: [row('b1')] }],
        unchanged: [{ id: 'a', certificate: 'a0' }],
      }),
      () =>
        b.update('row', (draft) => {
          draft.text = 'guess-b'
        }),
    )({})
    serverA = 'a-final'
    serverB = 'b-final'
    gate.resolve({
      kind: 'confirmed',
      handler: { kind: 'success', result: null },
      snapshots: [{ id: 'a', rows: [row('a1')] }],
      unchanged: [{ id: 'b', certificate: 'b0' }],
    })
    await Promise.all([first.isPersisted.promise, second.isPersisted.promise])
    assert.equal(a.get('row')!.text, 'a-final')
    assert.equal(b.get('row')!.text, 'b-final')
    assert.ok(reads > before)
    const check = client.bindMutation(
      'check',
      async ({ data }) => {
        assert.ok(
          data.reads!.every((request) => request.certificate === undefined),
          'ordinary repair clears stale tokens',
        )
        return {
          kind: 'confirmed',
          handler: { kind: 'success', result: null },
          snapshots: [
            { id: 'a', rows: [row(serverA)] },
            { id: 'b', rows: [row(serverB)] },
          ],
        }
      },
      () =>
        a.update('row', (draft) => {
          draft.text = 'guess'
        }),
    )
    await check({}).isPersisted.promise
  } finally {
    gate.resolve(null)
    await core.cleanup()
  }
})
