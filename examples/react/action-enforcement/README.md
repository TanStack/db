# React Action-Enforcement Example

This example demonstrates how to enforce action-only mutations with TanStack DB.

## What is enforced

- Feature/UI code (`src/features/**`) can import collections for read/query use.
- Feature/UI code cannot call collection mutation methods directly (`insert`, `update`, `delete`, `upsert`).
- Writes are performed through `src/db/actions/*` only.

This is enforced by a custom ESLint rule in `eslint-rules/no-direct-collection-mutations.js`, wired in `eslint.config.mjs`.
The rule uses `collectionImportPatterns` (list of regex strings) to match collection import paths.
An alternative strict import-ban approach using `no-restricted-imports` is included as commented config in `eslint.config.mjs`.

## Run

```bash
pnpm install
pnpm dev
```

## Real pattern shown

- `src/db/collections/todoCollection.ts`: collection wiring
- `src/db/actions/todoActions.ts`: `createOptimisticAction` mutations
- `src/features/todos/TodoApp.tsx`: reads directly with `useLiveQuery` and includes an intentional invalid direct mutation example
- `eslint-rules/no-direct-collection-mutations.js`: custom lint rule

## Intentional anti-pattern (will fail lint)

```ts
// src/features/todos/TodoApp.tsx
import { todoCollection } from '@/db/collections/todoCollection'

todoCollection.insert({
  id: crypto.randomUUID(),
  text: 'bad write',
  completed: false,
  createdAt: new Date(),
})
```

Running `pnpm lint` will reject this mutation call.

If you want a clean lint pass, remove the intentional direct mutation call in `src/features/todos/TodoApp.tsx`.
