---
"@tanstack/db-collections": patch
"@tanstack/db-example-react-todo": patch
"@tanstack/db": patch
---

This change introduces a more streamlined and intuitive API for handling mutations by allowing `onInsert`, `onUpdate`, and `onDelete` handlers to be defined directly on the collection configuration.

When `collection.insert()`, `.update()`, or `.delete()` are called outside of an explicit transaction (i.e., not within `useOptimisticMutation`), the library now automatically creates a single-operation transaction and invokes the corresponding handler to persist the change.

Key changes:

- **`@tanstack/db`**: The `Collection` class now supports `onInsert`, `onUpdate`, and `onDelete` in its configuration. Direct calls to mutation methods will throw an error if the corresponding handler is not defined.
- **`@tanstack/db-collections`**:
  - `queryCollectionOptions` now accepts the new handlers and will automatically `refetch` the collection's query after a handler successfully completes. This behavior can be disabled if the handler returns `{ refetch: false }`.
  - `electricCollectionOptions` also accepts the new handlers. These handlers are now required to return an object with a transaction ID (`{ txid: string }`). The collection then automatically waits for this `txid` to be synced back before resolving the mutation, ensuring consistency.
- **Breaking Change**: Calling `collection.insert()`, `.update()`, or `.delete()` without being inside a `useOptimisticMutation` callback and without a corresponding persistence handler (`onInsert`, etc.) configured on the collection will now throw an error.

This new pattern simplifies the most common use cases, making the code more declarative. The `useOptimisticMutation` hook remains available for more complex scenarios, such as transactions involving multiple mutations across different collections.

---

The documentation and the React Todo example application have been significantly refactored to adopt the new direct persistence handler pattern as the primary way to perform mutations.

- The `README.md` and `docs/overview.md` files have been updated to de-emphasize `useOptimisticMutation` for simple writes. They now showcase the much simpler API of calling `collection.insert()` directly and defining persistence logic in the collection's configuration.
- The React Todo example (`examples/react/todo/src/App.tsx`) has been completely overhauled. All instances of `useOptimisticMutation` have been removed and replaced with the new `onInsert`, `onUpdate`, and `onDelete` handlers, resulting in cleaner and more concise code.
