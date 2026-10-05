---
title: Testing
id: testing
---

# Testing

Test your application with real Collections and control the data they receive.
Use local-only fixtures for component behavior, and controlled sync for loading,
server updates, and optimistic mutations.

These examples use Vitest. The same Collection APIs work with other test runners.
They exercise application behavior with in-memory fixtures. Keep integration tests
against your actual adapter for network, persistence, and server acknowledgement behavior.

## Choose a fixture

| What you need to test                 | Fixture                                                        |
| ------------------------------------- | -------------------------------------------------------------- |
| Filtering, rendering, and local edits | `localOnlyCollectionOptions` with `initialData`                |
| Loading and incoming server changes   | A Collection with a controlled `sync` function                 |
| Optimistic success and rollback       | A controlled request promise and the real mutation action      |
| Backend-specific behavior             | Your actual adapter with a controlled provider or test backend |

Create a fresh Collection for each test. Dispose hooks, scopes, and subscriptions
before awaiting `collection.cleanup()`. A unique ID alone does not release resources.

## Test setup

Install Vitest and your framework's testing dependencies. DOM tests also need
`jsdom` and `test.environment: 'jsdom'` in the Vitest configuration.
Collection-only tests can use Vitest's Node environment.

```sh
npm install -D vitest
# For DOM tests:
npm install -D jsdom
```

Keep your application's framework plugin and test setup. A plain Vitest config
is not sufficient for every framework:

| Framework | Additional setup                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------ |
| React     | Install `@testing-library/react`. Use the React Vite plugin for JSX and React Testing Library's `act` environment setup. |
| Vue       | Keep `@vitejs/plugin-vue` when testing `.vue` components. The composable example below uses an `effectScope`.            |
| Svelte 5  | Use `@sveltejs/vite-plugin-svelte`. Name rune tests `*.svelte.test.ts` and use browser resolution conditions.            |
| Solid     | Install `@solidjs/testing-library` and use `vite-plugin-solid` for the client runtime and JSX.                           |
| Angular   | Initialize Angular's TestBed in a setup file using your application's Angular test configuration.                        |

