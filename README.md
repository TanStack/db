# sync
Sync in data, mutate the data, sync back the changes

## Features

### Preloading Collections

The `preloadCollection` function allows you to preload data for collections before rendering routes or components. This is useful when you want to ensure that data is available immediately when a component renders, improving the user experience by preventing loading states.

```typescript
// collections/users.ts - Shared collection configuration
import { CollectionConfig } from '@kylemathews/sync';

// Create a cached configuration for the users collection
export const usersCollectionConfig: CollectionConfig = {
  id: 'users',
  sync: {
    id: 'users-sync',
    sync: ({ begin, write, commit }) => {
      // Your sync implementation
      // ...
    }
  },
  mutationFn: {
    persist: async () => {
      // Your mutation implementation
      // ...
    }
    awaitSync: async () => {
      // Your awaitSync implementation
      // ...
    }
  }
};

// routes/users.ts - Route loader
import { preloadCollection } from '@kylemathews/sync';
import { usersCollectionConfig } from '../collections/users';

export async function loader() {
  // Preload the collection data using the shared cached config
  await preloadCollection(usersCollectionConfig);
  return null;
}

// components/Users.tsx - Component using the collection
import { useCollection } from '@kylemathews/sync';
import { usersCollectionConfig } from '../collections/users';

export function UsersComponent() {
  // Uses the same cached collection config, ensuring consistency
  const { data } = useCollection(usersCollectionConfig);
  
  // Data is already loaded, no need for loading states
  return (
    <div>
      <h1>Users</h1>
      <ul>
        {Array.from(data.values()).map(user => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
    </div>
  );
}
```

When you call `preloadCollection`, it:
1. Returns a promise that resolves once the initial sync is complete
2. Makes the data immediately available to any `useCollection` hooks with the same ID
3. Ensures that duplicate calls with the same ID return the same promise

This allows route transitions to pause until needed data is loaded, creating a smoother user experience.
