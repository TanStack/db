# @tanstack/graphql-db-collection

GraphQL runtime for TanStack DB - query-driven sync with GraphQL backends.

## Features

- **Query-Driven Sync**: Automatically translates TanStack DB predicates into GraphQL operations
- **Optimistic Mutations**: Instant UI updates with server reconciliation
- **Dialect Support**: Built-in adapters for Hasura, PostGraphile, Prisma, and generic GraphQL
- **Automatic Batching**: Combines multiple queries into single GraphQL requests
- **Progressive Sync**: Optional background data loading for instant local queries
- **Type-Safe**: Full TypeScript support with generated types

## Installation

```bash
npm install @tanstack/graphql-db-collection @tanstack/db @tanstack/query-core
```

## Usage

This package is typically used with generated code from `@tanstack/db-graphql`:

```bash
npx db-graphql build --schema ./schema.graphql --out ./src/db/graphql
```

See [@tanstack/db-graphql](../db-graphql) for the code generator.

### Manual Usage

You can also use this package directly:

```typescript
import { createCollection } from '@tanstack/db'
import { graphqlCollectionOptions, createGraphQLLink, createPlanner, createDialectAdapter } from '@tanstack/graphql-db-collection'
import { QueryClient } from '@tanstack/query-core'

const queryClient = new QueryClient()
const link = createGraphQLLink({
  endpoint: 'https://api.example.com/graphql',
})

const dialect = createDialectAdapter('hasura')
const schema = new Map() // Your schema metadata
const planner = createPlanner(dialect, schema)

const Post = createCollection(
  graphqlCollectionOptions({
    id: 'Post',
    getKey: (item) => item.id,
    queryClient,
    link,
    planner,
    dialect: 'hasura',
    typeInfo: {
      name: 'Post',
      scalarFields: ['id', 'title', 'content'],
      relationFields: ['author'],
      hasConnection: false,
      hasList: true,
    },
  })
)
```

## Dialects

### Hasura

```typescript
const dialect = createDialectAdapter('hasura')
```

- Where syntax: `{ field: { _eq: value }, _and: [...] }`
- Order by: `[{ field: asc }]`
- Mutations: `insert_table`, `update_table`, `delete_table`

### PostGraphile

```typescript
const dialect = createDialectAdapter('postgraphile')
```

- Where syntax: `{ field: { equalTo: value }, and: [...] }`
- Order by: `[FIELD_ASC]` (enum-based)
- Supports Relay connections
- Mutations: `createType`, `updateTypeById`, `deleteTypeById`

### Prisma

```typescript
const dialect = createDialectAdapter('prisma')
```

- Where syntax: `{ field: { equals: value }, AND: [...] }`
- Order by: `[{ field: 'asc' }]`
- Mutations: `createOneType`, `updateOneType`, `deleteOneType`

## Architecture

### Query-Driven Sync

When you write a TanStack DB live query:

```typescript
const { data } = useLiveQuery((q) =>
  q.from({ p: db.collections.Post })
   .where(({ p }) => eq(p.published, true))
   .limit(10)
)
```

The GraphQL collection:

1. Receives the predicate AST via `loadSubsetOptions`
2. Translates it to a GraphQL query with the planner
3. Executes the query via the link (with automatic batching)
4. Extracts rows from the response
5. Stores them in the local collection

Subsequent queries with overlapping predicates get **deduplicated** and **delta-loaded** automatically.

### Optimistic Mutations

```typescript
await db.collections.Post.insert({
  title: 'New Post',
  content: 'Hello!',
})
```

1. **Optimistic update**: Row appears instantly in UI
2. **Server request**: GraphQL mutation sent
3. **Reconciliation**: Server response patches local data (IDs, timestamps, etc.)
4. **Rollback**: Automatic if mutation fails

## License

MIT
