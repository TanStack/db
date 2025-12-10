# @tanstack/db-collection-e2e

Shared end-to-end test suite for TanStack DB collections with query-driven sync and on-demand loading.

## Overview

This package provides a comprehensive e2e test suite that can be reused across different collection implementations (Electric, Query, etc.). It tests:

- Predicate push-down and filtering
- Pagination, ordering, and window management
- Multi-collection joins with mixed syncModes
- Deduplication of concurrent loadSubset calls
- String collation configurations
- Mutations with on-demand mode
- Live updates (for sync-enabled collections)

## Architecture

### Package Structure

```
db-collection-e2e/
├── docker/                   # Docker Compose for test infrastructure
│   ├── docker-compose.yml    # Postgres + Electric
│   └── postgres.conf         # Optimized for fast tests
├── src/
│   ├── types.ts              # TypeScript interfaces
│   ├── fixtures/             # Test data and schemas
│   │   ├── seed-data.ts      # Generate ~100 records per table
│   │   └── test-schema.ts    # SQL schema definitions
│   ├── suites/               # Test suite modules
│   │   ├── predicates.test.ts
│   │   ├── pagination.test.ts
│   │   ├── joins.test.ts
│   │   ├── deduplication.test.ts
│   │   ├── collation.test.ts
│   │   ├── mutations.test.ts
│   │   ├── live-updates.test.ts
│   │   └── regressions.test.ts
│   └── utils/                # Helper functions
│       ├── helpers.ts        # Common utilities
│       └── assertions.ts     # Custom assertions
└── support/                  # Vitest setup
    ├── global-setup.ts       # Health checks, DB init
    └── test-context.ts       # Vitest fixtures
```

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Node.js 20+
- pnpm 10+

### Installation

From the repository root:

```bash
pnpm install
```

### Running Tests Locally

1. **Start Docker services:**

```bash
cd packages/db-collection-e2e/docker
docker compose up -d
```

2. **Run tests:**

```bash
cd packages/db-collection-e2e
pnpm test
```

3. **Stop Docker services:**

```bash
cd packages/db-collection-e2e/docker
docker compose down
```

## Test Data Schema

The test suite uses three related tables:

### Users Table (~100 records)

```typescript
interface User {
  id: string // UUID
  name: string // For collation testing
  email: string | null
  age: number
  isActive: boolean
  createdAt: Date
  metadata: object | null // JSON field
  deletedAt: Date | null // Soft delete
}
```

### Posts Table (~100 records)

```typescript
interface Post {
  id: string
  userId: string // FK to User
  title: string
  content: string | null
  viewCount: number
  publishedAt: Date | null
  deletedAt: Date | null
}
```

### Comments Table (~100 records)

```typescript
interface Comment {
  id: string
  postId: string // FK to Post
  userId: string // FK to User
  text: string
  createdAt: Date
  deletedAt: Date | null
}
```

### Data Distributions

Seed data includes:

- Mix of null/non-null values
- Various string cases (uppercase, lowercase, special chars)
- Date ranges (past, present, future)
- Numeric ranges (negative, zero, positive)
- Some soft-deleted records (~10%)

## Integrating with Your Collection

### 1. Create Setup File

Create `e2e/setup.ts` in your collection package. See real examples:

- Electric: `packages/electric-db-collection/e2e/setup.ts`
- Query: `packages/query-db-collection/e2e/setup.ts`

Example structure:

```typescript
import { createCollection } from "@tanstack/db"
import { yourCollectionOptions } from "../src"
import type {
  E2ETestConfig,
  User,
  Post,
  Comment,
} from "../../db-collection-e2e/src/types"

export async function createYourE2EConfig(options: {
  schema: string
  usersTable: string
  postsTable: string
  commentsTable: string
}): Promise<E2ETestConfig> {
  // Create collections for both syncModes (eager and on-demand)
  const eagerUsers = createCollection(
    yourCollectionOptions({
      id: `your-e2e-users-eager-${Date.now()}`,
      syncMode: "eager",
      getKey: (item: User) => item.id,
      startSync: false,
    })
  )

  const onDemandUsers = createCollection(
    yourCollectionOptions({
      id: `your-e2e-users-ondemand-${Date.now()}`,
      syncMode: "on-demand",
      getKey: (item: User) => item.id,
      startSync: false,
    })
  )

  // ... create posts and comments collections similarly

  return {
    collections: {
      eager: { users: eagerUsers, posts: eagerPosts, comments: eagerComments },
      onDemand: {
        users: onDemandUsers,
        posts: onDemandPosts,
        comments: onDemandComments,
      },
    },
    setup: async () => {
      // Optional setup hook
    },
    teardown: async () => {
      await Promise.all([
        eagerUsers.cleanup(),
        eagerPosts.cleanup(),
        eagerComments.cleanup(),
        onDemandUsers.cleanup(),
        onDemandPosts.cleanup(),
        onDemandComments.cleanup(),
      ])
    },
  }
}
```

### 2. Create E2E Test File

Create `e2e/your-collection.e2e.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { createCollection } from "@tanstack/db"
import { yourCollectionOptions } from "../src"

describe("Your Collection E2E", () => {
  it("should create collection", async () => {
    const collection = createCollection(
      yourCollectionOptions({
        id: "test-collection",
        getKey: (item: any) => item.id,
        startSync: false,
      })
    )

    expect(collection).toBeDefined()
    expect(collection._sync.loadSubset).toBeDefined()

    await collection.cleanup()
  })
})
```

### 3. Update Vitest Config

