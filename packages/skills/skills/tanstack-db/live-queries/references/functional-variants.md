# Functional Variants

Use full JavaScript power when expression functions aren't enough.

## When to Use

Functional variants (`fn.where`, `fn.select`, `fn.having`) let you write arbitrary JavaScript instead of expression-based queries.

**Use when:**
- Complex string manipulation
- External library calls
- Conditional logic that can't be expressed with `and`/`or`
- Dynamic computed values

**Avoid when possible:** Functional variants can't be optimized or use indexes.

## fn.select

Transform data with JavaScript:

```tsx
const { data } = useLiveQuery((q) =>
  q
    .from({ user: usersCollection })
    .fn.select((row) => ({
      id: row.user.id,
      displayName: `${row.user.firstName} ${row.user.lastName}`.trim(),
      emailDomain: row.user.email.split('@')[1],
      ageGroup: row.user.age < 25 ? 'young' : row.user.age < 50 ? 'adult' : 'senior',
      isHighEarner: row.user.salary > 75000,
    }))
)
```

## fn.where

Filter with JavaScript logic:

```tsx
const { data } = useLiveQuery((q) =>
  q
    .from({ user: usersCollection })
    .fn.where((row) => {
      const user = row.user
      return (
        user.active &&
        (user.age > 25 || user.role === 'admin') &&
        user.email.endsWith('@company.com')
      )
    })
)
```

## fn.having

Filter groups with JavaScript:

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
    .fn.having(({ $selected }) => {
      return $selected.totalSpent > 1000 && $selected.orderCount >= 3
    })
)
```

## Complex Transformations

Build nested structures:

```tsx
const { data } = useLiveQuery((q) =>
  q
    .from({ user: usersCollection })
    .fn.select((row) => {
      const user = row.user
      const fullName = `${user.firstName} ${user.lastName}`.trim()
      const emailParts = user.email.split('@')

      return {
        userId: user.id,
        displayName: fullName || user.username,
        contact: {
          email: user.email,
          domain: emailParts[1],
          isCompanyEmail: emailParts[1] === 'company.com',
        },
        demographics: {
          age: user.age,
          ageGroup: user.age < 25 ? 'young' : user.age < 50 ? 'adult' : 'senior',
          isAdult: user.age >= 18,
        },
        profileStrength: calculateProfileStrength(user),
      }
    })
)

function calculateProfileStrength(user) {
  let score = 0
  if (user.firstName) score += 25
  if (user.lastName) score += 25
  if (user.email) score += 25
  if (user.avatar) score += 25
  return score
}
```

## Mixing Expression and Functional

Use expressions where possible, functional where needed:

```tsx
const { data } = useLiveQuery((q) =>
  q
    .from({ user: usersCollection })
    // Expression-based (optimizable)
    .where(({ user }) => eq(user.active, true))
    // Functional (for complex logic)
    .fn.where((row) => row.user.email.includes('@company.com'))
    // Expression-based select
    .select(({ user }) => ({
      id: user.id,
      name: user.name,
      email: user.email,
    }))
)
```

## Type Safety

Functional variants maintain TypeScript support:

```tsx
interface ProcessedUser {
  id: string
  name: string
  ageGroup: 'young' | 'adult' | 'senior'
}

const { data } = useLiveQuery((q) =>
  q
    .from({ user: usersCollection })
    .fn.select((row): ProcessedUser => ({
      id: row.user.id,
      name: row.user.name,
      ageGroup: row.user.age < 25 ? 'young' : row.user.age < 50 ? 'adult' : 'senior',
    }))
)

// data is ProcessedUser[]
```

## Performance Considerations

| Approach | Optimizable | Use Index | Incremental |
|----------|-------------|-----------|-------------|
| Expression (`eq`, `gt`, etc.) | ✅ | ✅ | ✅ |
| Functional (`fn.where`, etc.) | ❌ | ❌ | ✅ |

Functional variants still benefit from incremental updates but can't be optimized by the query planner.

## External Libraries

Use any JavaScript library:

```tsx
import { format, parseISO } from 'date-fns'
import slugify from 'slugify'

const { data } = useLiveQuery((q) =>
  q
    .from({ post: postsCollection })
    .fn.select((row) => ({
      id: row.post.id,
      title: row.post.title,
      slug: slugify(row.post.title, { lower: true }),
      publishedDate: format(parseISO(row.post.publishedAt), 'MMMM d, yyyy'),
    }))
)
```
