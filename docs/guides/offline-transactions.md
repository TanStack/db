---
title: Offline Transactions
id: offline-transactions
---

`@tanstack/offline-transactions` gives the leader a durable outbox for pending mutations. The executor retries stored mutations when it can reach the server. The leader restores their optimistic state after a restart.

The outbox stores pending writes. [SQLite persistence](./sqlite-persistence.md) stores Collection rows. It can also save sync metadata for supported adapters. You can use either package alone or use them together.

## Start on the web

Install the package:

```sh
npm install @tanstack/offline-transactions
```

This example starts from an existing `todos` Collection. The server must accept the same idempotency key on repeated requests.

Keep the `collections` registry keys and Collection IDs stable across restarts. The executor uses that registry to restore stored mutations.

An action enters the outbox only while `executor.isOfflineEnabled` is true. This requires available storage and leadership. Otherwise, the action uses the online-only path without durable retry.

```ts
import {
  NonRetriableError,
  startOfflineExecutor,
} from '@tanstack/offline-transactions'

type Todo = { id: string; title: string; completed: boolean }

const executor = startOfflineExecutor({
  collections: { todos },
  mutationFns: {
    saveTodo: async ({ transaction, idempotencyKey }) => {
      const todo = transaction.mutations[0]?.modified as Todo | undefined
      if (!todo) throw new NonRetriableError('Todo mutation is missing')

      const response = await fetch('/api/todos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(todo),
      })

      if (response.status === 422) {
        throw new NonRetriableError('The server rejected this todo')
      }
      if (!response.ok) throw new Error('Could not save the todo')

      // Wait for a server read or sync observation here if your app needs it.
    },
  },
})

await executor.waitForInit()

const addTodo = executor.createOfflineAction<Todo>({
  mutationFnName: 'saveTodo',
  onMutate: (todo) => {
    todos.insert(todo)
  },
})

const transaction = addTodo({
  id: crypto.randomUUID(),
  title: 'Buy milk',
  completed: false,
})

// Report final failure. This promise can stay pending offline.
void transaction.isPersisted.promise.catch((error) => console.error(error))
```

`onMutate` must be synchronous. It applies the optimistic change before the executor writes the outbox entry. If that write fails, the transaction fails. A visible optimistic change alone does not prove durable storage.

When `isOfflineEnabled` is true, the executor calls the named `mutationFn` after it records the transaction. A temporary error leaves the entry available for retry. `NonRetriableError` marks a permanent failure and rolls back optimistic state.

The executor sends a stable `idempotencyKey` with each attempt. A server can receive an attempt more than once, especially after a restart or leadership change. Make the server treat repeated keys as one logical mutation.

## Wait for the right result

`waitForInit()` waits for storage setup, leader election, and the initial outbox read. It does not wait for every pending mutation to reach the server.

`transaction.isPersisted.promise` settles when the offline transaction completes
or fails. Successful settlement means the configured `mutationFn` returned and
the storage adapter acknowledged outbox deletion. It proves server confirmation
only if that function waits for a server acknowledgement, read-back, or sync
observation. If deletion fails, the promise remains pending while the executor
retries. A server must honor the supplied idempotency key because a crash before
the executor records provider completion can replay the request.

Do not await `isPersisted.promise` before you show an offline page. A pending mutation can keep that promise open until connectivity returns. Use it to update submission status or report a final error.

For a multi-step manual transaction, use `createOfflineTransaction`:

```ts
const offlineTransaction = executor.createOfflineTransaction({
  mutationFnName: 'saveBatch',
  autoCommit: false,
})

offlineTransaction.mutate(() => {
  todos.insert({ id: crypto.randomUUID(), title: 'First', completed: false })
  todos.insert({ id: crypto.randomUUID(), title: 'Second', completed: false })
})

void offlineTransaction.commit().catch((error) => console.error(error))
```

Register `saveBatch` in `mutationFns` before you use this example. `commit()` can remain pending during an offline period. The executor also offers `createOfflineAction` for one synchronous optimistic action.

## Storage and leadership

On the web, the executor tests IndexedDB first. It uses localStorage if IndexedDB is unavailable. You can pass a `storage` adapter to choose a different store.

One tab leads outbox processing. The executor prefers Web Locks and then BroadcastChannel for leader election. A follower uses the normal online mutation path without an outbox entry. The same online-only path applies when durable storage is unavailable.

If neither election API exists, the current fallback treats the tab as the leader. It does not coordinate multiple tabs.

Check `mode`, `storageDiagnostic`, and `isOfflineEnabled` after `waitForInit()`. `mode` describes storage availability. `isOfflineEnabled` also requires leadership.

```ts
await executor.waitForInit()

console.log(executor.mode)
console.log(executor.storageDiagnostic)
console.log(executor.isOfflineEnabled)
```

Use `onStorageFailure` when the built-in web stores are unavailable. Use `onLeadershipChange` when the UI needs to show which tab owns the outbox. A follower can become the leader after the current leader leaves.

## React Native and Expo