Update your `vite.config.ts` to include e2e tests:

```typescript
const config = defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "e2e/**/*.e2e.test.ts"],
    // Remove dir: './tests' if present
  },
})
```

### 4. Run Tests

```bash
cd packages/your-collection
pnpm test
```

The e2e tests will run alongside your regular tests.

## Test Suites

All test suites are implemented in `src/suites/*.suite.ts` files and exported as factory functions.

### Predicates Suite (`predicates.suite.ts`)

Tests basic where clause functionality with ~20 test scenarios:

**Example Test:**

```typescript
it("should filter with eq() on number field", async () => {
  const query = createLiveQueryCollection((q) =>
    q.from({ user: usersCollection }).where(({ user }) => eq(user.age, 25))
  )
  await query.preload()

  const results = Array.from(query.state.values())
  assertAllItemsMatch(query, (u) => u.age === 25)
})
```

**Covers:**

- `eq()`, `gt()`, `gte()`, `lt()`, `lte()` with all data types
- `inArray()` with arrays
- `isNull()`, `not(isNull())` for null checks
- Complex boolean logic with `and()`, `or()`, `not()`
- Predicate pushdown verification

### Pagination Suite (`pagination.suite.ts`)

Tests ordering and pagination with ~15 test scenarios:

**Example Test:**

```typescript
it("should sort ascending by single field", async () => {
  const query = createLiveQueryCollection((q) =>
    q.from({ user: usersCollection }).orderBy(({ user }) => user.age, "asc")
  )
  await query.preload()

  const results = Array.from(query.state.values())
  assertSorted(results, "age", "asc")
})
```

**Covers:**

- Basic `orderBy` (asc/desc) on various field types
- Multiple `orderBy` fields
- `limit` and `offset` for pagination
- Edge cases (limit=0, offset beyond dataset)
- Performance verification (only requested page loaded)

### Joins Suite (`joins.suite.ts`)

Tests multi-collection joins with ~12 test scenarios:

**Example Test:**

```typescript
it("should join Users and Posts", async () => {
  const query = createLiveQueryCollection((q) =>
    q
      .from({ user: usersCollection })
      .join({ post: postsCollection }, ({ user, post }) =>
        eq(user.id, post.userId)
      )
      .select(({ user, post }) => ({
        id: post.id,
        userName: user.name,
        postTitle: post.title,
      }))
  )
  await query.preload()

  expect(query.size).toBeGreaterThan(0)
})
```

**Covers:**

- Two-collection joins (Users + Posts)
- Three-collection joins (Users + Posts + Comments)
- Mixed syncModes (eager + on-demand)
- Predicates on joined collections
- Left joins and ordering on joined results
- Pagination on joined results

### Deduplication Suite

Tests concurrent loadSubset calls:

- Identical predicates called simultaneously
- Overlapping predicates (subset relationships)
- Queries during active loading
- Deduplication callback verification

### Collation Suite

Tests string collation:

- Default collation behavior
- Custom `defaultStringCollation`
- Query-level collation override
- Case-sensitive vs case-insensitive

### Mutations Suite

Tests data mutations:

- Insert, update, delete operations
- Soft delete pattern
- Concurrent mutations
- Reactive query updates

### Live Updates Suite (Optional)

Tests reactive updates (for sync-enabled collections):

- Backend data changes
- Updates during loadSubset
- Multiple watchers
- Subscription lifecycle

### Regression Suite

Tests for known bugs:

- Initial state sent multiple times (#7214245)
- Race conditions in multi-join
- Missing data in change tracking
- LoadSubset naming changes (#9874949)

## Configuration

### Environment Variables

- `ELECTRIC_URL` - Electric server URL (default: `http://localhost:3000`)
- `POSTGRES_HOST` - Postgres host (default: `localhost`)
- `POSTGRES_PORT` - Postgres port (default: `54321`)
- `POSTGRES_USER` - Postgres user (default: `postgres`)
- `POSTGRES_PASSWORD` - Postgres password (default: `password`)
- `POSTGRES_DB` - Postgres database (default: `e2e_test`)

### Docker Configuration

The Docker Compose setup uses:

- Postgres 16 Alpine with tmpfs for speed
- Electric canary image
- Health checks with 10s timeout
- Optimized postgres.conf for testing

## Troubleshooting

### Docker services not starting

```bash
# Check service status
docker compose ps

# View logs
docker compose logs

# Restart services
docker compose restart
```

### Tests timing out

- Increase `timeout` in `vite.config.ts`
- Check Docker resource limits
- Verify network connectivity

### Database connection errors

- Ensure Docker services are healthy
- Check environment variables
- Verify ports are not in use

### Test isolation issues

Tests use unique table names per test to prevent collisions:

```
"users_taskId_random"
```

If you see data from other tests, check that cleanup is working properly.

## Performance

Target execution time: **< 5 minutes** for entire suite

Optimizations:

- tmpfs for Postgres data directory
- Serial execution (`fileParallelism: false`)
- Minimal test data (~300 records total)
- Optimized Postgres configuration
- Health checks with fast intervals

## Contributing

When adding new test suites:

1. Create new file in `src/suites/`
2. Export test factory function
3. Add to main exports in `src/index.ts`
4. Update README with test suite description
5. Ensure execution time stays < 5 minutes

## License

MIT

## Related

- [RFC #676](https://github.com/TanStack/db/discussions/676) - Query-driven sync RFC
- [PR #763](https://github.com/TanStack/db/pull/763) - Implementation PR
- [TanStack DB Documentation](https://tanstack.com/db)
