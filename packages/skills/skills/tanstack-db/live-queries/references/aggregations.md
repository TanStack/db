# Aggregations

Group data and compute aggregate values with groupBy, having, and aggregate functions.

## Aggregate Functions

| Function | Description | Example |
|----------|-------------|---------|
| `count(field)` | Count non-null values | `count(order.id)` |
| `sum(field)` | Sum numeric values | `sum(order.amount)` |
| `avg(field)` | Average of values | `avg(order.amount)` |
| `min(field)` | Minimum value | `min(order.amount)` |
| `max(field)` | Maximum value | `max(order.amount)` |

## Basic Aggregation

```tsx
import { count, sum, avg } from '@tanstack/db'

const { data } = useLiveQuery((q) =>
  q
    .from({ order: ordersCollection })
    .groupBy(({ order }) => order.customerId)
    .select(({ order }) => ({
      customerId: order.customerId,
      totalOrders: count(order.id),
      totalSpent: sum(order.amount),
      avgOrder: avg(order.amount),
    }))
)
```

## Multi-Column Grouping

Group by multiple fields:

```tsx
const { data } = useLiveQuery((q) =>
  q
    .from({ sale: salesCollection })
    .groupBy(({ sale }) => [sale.year, sale.month, sale.category])
    .select(({ sale }) => ({
      year: sale.year,
      month: sale.month,
      category: sale.category,
      totalSales: sum(sale.amount),
      count: count(sale.id),
    }))
)
```

## Having Clause

Filter groups after aggregation:

```tsx
const { data } = useLiveQuery((q) =>
  q
    .from({ order: ordersCollection })
    .groupBy(({ order }) => order.customerId)
    .select(({ order }) => ({
      customerId: order.customerId,
      totalSpent: sum(order.amount),
      orderCount: count(order.id),
    }))
    .having(({ $selected }) => gt($selected.totalSpent, 1000))
)
```

## Having with Aggregate Functions

Use aggregates directly in having:

```tsx
const { data } = useLiveQuery((q) =>
  q
    .from({ order: ordersCollection })
    .groupBy(({ order }) => order.customerId)
    .having(({ order }) => gt(count(order.id), 5))
    .select(({ order }) => ({
      customerId: order.customerId,
      orderCount: count(order.id),
    }))
)
```

## Implicit Single-Group Aggregation

Aggregates without groupBy treat entire dataset as one group:

```tsx
const { data } = useLiveQuery((q) =>
  q
    .from({ user: usersCollection })
    .select(({ user }) => ({
      totalUsers: count(user.id),
      avgAge: avg(user.age),
      oldestUser: max(user.age),
      youngestUser: min(user.age),
    }))
)

// Returns single object: { totalUsers, avgAge, oldestUser, youngestUser }
```

## Order By Aggregated Values

Sort by computed aggregates using `$selected`:

```tsx
const { data } = useLiveQuery((q) =>
  q
    .from({ order: ordersCollection })
    .groupBy(({ order }) => order.customerId)
    .select(({ order }) => ({
      customerId: order.customerId,
      totalSpent: sum(order.amount),
    }))
    .orderBy(({ $selected }) => $selected.totalSpent, 'desc')
    .limit(10)
)
```

## Accessing Grouped Results

Results are keyed by group value:

```tsx
const deptStats = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .groupBy(({ user }) => user.departmentId)
    .select(({ user }) => ({
      departmentId: user.departmentId,
      count: count(user.id),
    }))
)

// Single column grouping: keyed by actual value
const engineering = deptStats.get(1)

// Multi-column grouping: keyed by JSON string
const stats = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .groupBy(({ user }) => [user.departmentId, user.role])
    .select(({ user }) => ({
      departmentId: user.departmentId,
      role: user.role,
      count: count(user.id),
    }))
)

const adminEngineers = stats.get('[1,"admin"]')
```

## Rules for groupBy Select

In grouped queries, select can only include:
1. Fields used in groupBy
2. Aggregate functions

```tsx
// ✅ Valid
.groupBy(({ user }) => user.departmentId)
.select(({ user }) => ({
  departmentId: user.departmentId,  // ✅ In groupBy
  count: count(user.id),             // ✅ Aggregate
}))

// ❌ Invalid
.groupBy(({ user }) => user.departmentId)
.select(({ user }) => ({
  departmentId: user.departmentId,
  name: user.name,  // ❌ Not in groupBy, not aggregated
}))
```

## Combining with Joins

Aggregate across joined data:

```tsx
const { data } = useLiveQuery((q) =>
  q
    .from({ user: usersCollection })
    .leftJoin(
      { order: ordersCollection },
      ({ user, order }) => eq(user.id, order.userId)
    )
    .groupBy(({ user }) => user.id)
    .select(({ user, order }) => ({
      userId: user.id,
      userName: user.name,
      orderCount: count(order.id),
      totalSpent: sum(order.amount),
    }))
)
```
