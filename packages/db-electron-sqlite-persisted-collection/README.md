# @tanstack/db-electron-sqlite-persisted-collection

Electron main/renderer bridge for TanStack DB SQLite persistence.

## Entrypoints

- `@tanstack/db-electron-sqlite-persisted-collection` (all exports)
- `@tanstack/db-electron-sqlite-persisted-collection/main`
- `@tanstack/db-electron-sqlite-persisted-collection/renderer`

## Exported API (complete)

### Root entrypoint (`.`)

#### Error APIs

- `ElectronPersistenceError`
- `UnknownElectronPersistenceCollectionError`
- `UnsupportedElectronPersistenceMethodError`
- `ElectronPersistenceProtocolError`
- `ElectronPersistenceTimeoutError`
- `ElectronPersistenceRpcError`

#### Protocol APIs

- `ELECTRON_PERSISTENCE_PROTOCOL_VERSION`
- `DEFAULT_ELECTRON_PERSISTENCE_CHANNEL`
- `ElectronPersistedRow`
- `ElectronPersistedKey`
- `ElectronPersistenceMethod`
- `ElectronPersistencePayloadMap`
- `ElectronPersistenceResultMap`
- `ElectronSerializedError`
- `ElectronPersistenceRequestByMethod`
- `ElectronPersistenceRequest<TMethod>`
- `ElectronPersistenceRequestEnvelope`
- `ElectronPersistenceResponse<TMethod>`
- `ElectronPersistenceResponseEnvelope`
- `ElectronPersistenceRequestHandler`
- `ElectronPersistenceInvoke`

#### Main-process APIs

- `ElectronPersistenceMainHost`
- `createElectronPersistenceMainHost(...)`
- `ElectronPersistenceMainRegistry`
- `ElectronNodeSQLiteMainCollectionConfig`
- `ElectronNodeSQLiteMainRegistryOptions`
- `createElectronNodeSQLiteMainRegistry(...)`
- `ElectronIpcMainLike`
- `registerElectronPersistenceMainIpcHandler(...)`

#### Renderer-process APIs

- `ElectronRendererPersistenceAdapterOptions`
- `ElectronRendererPersistenceAdapter<T, TKey>`
- `createElectronRendererPersistenceAdapter<T, TKey>(...)`
- `ElectronRendererPersistenceOptions`
- `ElectronRendererPersister`
- `createElectronRendererPersister(...)`
- `createElectronRendererPersistence<T, TKey>(...)`
- `ElectronIpcRendererLike`
- `createElectronPersistenceInvoke(...)`

### `./main` entrypoint

Exports only main-process APIs:

- `ElectronPersistenceMainHost`
- `createElectronPersistenceMainHost(...)`
- `ElectronPersistenceMainRegistry`
- `ElectronNodeSQLiteMainCollectionConfig`
- `createElectronNodeSQLiteMainRegistry(...)`
- `ElectronIpcMainLike`
- `registerElectronPersistenceMainIpcHandler(...)`

### `./renderer` entrypoint

Exports only renderer-process APIs:

- `ElectronRendererPersistenceAdapterOptions`
- `ElectronRendererPersistenceAdapter<T, TKey>`
- `createElectronRendererPersistenceAdapter<T, TKey>(...)`
- `ElectronRendererPersistenceOptions`
- `createElectronRendererPersistence<T, TKey>(...)`
- `ElectronIpcRendererLike`
- `createElectronPersistenceInvoke(...)`

## Minimal setup

### Main process

```ts
import { ipcMain } from 'electron'
import { createBetterSqlite3Driver } from '@tanstack/db-node-sqlite-persisted-collection'
import {
  createElectronNodeSQLiteMainRegistry,
  registerElectronPersistenceMainIpcHandler,
} from '@tanstack/db-electron-sqlite-persisted-collection/main'

const driver = createBetterSqlite3Driver({
  filename: `./tanstack-db.sqlite`,
})

const registry = createElectronNodeSQLiteMainRegistry({
  adapterOptions: {
    driver,
    schemaVersion: 1,
  },
  // Optional allow-list; omit to allow any collection id over this adapter.
  collectionIds: [`todos`],
})

const unregister = registerElectronPersistenceMainIpcHandler({
  ipcMain,
  host: registry.createHost(),
})

// Call unregister() during app shutdown if needed.
// Close driver when your app exits.
```

### Renderer process

```ts
import { createCollection } from '@tanstack/db'
import { ipcRenderer } from 'electron'
import { persistedCollectionOptions } from '@tanstack/db-sqlite-persisted-collection-core'
import {
  createElectronPersistenceInvoke,
  createElectronRendererPersistence,
} from '@tanstack/db-electron-sqlite-persisted-collection/renderer'

type Todo = { id: string; title: string; completed: boolean }

const persistence = createElectronRendererPersistence<Todo, string>({
  invoke: createElectronPersistenceInvoke(ipcRenderer),
})

export const todosCollection = createCollection(
  persistedCollectionOptions<Todo, string>({
    id: `todos`,
    getKey: (todo) => todo.id,
    persistence,
  }),
)
```
