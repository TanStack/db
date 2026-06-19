# TanStack DB SSR Release Plan

## Release Goal

Ship TanStack DB SSR as a single coherent story:

- collection-row hydration through `DbClient`
- React provider and descriptor resolution
- derived live query identity with `queryKey` only when necessary
- backwards-compatible dependency arrays with dev warnings until 1.0
- a working TanStack Start demo and E2E proof

## Pre-release Validation

- Run `pnpm --filter @tanstack/db test`.
- Run `pnpm --filter @tanstack/react-db test`.
- Run `pnpm --filter @tanstack/query-db-collection test`.
- Run `pnpm --filter @tanstack/db-sqlite-persistence-core test`.
- Run `pnpm --filter @tanstack/db-example-react-start-ssr-e2e test:e2e`.
- Run `pnpm test:docs`.
- Run `pnpm test:sherif`.
- Run `pnpm build`.

## Demo

- Live URL: https://tanstack-db-ssr-demo.netlify.app/ssr-db
- Deploy `examples/react/start-ssr-e2e` to an SSR-capable host.
- Verify the deployed `/ssr-db` route serves SSR HTML with hydrated rows.
- Verify browser hydration succeeds without console/page errors.
- Verify the streamed collection chunk updates the live query.
- Run `PLAYWRIGHT_BASE_URL=https://tanstack-db-ssr-demo.netlify.app pnpm --filter @tanstack/db-example-react-start-ssr-e2e test:e2e:hosted`.
- Add the live URL to the PR description and release notes.

## Docs

- Publish the [SSR and Hydration guide](../docs/guides/ssr.md).
- Link the guide from overview, quick start, live queries, and React overview.
- Regenerate API reference docs in a dedicated docs-maintenance pass if broad
  TypeDoc output churn is acceptable.
- Confirm docs explain when `queryKey` is necessary and when it should be
  omitted.
- Confirm docs say dependency arrays warn now and are removed in 1.0.

## Migration Messaging

- Lead with: SSR hydration is collection-row based.
- Emphasize that existing apps keep working.
- State that `createCollection(...)` remains available, but SSR apps should use
  `collectionOptions(...)` plus `DbClient`.
- Explain that React dependency arrays are deprecated with a 1.0 removal path.
- Show `queryKey` only for opaque functional query logic or hot render paths.

## Announcement Checklist

- PR description includes high-level summary, migration cheat sheet, and test
  commands.
- Release notes include a "No removals in this release" compatibility section.
- Discord announcement links the SSR guide and live demo.
- Example migration diff is available from the Start SSR demo.
- Follow-up issues are filed for non-React framework parity and API reference
  generation if they are not part of the shipping PR.
