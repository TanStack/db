# TanStack DB Start SSR Demo

This example is a minimal TanStack Start app that demonstrates TanStack DB SSR
with collection-row hydration.

It verifies three things:

- server HTML contains rows loaded through a request-scoped `DbClient`
- the browser hydrates those rows into a client `DbClient`
- an incremental collection chunk updates an existing live query

Live demo: https://tanstack-db-ssr-demo.netlify.app/ssr-db

## Run Locally

```sh
pnpm --filter @tanstack/db build
pnpm --filter @tanstack/react-db build
pnpm --filter @tanstack/db-example-react-start-ssr-e2e dev
```

Open `/ssr-db`.

## Run E2E

```sh
pnpm --filter @tanstack/db-example-react-start-ssr-e2e test:e2e
```

The Playwright test checks raw SSR HTML first, then browser hydration, then an
incremental collection chunk.

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
