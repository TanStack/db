// A Collection persisted to localStorage.
import { createCollection, localStorageCollectionOptions } from '@tanstack/db'

const drafts = createCollection(
  localStorageCollectionOptions({
    storageKey: `drafts`,
    getKey: (draft) => draft.id,
  }),
)
drafts.insert({ id: 1, body: `` })