The [React setup](https://github.com/TanStack/db/blob/main/packages/react-db/tests/test-setup.ts),
[Svelte config](https://github.com/TanStack/db/blob/main/packages/svelte-db/vite.config.ts), and
[Angular setup](https://github.com/TanStack/db/blob/main/packages/angular-db/tests/test-setup.ts)
show this repository's configuration. The Angular setup uses Zone.js.

## Local fixtures

Use this fixture in each of the framework examples below. Keep the installed
framework adapter and `@tanstack/db` on compatible versions with one runtime copy of `@tanstack/db`.

```ts
import { createCollection, localOnlyCollectionOptions } from '@tanstack/db'

type Todo = { id: string; text: string; done: boolean }

function makeTodos() {
  return createCollection(
    localOnlyCollectionOptions<Todo>({
      getKey: (todo) => todo.id,
      initialData: [{ id: '1', text: 'Write a test', done: false }],
    }),
  )
}
```

Local-only Collections confirm edits without a backend. An assertion immediately
after a mutation checks the optimistic result. Awaiting the transaction checks its
outcome as well:

```ts
import { expect, it } from 'vitest'

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
```

Use `toMatchObject` when you care about selected fields. Use exact equality on an
explicit projection when all fields matter. Virtual properties such as `$synced`
are public metadata; assert them when they are part of the behavior under test.

## Control incoming server data

This fixture starts in `loading` and exposes typed sync callbacks. `commit()` returns
an applied receipt: await it before asserting that the sync transaction is visible.
Call `markReady()` after supplying the initial snapshot, including an empty snapshot.

```ts
import type { SyncConfig } from '@tanstack/db'

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
```

`stateWhenReady()` waits for Collection readiness. A framework query can still need
its own scheduler to run before its public result updates.

## Test optimistic outcomes

Control the request so the test can inspect the optimistic result before success
or failure. The following helpers use `makeRemoteTodos` from the previous section.

```ts
import { createOptimisticAction } from '@tanstack/db'

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
```

Request success alone does not prove that the server update reached the Collection.
In this fixture, queue the source update before completing the request. Then await
both the transaction and the applied receipt. The receipt can wait for the pending
mutation, so release the request before awaiting that receipt:

```ts
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
```

For failure, attach the rejection assertion before rejecting the request. Then
assert that rollback restores the original row:

```ts
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
```

Apply the same checks to insert and delete actions and to the UI that displays
mutation errors. For direct `collection.insert`, `update`, or `delete` calls on a
synced Collection, provide the corresponding mutation handler and control its promise.
An immediately resolving empty handler cannot demonstrate a pending request or rollback.

## Framework queries

Each example below uses `makeTodos` from [Local fixtures](#local-fixtures).
It waits for the initial row, completes that row, then checks that the filtered
result becomes empty. The waits retry an observable assertion instead of assuming
a fixed delay is sufficient. These hook tests complement component tests that
assert the rendered UI and exercise user interactions.

### React

Wrap mutations in `act`. Read the current hook result through `result.current`.

```tsx
import { eq } from '@tanstack/db'
import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { useLiveQuery } from '@tanstack/react-db'

it('removes completed todos from the React query', async () => {
  const todos = makeTodos()
  const { result, unmount } = renderHook(() =>
    useLiveQuery((q) =>
      q.from({ todo: todos }).where(({ todo }) => eq(todo.done, false)),
    ),
  )
  try {
    await waitFor(() =>
      expect(result.current.data).toMatchObject([{ id: '1' }]),
    )
    await act(async () => {
      const tx = todos.update('1', (draft) => {
        draft.done = true
      })
      await tx.isPersisted.promise
    })
    await waitFor(() => expect(result.current.data).toEqual([]))
  } finally {
    unmount()
    await todos.cleanup()
  }
})
```

[Runnable React example](https://github.com/TanStack/db/blob/main/packages/react-db/tests/testing-guide.test.tsx).

### Vue

Create the composable inside an active `effectScope` and stop that scope during cleanup. Read refs through `.value`.

```ts
import { eq } from '@tanstack/db'
import { effectScope, nextTick } from 'vue'
import { expect, it, vi } from 'vitest'
import { useLiveQuery } from '@tanstack/vue-db'

it('removes completed todos from the Vue query', async () => {
  const todos = makeTodos()
  const scope = effectScope()
  try {
    const query = scope.run(() =>
      useLiveQuery((q) =>
        q.from({ todo: todos }).where(({ todo }) => eq(todo.done, false)),
      ),
    )!
    await vi.waitFor(async () => {
      await nextTick()
      expect(query.data.value).toMatchObject([{ id: '1' }])
    })
    const tx = todos.update('1', (draft) => {
      draft.done = true
    })
    await tx.isPersisted.promise
    await vi.waitFor(async () => {
      await nextTick()
      expect(query.data.value).toEqual([])
    })
  } finally {
    scope.stop()
    await todos.cleanup()
  }
})
```

[Runnable Vue example](https://github.com/TanStack/db/blob/main/packages/vue-db/tests/testing-guide.test.ts).

### Svelte

Use a persistent `$effect.root` in a `*.svelte.test.ts` file. Flush effects before assertions, and retain reactive property reads.

```ts
import { eq } from '@tanstack/db'
import { flushSync } from 'svelte'
import { expect, it, vi } from 'vitest'
import { useLiveQuery } from '@tanstack/svelte-db'

it('removes completed todos from the Svelte query', async () => {
  const todos = makeTodos()
  let readTodos!: () => Array<Todo>
  const dispose = $effect.root(() => {
    const query = useLiveQuery((q) =>
      q.from({ todo: todos }).where(({ todo }) => eq(todo.done, false)),
    )
    readTodos = () => query.data
  })
  try {
    await vi.waitFor(() => {
      flushSync()
      expect(readTodos()).toMatchObject([{ id: '1' }])
    })
    const tx = todos.update('1', (draft) => {
      draft.done = true
    })
    await tx.isPersisted.promise
    await vi.waitFor(() => {
      flushSync()
      expect(readTodos()).toEqual([])
    })
  } finally {
    dispose()
    await todos.cleanup()
  }
})
```

[Runnable Svelte example](https://github.com/TanStack/db/blob/main/packages/svelte-db/tests/testing-guide.svelte.test.ts).

### Solid

`renderHook` owns a reactive root. Call the result accessor to read rows, and dispose that root with `cleanup`.

```tsx
import { eq } from '@tanstack/db'
import { renderHook, waitFor } from '@solidjs/testing-library'
import { expect, it } from 'vitest'
import { useLiveQuery } from '@tanstack/solid-db'

it('removes completed todos from the Solid query', async () => {
  const todos = makeTodos()
  const { result, cleanup } = renderHook(() =>
    useLiveQuery((q) =>
      q.from({ todo: todos }).where(({ todo }) => eq(todo.done, false)),
    ),
  )
  try {
    await waitFor(() => expect(result()).toMatchObject([{ id: '1' }]))
    const tx = todos.update('1', (draft) => {
      draft.done = true
    })
    await tx.isPersisted.promise
    await waitFor(() => expect(result()).toEqual([]))
  } finally {
    cleanup()
    await todos.cleanup()
  }
})
```

[Runnable Solid example](https://github.com/TanStack/db/blob/main/packages/solid-db/tests/testing-guide.test.tsx).

### Angular

Create the query synchronously inside `runInInjectionContext`, then await updates outside that callback. Read signals by calling them.

```ts
import { eq } from '@tanstack/db'
import { TestBed } from '@angular/core/testing'
import { expect, it, vi } from 'vitest'
import { injectLiveQuery } from '@tanstack/angular-db'

it('removes completed todos from the Angular query', async () => {
  const todos = makeTodos()
  try {
    const query = TestBed.runInInjectionContext(() =>
      injectLiveQuery((q) =>
        q.from({ todo: todos }).where(({ todo }) => eq(todo.done, false)),
      ),
    )
    await vi.waitFor(() => expect(query.data()).toMatchObject([{ id: '1' }]))
    const tx = todos.update('1', (draft) => {
      draft.done = true
    })
    await tx.isPersisted.promise
    await vi.waitFor(() => expect(query.data()).toEqual([]))
  } finally {
    TestBed.resetTestingModule()
    await todos.cleanup()
  }
})
```

[Runnable Angular example](https://github.com/TanStack/db/blob/main/packages/angular-db/tests/testing-guide.test.ts).

## Executable examples and contributor tests

The [core companion](https://github.com/TanStack/db/blob/main/packages/db/tests/testing-guide.test.ts)
and framework companions above exercise these public APIs with the repository test
configurations. Framework companions import their adapter source so the tests use
one copy of the core library. Application tests use the package imports shown here.
Keep the guide and companions together when changing a recipe. These focused examples
check that the documented setup works; they do not replace the subsystem oracles.

For changes to TanStack DB itself, start with the
[oracle testing guide](../contributing/oracle-tests.md) and
[coverage map](../contributing/oracle-coverage.md). The
[shared framework contract](https://github.com/TanStack/db/blob/main/packages/db/tests/conformance/contract.ts)
and each framework's driver define the broader behavior and observation boundaries.
