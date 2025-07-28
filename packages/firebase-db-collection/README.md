# @tanstack/firebase-db-collection

Firebase/Firestore collection integration for TanStack DB, providing real-time synchronization with Firestore databases.

## Installation

```bash
npm install @tanstack/firebase-db-collection firebase
# or
yarn add @tanstack/firebase-db-collection firebase
# or
pnpm add @tanstack/firebase-db-collection firebase
```

## Features

- 🔄 Real-time synchronization with Firestore
- 🚀 Optimistic updates with automatic rollback
- 📦 Batch operations with automatic chunking (respects Firestore's 500 write limit)
- 🔌 Offline support with persistence
- 🎯 Type-safe with full TypeScript support
- ⚡ Exponential backoff for network failures
- 🧹 Proper cleanup and garbage collection

## Basic Usage

```typescript
import { createCollection } from "@tanstack/db"
import { firebaseCollectionOptions } from "@tanstack/firebase-db-collection"
import { initializeApp } from "firebase/app"
import { getFirestore } from "firebase/firestore"

// Initialize Firebase
const app = initializeApp({
  // your config
})
const firestore = getFirestore(app)

// Define your item type
interface Todo {
  id: string
  text: string
  completed: boolean
  createdAt: Date
  updatedAt: Date
}

// Create a collection
const todosCollection = createCollection(
  firebaseCollectionOptions<Todo>({
    id: "todos",
    firestore,
    collectionName: "todos",
    getKey: (item) => item.id,
  })
)

// Wait for initial sync
await todosCollection.preload()

// Use the collection
await todosCollection.insert({
  id: "1",
  text: "Learn TanStack DB",
  completed: false,
  createdAt: new Date(),
  updatedAt: new Date(),
})
```

## Advanced Configuration

### Type Conversions

Handle Firestore-specific types like Timestamps:

```typescript
const collection = createCollection(
  firebaseCollectionOptions<Todo>({
    id: "todos",
    firestore,
    collectionName: "todos",
    // Convert Firestore Timestamps to JavaScript Dates
    parse: {
      createdAt: (timestamp) => timestamp.toDate(),
      updatedAt: (timestamp) => timestamp.toDate(),
    },
    // Convert JavaScript Dates to Firestore Timestamps
    serialize: {
      createdAt: (date) => Timestamp.fromDate(date),
      updatedAt: (date) => Timestamp.fromDate(date),
    },
  })
)
```

### Query Constraints

Filter and order your collection data:

```typescript
import { where, orderBy, limit } from "firebase/firestore"

const recentActiveTodos = createCollection(
  firebaseCollectionOptions<Todo>({
    id: "recent-active-todos",
    firestore,
    collectionName: "todos",
    queryConstraints: [
      where("completed", "==", false),
      where("createdAt", ">", thirtyDaysAgo),
      orderBy("createdAt", "desc"),
      limit(100),
    ],
  })
)
```

### Large Collections with Query Builder

For very large collections, sync only what you need:

```typescript
const userTodos = createCollection(
  firebaseCollectionOptions<Todo>({
    id: "user-todos",
    firestore,
    collectionName: "todos",
    queryBuilder: (baseQuery) =>
      query(
        baseQuery,
        where("userId", "==", currentUserId),
        orderBy("createdAt", "desc"),
        limit(1000)
      ),
  })
)
```

### Offline Persistence

Enable offline support:

```typescript
const collection = createCollection(
  firebaseCollectionOptions<Todo>({
    id: "todos",
    firestore,
    collectionName: "todos",
    offlinePersistence: {
      enabled: true,
      tabManager: "default", // or 'multiTab' for multi-tab support
    },
  })
)
```

### Auto-Generated IDs

Let Firestore generate document IDs:

```typescript
const collection = createCollection(
  firebaseCollectionOptions<Todo>({
    id: "todos",
    firestore,
    collectionName: "todos",
    autoId: true, // Firestore will generate IDs
  })
)
```

### Transaction Support for Strong Consistency

Use Firestore transactions for update operations:

```typescript
const collection = createCollection(
  firebaseCollectionOptions<Todo>({
    id: "todos",
    firestore,
    collectionName: "todos",
    useTransactions: true, // Updates use runTransaction
  })
)
```

## Batch Operations

The integration automatically handles Firestore's 500 write limit:

```typescript
// This will be automatically split into multiple batches if needed
await todosCollection.transaction.run(async (tx) => {
  for (let i = 0; i < 1000; i++) {
    tx.insert({
      id: `todo-${i}`,
      text: `Todo ${i}`,
      completed: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }
})
```

## Real-time Synchronization

Changes are automatically synchronized across all connected clients:

```typescript
// On Client A
await todosCollection.insert({ id: "1", text: "New todo", completed: false })

// On Client B (automatically synchronized)
const todos = todosCollection.getAll() // Includes the new todo
```

## Utilities

Access Firebase-specific utilities:

```typescript
// Cancel the real-time listener
todosCollection.utils.cancel()

// Get the Firestore collection reference
const collectionRef = todosCollection.utils.getCollectionRef()

// Wait for all pending writes
await todosCollection.utils.waitForSync()
```

## Testing with Emulator

Set up the Firebase emulator for testing:

```json
// firebase.json
{
  "emulators": {
    "firestore": {
      "port": 8080
    },
    "ui": {
      "enabled": true,
      "port": 4001
    }
  }
}
```

```typescript
// In tests
import { initializeTestEnvironment } from "@firebase/rules-unit-testing"

const testEnv = await initializeTestEnvironment({
  projectId: "test-project",
  firestore: {
    host: "localhost",
    port: 8080,
  },
})

const firestore = testEnv.unauthenticatedContext().firestore()
```

## Configuration Options

| Option                   | Type                  | Default     | Description                            |
| ------------------------ | --------------------- | ----------- | -------------------------------------- |
| `firestore`              | `Firestore`           | required    | Firestore instance                     |
| `collectionName`         | `string`              | required    | Firestore collection name              |
| `pageSize`               | `number`              | `1000`      | Items per page for initial fetch       |
| `parse`                  | `Conversions`         | `{}`        | Parse Firestore documents to items     |
| `serialize`              | `Conversions`         | `{}`        | Serialize items to Firestore documents |
| `autoId`                 | `boolean`             | `false`     | Use Firestore auto-generated IDs       |
| `queryConstraints`       | `QueryConstraint[]`   | `[]`        | Filter and order constraints           |
| `rowUpdateMode`          | `'partial' \| 'full'` | `'partial'` | How updates are applied                |
| `includeMetadataChanges` | `boolean`             | `false`     | Include metadata-only changes          |
| `offlinePersistence`     | `object`              | `undefined` | Offline persistence config             |
| `queryBuilder`           | `function`            | `undefined` | Custom query builder                   |
| `useTransactions`        | `boolean`             | `false`     | Use transactions for updates           |

## Error Handling

The integration provides specific error types:

```typescript
import {
  FirestoreIntegrationError,
  ExpectedInsertTypeError,
  ExpectedUpdateTypeError,
  ExpectedDeleteTypeError,
  TimeoutWaitingForIdsError,
} from "@tanstack/firebase-db-collection"

try {
  await collection.insert(item)
} catch (error) {
  if (error instanceof FirestoreIntegrationError) {
    console.error("Firestore error:", error.message)
  }
}
```

## License

MIT
