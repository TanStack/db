// The typical app, plus a collection persisted to localStorage.
import { createCollection, localStorageCollectionOptions } from '@tanstack/db'

export * from './app.js'

export const drafts = createCollection(
  localStorageCollectionOptions({
    storageKey: `drafts`,
    getKey: (draft) => draft.id,
  }),
)
