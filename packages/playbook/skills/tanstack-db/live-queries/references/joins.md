# Joins

Combine data from multiple collections with type-safe joins.

## Join Types

| Type  | Method                      | Behavior                                       |
| ----- | --------------------------- | ---------------------------------------------- |
| Left  | `.leftJoin()` or `'left'`   | All left rows, matched right rows or undefined |
| Right | `.rightJoin()` or `'right'` | All right rows, matched left rows or undefined |
| Inner | `.innerJoin()` or `'inner'` | Only rows that match in both                   |
| Full  | `.fullJoin()` or `'full'`   | All rows from both, undefined where no match   |

## Basic Join

```tsx
const { data } = useLiveQuery((q) =>
  q
    .from({ user: usersCollection })
    .join(
      { post: postsCollection },
      ({ user, post }) => eq(user.id, post.userId),
      'left',
    ),
)

// Result type: { user: User; post?: Post }[]
```

## Convenience Methods

```tsx
// These are equivalent:
.join({ post: postsCollection }, condition, 'left')
.leftJoin({ post: postsCollection }, condition)

.join({ post: postsCollection }, condition, 'inner')
.innerJoin({ post: postsCollection }, condition)

.join({ post: postsCollection }, condition, 'right')
.rightJoin({ post: postsCollection }, condition)

.join({ post: postsCollection }, condition, 'full')
.fullJoin({ post: postsCollection }, condition)
```

## Result Type Inference

Join types affect optionality:

```tsx
// Left join: right side optional
.leftJoin({ post }, condition)
// { user: User; post?: Post }

// Right join: left side optional
.rightJoin({ post }, condition)
// { user?: User; post: Post }

// Inner join: both required
.innerJoin({ post }, condition)
// { user: User; post: Post }

// Full join: both optional
.fullJoin({ post }, condition)
// { user?: User; post?: Post }
```

## Multiple Joins

Chain joins to combine many collections:

```tsx
const { data } = useLiveQuery((q) =>
  q
    .from({ user: usersCollection })
    .leftJoin({ post: postsCollection }, ({ user, post }) =>
      eq(user.id, post.userId),
    )
    .leftJoin({ comment: commentsCollection }, ({ post, comment }) =>
      eq(post.id, comment.postId),
    )
    .select(({ user, post, comment }) => ({
      userName: user.name,
      postTitle: post?.title,
      commentText: comment?.text,
    })),
)
```

## Join with Select

Flatten joined data:

```tsx
const { data } = useLiveQuery((q) =>
  q
    .from({ user: usersCollection })
    .innerJoin({ post: postsCollection }, ({ user, post }) =>
      eq(user.id, post.userId),
    )
    .select(({ user, post }) => ({
      postId: post.id,
      postTitle: post.title,
      authorName: user.name,
      authorEmail: user.email,
    })),
)

// Result: { postId, postTitle, authorName, authorEmail }[]
```

## Join with Subquery

Join against a filtered subset:

```tsx
const { data } = useLiveQuery((q) => {
  const recentPosts = q
    .from({ post: postsCollection })
    .where(({ post }) => gt(post.createdAt, lastWeek))

  return q
    .from({ user: usersCollection })
    .innerJoin({ recentPost: recentPosts }, ({ user, recentPost }) =>
      eq(user.id, recentPost.userId),
    )
})
```

## Checking for Missing Joins

Use `isUndefined` to find unmatched rows:

```tsx
// Users without any posts
const { data } = useLiveQuery((q) =>
  q
    .from({ user: usersCollection })
    .leftJoin({ post: postsCollection }, ({ user, post }) =>
      eq(user.id, post.userId),
    )
    .where(({ post }) => isUndefined(post))
    .select(({ user }) => ({
      id: user.id,
      name: user.name,
    })),
)
```

## Join Conditions

Joins only support equality conditions:

```tsx
// ✅ Supported
.join({ post }, ({ user, post }) => eq(user.id, post.userId))

// ❌ Not supported (non-equality)
.join({ post }, ({ user, post }) => gt(user.id, post.userId))
```

## Performance Considerations

- Joins are computed incrementally as data changes
- Inner joins are typically fastest (fewer results)
- Multiple joins on large collections may need derived collections for caching
- Consider filtering before joining to reduce intermediate results

```tsx
// Better: filter first, then join
const activeUsers = q
  .from({ user: usersCollection })
  .where(({ user }) => eq(user.active, true))

q.from({ activeUser: activeUsers })
 .join({ post: postsCollection }, ...)

// vs joining everything then filtering
```
