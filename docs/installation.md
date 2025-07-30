---
title: Installation
id: installation
---

Each supported framework comes with its own package. Each framework package re-exports everything from the core `@tanstack/db` package.

## React

```sh
npm install @tanstack/react-db
```

TanStack DB is compatible with React v16.8+

## Solid

```sh
npm install @tanstack/solid-db
```

## Svelte

```sh
npm install @tanstack/svelte-db
```

## Vue

```sh
npm install @tanstack/vue-db
```

TanStack DB is compatible with Vue v3.3.0+

## Vanilla JS

```sh
npm install @tanstack/db
```

Install the the core `@tanstack/db` package to use DB without a framework.

## Collection Packages

TanStack DB also provides specialized collection packages for different data sources and storage needs:

### Query Collection

For loading data using TanStack Query:

```sh
npm install @tanstack/query-db-collection
```

Use `queryCollectionOptions` to fetch data into collections using TanStack Query. This is perfect for REST APIs and existing TanStack Query setups.

### Local Collections

Local storage and in-memory collections are included with the framework packages:

- **LocalStorageCollection** - For persistent local data that syncs across browser tabs
- **LocalOnlyCollection** - For temporary in-memory data and UI state

Both use `localStorageCollectionOptions` and `localOnlyCollectionOptions` respectively, available from your framework package (e.g., `@tanstack/react-db`).

### Sync Engines

#### Electric Collection

For real-time sync with [ElectricSQL](https://electric-sql.com):

```sh
npm install @tanstack/electric-db-collection
```

Use `electricCollectionOptions` to sync data from Postgres databases through ElectricSQL shapes. Ideal for real-time, local-first applications.

#### TrailBase Collection

For syncing with [TrailBase](https://trailbase.io) backends:

```sh
npm install @tanstack/trailbase-db-collection
```

Use `trailBaseCollectionOptions` to sync records from TrailBase's Record APIs with built-in subscription support.