Install the package, its network detector, and storage for the example adapter. Copy the [AsyncStorageAdapter example](https://github.com/TanStack/db/blob/main/examples/react-native/offline-transactions/src/db/AsyncStorageAdapter.ts) into your app before you import it:

```sh
npm install @tanstack/offline-transactions @react-native-community/netinfo @react-native-async-storage/async-storage
```

```ts
import { startOfflineExecutor } from '@tanstack/offline-transactions/react-native'
import { AsyncStorageAdapter } from './AsyncStorageAdapter'

const executor = startOfflineExecutor({
  collections: { todos },
  storage: new AsyncStorageAdapter('offline-todos:'),
  mutationFns: { saveTodo },
})

await executor.waitForInit()
```

The `saveTodo` function and `todos` Collection use the same roles as the web example. `AsyncStorageAdapter` is an application adapter. The package does not export it. A custom adapter must implement `get`, `set`, `delete`, `keys`, and `clear` from `StorageAdapter`.

The executor does not probe a custom storage adapter. If the initial outbox read fails, `waitForInit()` rejects. Handle that error during app startup.

The React Native entry point uses `ReactNativeOnlineDetector` by default. It uses NetInfo and app state events. Pass `onlineDetector` if your app needs another connectivity rule.

## Inspect and manage pending work

```ts
const entries = await executor.peekOutbox()
const pending = executor.getPendingCount()
const running = executor.getRunningCount()
```

The counts describe local work. An outbox entry can include a retry count, next attempt time, and last error. None of these values proves that the server applied the mutation.

`beforeRetry` can remove entries during replay. `onUnknownMutationFn` reports an entry whose registered function is missing. Keep mutation function names stable across releases, or define a migration for stored entries.

The executor also exposes `removeFromOutbox(id)` and `clearOutbox()`. Use these only when the application decides to discard pending writes. Call `dispose()` when the executor's owner ends.

## Use SQLite persistence with the outbox

This React Native recipe stores applied Collection rows in OP-SQLite and pending mutations in AsyncStorage. The Query Collection supplies server sync. Install the packages for both stores and for Query Collection sync:

```sh
npm install @tanstack/db @tanstack/query-core @tanstack/query-db-collection \
  @tanstack/react-native-db-sqlite-persistence @op-engineering/op-sqlite \
  @tanstack/offline-transactions @react-native-async-storage/async-storage \
  @react-native-community/netinfo
```

Copy the [AsyncStorage adapter](https://github.com/TanStack/db/blob/main/examples/react-native/offline-transactions/src/db/AsyncStorageAdapter.ts) into your app. It implements `StorageAdapter`. Neither package exports this adapter. Use an absolute server URL that your device can reach.

Keep the SQLite file name, Collection ID, `todos` registry key, `saveTodo` name, and outbox prefix stable across restarts. The server must treat repeated `Idempotency-Key` values as one mutation. The executor can retry a request after the server applies it.

```ts
import { open } from '@op-engineering/op-sqlite'
import { QueryClient } from '@tanstack/query-core'
import { createCollection } from '@tanstack/db'
import {
  NonRetriableError,
  startOfflineExecutor,
} from '@tanstack/offline-transactions/react-native'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import {
  createReactNativeSQLitePersistence,
  persistedCollectionOptions,
} from '@tanstack/react-native-db-sqlite-persistence'
import { AsyncStorageAdapter } from './AsyncStorageAdapter'

type Todo = { id: string; title: string; completed: boolean }
const apiUrl = 'https://api.example.com/todos' // Replace with your server URL.

const database = open({ name: 'todos.sqlite', location: 'default' })
const persistence = createReactNativeSQLitePersistence({ database })
const queryClient = new QueryClient()

const todos = createCollection(
  persistedCollectionOptions<Todo, string>({
    ...queryCollectionOptions<Todo, string>({
      id: 'todos',
      queryClient,
      queryKey: ['todos'],
      queryFn: async () => {
        const response = await fetch(apiUrl)
        if (!response.ok) throw new Error('Could not load todos')
        return (await response.json()) as Array<Todo>
      },
      getKey: (todo) => todo.id,
    }),
    persistence,
    schemaVersion: 1,
  }),
)

const executor = startOfflineExecutor({
  collections: { todos },
  storage: new AsyncStorageAdapter('offline-todos:'),
  mutationFns: {
    saveTodo: async ({ transaction, idempotencyKey }) => {
      const todo = transaction.mutations[0]?.modified as Todo | undefined
      if (!todo) throw new NonRetriableError('Todo mutation is missing')

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(todo),
      })

      if (response.status === 422) {
        throw new NonRetriableError('The server rejected this todo')
      }
      if (!response.ok) throw new Error('Could not save the todo')
      await todos.utils.refetch()
    },
  },
})

await executor.waitForInit()
void todos.preload().catch((error) => console.error(error))

const addTodo = executor.createOfflineAction<Todo>({
  mutationFnName: 'saveTodo',
  onMutate: (todo) => {
    todos.insert(todo)
  },
})

const transaction = addTodo({
  id: crypto.randomUUID(),
  title: 'Buy milk',
  completed: false,
})
void transaction.isPersisted.promise.catch((error) => console.error(error))
```

For the leader, `waitForInit()` waits for the initial outbox read and optimistic restoration attempt. It does not make `todos` ready. The separate `preload()` call starts Collection loading without blocking offline actions. A screen that needs initial rows can await `todos.preload()` and handle a rejection.

The final `refetch()` asks the server for current rows after a successful write. By default, it can resolve when that read fails. The offline transaction can then settle successfully because the POST succeeded. That read error does not itself request an outbox retry. Check `todos.utils.isError` and `todos.utils.lastError` to report or retry the read.

The [React Native offline transactions example](https://github.com/TanStack/db/tree/main/examples/react-native/offline-transactions) shows the full app structure. Its API client does not yet send an idempotency key, so use the request pattern above when you adapt it. The [shopping list example](https://github.com/TanStack/db/tree/main/examples/react-native/shopping-list) also shows Electric sync.

The [Electron example](https://github.com/TanStack/db/tree/main/examples/electron/offline-first) uses a custom SQLite-backed `StorageAdapter` for the outbox. That adapter is separate from the persisted Collection tables.
