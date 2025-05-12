# @tanstack/db-collections

A collection of TanStack DB Collections.

## Installation

```bash
# Using pnpm (recommended)
pnpm add @tanstack/react-optimistic @tanstack/db-collections

# If using TanStack Query integration
pnpm add @tanstack/query-core

# If using ElectricSQL integration
pnpm add @electric-sql/client
```

## Overview

This package provides specialized collection implementations for querying and syncing data:

- `QueryCollection`: Integrates with TanStack Query for data fetching and synchronization
- `ElectricCollection`: Integrates with ElectricSQL for real-time sync straight out of Postgres.

For usage examples, please refer to the [TanStack Optimistic documentation](https://github.com/TanStack/optimistic/blob/main/packages/optimistic/README.md).

## QueryCollection

`QueryCollection` integrates TanStack Optimistic's `Collection` with TanStack Query, providing a reactive data collection that automatically syncs with your query results.

### Features

- Automatic synchronization with TanStack Query results
- Optimistic updates for a responsive UI
- Efficient change detection with shallow equality checks
- Support for many TanStack Query features (refetching, invalidation, etc.) (we'd like to support more).

### API

#### `createQueryCollection(config)`

Creates a new `QueryCollection` instance.

**Config Options:**

- `queryClient`: The TanStack Query client instance
- `queryKey`: The query key for this collection
- `queryFn`: The function to fetch data
- `getPrimaryKey`: Function to extract the primary key from an item
- `enabled`: Whether the query is enabled (default: `true`)
- `refetchInterval`: Auto-refetch interval in milliseconds (optional)
- `retry`: Number of retry attempts for failed queries (optional)
- `retryDelay`: Delay between retry attempts (optional)

#### `QueryCollection` Methods

- `invalidate()`: Invalidates the query, triggering a refetch
- All methods inherited from TanStack Optimistic's `Collection`

## ElectricCollection

`ElectricCollection` integrates TanStack Optimistic's `Collection` with ElectricSQL for sync-based applications, providing a reactive data collection that automatically syncs with your Postgres database.

### Features

- Automatic synchronization with Postgres data

### API

#### `createElectricCollection(config)`

Creates a new `ElectricCollection` instance.

**Config Options:**

- `streamOptions`: Configuration options for the [ElectricSQL's ShapeStream](https://electric-sql.com/docs/api/clients/typescript#shapestream)
  - `params.table`: The table name to sync with
  - Other ShapeStream options from ElectricSQL
- `primaryKey`: Array of column names that form the primary key of the shape
- All other options inherited from TanStack Optimistic's `Collection`

#### `ElectricCollection` Methods

- `awaitTxId(txId, timeout)`: Waits for a specific transaction ID to be synced
  - `txId`: The transaction ID to wait for
  - `timeout`: Optional timeout in milliseconds (defaults to 30000ms)
  - Returns a Promise that resolves when the txId is synced
- All methods inherited from TanStack Optimistic's `Collection`

## License

MIT
