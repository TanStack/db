# React Action-Enforcement Example

This example uses ESLint to keep Collection mutations in action modules while
allowing feature code to read Collections with `useLiveQuery`.

## Run

From the repository root:

```bash
pnpm install
pnpm --filter @tanstack/db-example-react-action-enforcement... build
pnpm --filter @tanstack/db-example-react-action-enforcement dev
```

From this example directory, run `pnpm test`, `pnpm lint`, or `pnpm build`.
The example shares the repository lockfile and uses the workspace DB packages.
Tests cover the lint boundary and the todo form. The form preserves newer drafts
while an add settles and disables each row’s toggle while it has pending writes.
Add stays disabled until its current action settles. The input remains editable,
and submissions work again after success or failure. A failed toggle rolls back,
shows an error, and permits another attempt.

## What is enforced

In `src/features/**`, the custom rule rejects direct calls to `insert`, `update`,
`delete`, and `upsert` on ES imports from `@/db/collections`, its subpaths, and
relative paths such as `../../db/collections/todoCollection`. The default
patterns match import text: `@/db/collections` or one or more `./` or `../`
segments followed by `db/collections`, with an optional subpath. Aliases retain
this classification. Reads are allowed. Writes go through `src/db/actions/*`.

- `src/db/collections/todoCollection.ts` configures the Collection.
- `src/db/actions/todoActions.ts` defines optimistic actions and waits for server
  writes to sync back before each action completes.
- `src/features/todos/TodoApp.tsx` reads directly with `useLiveQuery` and calls actions.
- `eslint-rules/no-direct-collection-mutations.js` implements the rule.

The rule resolves lexical bindings, including aliases created by declarations,
assignments, and namespace destructuring. A callback can appear before its alias
is initialized. Dot access, quoted strings, and template literals without
interpolation identify static method names. Unrelated local variables with the
same name remain independent.
A variable assigned a Collection remains classified as a Collection throughout
its scope, even if another assignment gives it a different value.

This is a static, file-local example. It assumes exports from matching paths are
Collections or namespaces of Collections. It does not perform type checking or
resolve paths on disk, track CommonJS/import-equals bindings, or follow
re-exports, function arguments, factory returns, aliases stored in new
objects/arrays, extracted mutation functions, or dynamic method names. Configure
`collectionImportPatterns` (regular expressions) for your application's import
paths and `mutationMethods` for its write API.

For a stricter boundary, `eslint.config.mjs` includes a commented
`no-restricted-imports` alternative. That option also prohibits direct reads;
use the provided `src/db/queries/useTodos.ts` hook in feature code instead.

## Rejected code

This call in a feature module produces a lint error:

```ts
import { todoCollection } from '@/db/collections/todoCollection'

todoCollection.insert({
  id: crypto.randomUUID(),
  text: 'bad write',
  completed: false,
  createdAt: new Date(),
})
```

The rejected forms live in the test suite, so the runnable app passes lint.
The bounded syntax oracle checks reads and writes across alias forms, callback
orders, TypeScript wrappers, and lexical scopes using ESLint's public diagnostics.
