# @tanstack/db-graphql

GraphQL schema compiler for TanStack DB. Generates typed collections from GraphQL schemas.

## Features

- **Schema-to-Collections**: Compiles GraphQL schemas into fully-typed TanStack DB collections
- **Query-Driven Sync**: Leverages TanStack DB v0.5 query-driven sync
- **Dialect Support**: Hasura, PostGraphile, Prisma, and generic GraphQL servers
- **Type Generation**: Full TypeScript types from your schema
- **Optimistic Mutations**: Automatic optimistic updates with server reconciliation
- **Progressive Sync**: Optional background loading for instant local queries

## Installation

```bash
npm install -D @tanstack/db-graphql
npm install @tanstack/graphql-db-collection @tanstack/db @tanstack/query-core
```

## CLI Usage

### Build Command

Generate a typed GraphQL client from your schema:

```bash
db-graphql build \
  --schema ./schema.graphql \
  --out ./src/db/graphql \
  --endpoint https://api.example.com/graphql \
  --dialect hasura \
  --sync-mode default=on-demand,Post=progressive
```

### Options

- `--schema <path>` (required): GraphQL schema file, URL, or introspection JSON
- `--out <dir>` (required): Output directory for generated code
- `--endpoint <url>`: GraphQL endpoint URL (saved in generated config)
- `--dialect <dialect>`: Server dialect (`hasura`, `postgraphile`, `prisma`, `generic`)
- `--sync-mode <mode>`: Sync mode configuration (e.g., `default=on-demand,Post=progressive`)
- `--namespace <name>`: Namespace for generated code (default: `GraphQL`)
- `--header <header>`: HTTP headers for introspection (repeatable)

### Schema Sources

```bash
# Remote endpoint
db-graphql build --schema https://api.example.com/graphql --out ./src/db

# Local SDL file
db-graphql build --schema ./schema.graphql --out ./src/db

# Introspection JSON
db-graphql build --schema ./schema.json --out ./src/db
```

### Sync Modes

Control how data is loaded:

- `on-demand` (default): Load only what queries need
- `progressive`: Load query data immediately, then broad data in background
- `eager`: Load all data at startup

```bash
# All collections use on-demand
db-graphql build --schema schema.graphql --out ./src/db

# Different modes per type
db-graphql build \
  --schema schema.graphql \
  --out ./src/db \
  --sync-mode "default=on-demand,Project=progressive,User=eager"
```

## Generated Code

### Directory Structure

```
src/db/graphql/
  index.ts                  # Main entry point
  schema/
    types.ts                # TypeScript types
  collections/
    Post.collection.ts      # One per GraphQL type
    User.collection.ts
  README.md                 # Usage instructions
```

### Usage Example

```typescript
import { QueryClient } from '@tanstack/query-core'
import { createGraphQLDb } from './db/graphql'

const queryClient = new QueryClient()

const db = createGraphQLDb({
  queryClient,
  endpoint: 'https://api.example.com/graphql',
  headers: () => ({
    Authorization: `Bearer ${token}`,
  }),
})

// Live query - automatically syncs with GraphQL
const { data: posts } = useLiveQuery((q) =>
  q.from({ p: db.collections.Post })
   .where(({ p }) => and(
     eq(p.published, true),
     lt(p.createdAt, cursor)
   ))
   .orderBy(({ p }) => desc(p.createdAt))
   .limit(20)
)

// Optimistic mutation
await db.collections.Post.insert({
  title: 'New Post',
  content: 'Hello, world!',
  authorId: currentUser.id,
  published: true,
})
```

## How It Works

### 1. Schema Introspection

The CLI introspects your GraphQL schema to extract:

- Object types (becomes collections)
- Scalar vs relation fields
- Query and mutation field names
- Input types for mutations

### 2. Code Generation

For each object type with an `id` field:

- **Collection factory**: Wired to GraphQL query/mutation handlers
- **TypeScript types**: Input and output types
- **Selection sets**: Minimal field selection for efficiency

### 3. Query-Driven Sync

At runtime, TanStack DB live queries drive GraphQL operations:

```
User writes query
  ↓
TanStack DB extracts predicates (where/orderBy/limit)
  ↓
Planner converts to GraphQL variables
  ↓
Link executes GraphQL (with batching)
  ↓
Selection extracts rows from response
  ↓
Collection stores rows
  ↓
UI updates (sub-millisecond local joins)
```

### 4. Mutations

Mutations follow the "patch-from-result" pattern:

```
User calls insert/update/delete
  ↓
Optimistic update (instant UI)
  ↓
GraphQL mutation sent
  ↓
Server response patches collection
  ↓
Reconciliation complete
```

If the mutation fails, TanStack DB automatically rolls back.

## Dialects

### Hasura

```graphql
query LoadPosts($where: Post_bool_exp, $orderBy: [Post_order_by!], $limit: Int) {
  posts(where: $where, order_by: $orderBy, limit: $limit) {
    id
    title
  }
}
```

### PostGraphile (Relay)

```graphql
query LoadPosts($filter: PostFilter, $orderBy: [PostsOrderBy!], $first: Int) {
  allPosts(filter: $filter, orderBy: $orderBy, first: $first) {
    nodes {
      id
      title
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

### Prisma

```graphql
query LoadPosts($where: PostWhereInput, $orderBy: [PostOrderByInput!], $take: Int) {
  posts(where: $where, orderBy: $orderBy, take: $take) {
    id
    title
  }
}
```

## Comparison to Other GraphQL Clients

| Feature | db-graphql | Apollo | Relay | URQL |
|---------|------------|--------|-------|------|
| **Query-driven sync** | ✅ Automatic | ❌ Manual | ✅ Fragments | ❌ Manual |
| **Local joins** | ✅ Sub-ms | ❌ N/A | ❌ N/A | ❌ N/A |
| **Optimistic updates** | ✅ Built-in | ✅ Manual | ✅ Manual | ✅ Manual |
| **Batching** | ✅ Automatic | ✅ Via link | ✅ Built-in | ✅ Via exchange |
| **Type generation** | ✅ End-to-end | ⚠️ Partial | ⚠️ Partial | ⚠️ Partial |
| **Differential dataflow** | ✅ Yes | ❌ No | ❌ No | ❌ No |

## Requirements

- TanStack DB v0.5+
- TanStack Query v5+
- GraphQL server with introspection enabled

## License

MIT
