# TanStack DB Start SSR Demo

This example is a minimal TanStack Start app that demonstrates TanStack DB SSR
with collection-row hydration.

It verifies five things:

- server HTML contains rows loaded through a request-scoped `DbClient`
- the browser hydrates those rows into a client `DbClient`
- fresh adapter sync replaces a stale hydrated row with the same key
- an incremental collection chunk updates an existing live query
- critical collection rows hydrate while a query discovered later in the same
  render streams through a Suspense boundary

Live demo: https://tanstack-db-ssr-demo.netlify.app/ssr-db

## Run Locally

```sh
pnpm --filter @tanstack/db build
pnpm --filter @tanstack/react-db build
pnpm --filter @tanstack/db-example-react-start-ssr-e2e dev
```

Open `/ssr-db` for holistic and incremental hydration, or `/ssr-db-stream` for
render-time Suspense streaming.

## Run E2E

```sh
pnpm --filter @tanstack/db-example-react-start-ssr-e2e test:e2e
```

The Playwright tests cover raw SSR HTML, browser hydration, fresh-sync
reconciliation, incremental collection hydration, and critical hydration plus a
render-time query in the same request. The streaming route shows its Suspense
fallback before the streamed server rows arrive.

## Deploy Demo

The demo requires an SSR-capable host for TanStack Start.

Netlify deployment is configured through `netlify.toml` and
`netlify/functions/server.mjs`. Deploy with:

```sh
cd examples/react/start-ssr-e2e
netlify deploy --prod --site-name tanstack-db-ssr-demo --team tanstack
```

After deployment, verify the live URL with:

```sh
PLAYWRIGHT_BASE_URL=https://your-demo-url pnpm --filter @tanstack/db-example-react-start-ssr-e2e test:e2e:hosted
```
