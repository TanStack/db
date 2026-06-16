# Offline Transactions Example

A todo app demonstrating `@tanstack/offline-transactions` with three different browser storage backends:

- **IndexedDB** — persistent structured storage via `IndexedDBAdapter`
- **localStorage** — simple key-value fallback via `LocalStorageAdapter`
- **wa-sqlite OPFS** — full SQLite database in the browser via `@tanstack/browser-db-sqlite-persistence`

The app uses TanStack Start in SPA mode with an in-memory server-side todo store. The server simulates network delays and random failures to demonstrate offline resilience.

## How to run

From the root of the repository:

```sh
pnpm install
pnpm build
```

Then from this directory:

```sh
pnpm dev
```

The app runs at http://localhost:3000.

## What it demonstrates

- **Outbox pattern** — mutations are persisted locally before syncing to the server
- **Automatic retry** — failed operations retry with exponential backoff when connectivity returns
- **Multi-tab coordination** — leader election ensures only one tab manages offline storage
- **Optimistic updates** — UI updates immediately while mutations sync in the background
- **Collection-level persistence** (wa-sqlite route) — data stored in a real SQLite database in the browser via OPFS, surviving page reloads without server sync
