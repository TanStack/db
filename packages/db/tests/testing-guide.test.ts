import { expect, it } from 'vitest'
import {
  createCollection,
  createOptimisticAction,
  localOnlyCollectionOptions,
} from '../src/index'
import type { SyncConfig } from '../src/index'

type Todo = { id: string; text: string; done: boolean }

function makeTodos() {
  return createCollection(
    localOnlyCollectionOptions<Todo>({
      getKey: (todo) => todo.id,
      initialData: [{ id: '1', text: 'Write a test', done: false }],
    }),
  )
}

it('confirms a local edit without a backend', async () => {
  const todos = makeTodos()
  try {
    const tx = todos.update('1', (draft) => {
      draft.done = true
    })
    expect(todos.get('1')).toMatchObject({ done: true })
    await tx.isPersisted.promise
    expect(todos.get('1')).toMatchObject({ done: true })
  } finally {
    await todos.cleanup()
  }
})

function makeRemoteTodos() {
  // startSync invokes sync synchronously before this factory returns.
  let sync!: Parameters<SyncConfig<Todo>['sync']>[0]
  const todos = createCollection<Todo>({
    getKey: (todo) => todo.id,
    startSync: true,
    sync: {
      sync: (params) => {
        sync = params
      },
    },
  })
  return { todos, sync }
}

it('loads initial rows and applies a later server update', async () => {
  const { todos, sync } = makeRemoteTodos()
  try {
    expect(todos.status).toBe('loading')
    sync.begin()
    sync.write({
      type: 'insert',
      value: { id: '1', text: 'Write a test', done: false },
    })
    await sync.commit()
    sync.markReady()
    await todos.stateWhenReady()
    expect(todos.get('1')).toMatchObject({ done: false })

    sync.begin()
    sync.write({
      type: 'update',
      value: { id: '1', text: 'Write a test', done: true },
    })
    await sync.commit()
    expect(todos.get('1')).toMatchObject({ done: true })
  } finally {
    await todos.cleanup()
  }
})

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

async function makePendingEdit() {
  const { todos, sync } = makeRemoteTodos()
  sync.begin()
  sync.write({
    type: 'insert',
    value: { id: '1', text: 'Write a test', done: false },
  })
  await sync.commit()
  sync.markReady()
  const request = deferred()
  const completeTodo = createOptimisticAction<string>({
    onMutate: (id) => {
      todos.update(id, (draft) => {
        draft.done = true
      })
    },
    mutationFn: () => request.promise,
  })
  return { todos, sync, request, completeTodo }
}

it('keeps the server update after the request succeeds', async () => {
  const { todos, sync, request, completeTodo } = await makePendingEdit()
  try {
    const tx = completeTodo('1')
    expect(todos.get('1')).toMatchObject({ done: true })
    sync.begin()
    sync.write({
      type: 'update',
      value: { id: '1', text: 'Write a test', done: true },
    })
    const applied = sync.commit()
    request.resolve()
    await tx.isPersisted.promise
    await applied
    expect(todos.get('1')).toMatchObject({ done: true, $synced: true })
  } finally {
    await todos.cleanup()
  }
})

it('rolls back an optimistic edit when the request fails', async () => {
  const { todos, request, completeTodo } = await makePendingEdit()
  try {
    const tx = completeTodo('1')
    expect(todos.get('1')).toMatchObject({ done: true })
    const error = new Error('Save failed')
    // Attach the rejection assertion before rejecting the controlled request.
    const rejected = expect(tx.isPersisted.promise).rejects.toBe(error)
    request.reject(error)
    await rejected
    expect(todos.get('1')).toMatchObject({ done: false })
  } finally {
    await todos.cleanup()
  }
})
