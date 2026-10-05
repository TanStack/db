---
name: db-core/testing
description: >
  Test applications that use TanStack DB. Choose local fixtures or controlled
  sync, test optimistic success and rollback, and mount framework queries with
  the correct scheduler and cleanup. Use when writing application tests or
  configuring their test environment.
type: sub-skill
library: db
library_version: '0.11.3'
sources:
  - 'TanStack/db:docs/guides/testing.md'
  - 'TanStack/db:packages/db/tests/testing-guide.test.ts'
---

# Testing applications with TanStack DB

Read the [testing guide](https://tanstack.com/db/latest/docs/guides/testing)
for fixtures and framework recipes. The
[repository copy](https://github.com/TanStack/db/blob/main/docs/guides/testing.md)
links to executable companions for React, Vue, Svelte, Solid, Angular, and core.
Use the companion for the framework in the application.

## Choose the boundary

- Use `localOnlyCollectionOptions({ initialData, getKey })` for component and local editing tests.
- Use controlled `sync` callbacks for loading and incoming server changes.
  Await the receipt from `commit()` before asserting source rows.
  Call `markReady()` when the initial snapshot is available, including an empty snapshot.
- Hold the request promise to check optimistic state before settlement.
  Test success and rejection separately. Attach rejection assertions before rejecting.
  Include server acknowledgement when testing a synced Collection.
- Keep the real adapter for tests of backend behavior. Local fixtures do not prove network or persistence behavior.

## Mount and dispose correctly

Create a fresh Collection for each test. Dispose the framework query before
awaiting Collection cleanup. A unique ID does not replace cleanup.

Use React `act`, Vue `effectScope` and `nextTick`, Svelte `$effect.root` and
`flushSync`, Solid's reactive root, or Angular's injection context as appropriate.
Svelte rune tests need a `*.svelte.test.ts` filename and its compiler plugin.
Create Angular queries synchronously in the injection context, then await outside it.
Retry assertions about public results instead of adding arbitrary sleeps.

Use partial matching for selected fields or explicit projections for exact equality.
Assert virtual properties when they are relevant to the test.

For library contributions, use the
[oracle guide](https://github.com/TanStack/db/blob/main/docs/contributing/oracle-tests.md)
and [coverage map](https://github.com/TanStack/db/blob/main/docs/contributing/oracle-coverage.md)
to find the existing owner before adding a model.
