---
"@tanstack/db": patch
---

Improve error messages for custom getKey with joined queries

Enhanced `DuplicateKeySyncError` to provide context-aware guidance when duplicate keys occur with custom `getKey` and joined queries.

**The Issue:**

When using custom `getKey` with joins, duplicate keys can occur if the join produces multiple rows with the same key value. This is valid for 1:1 relationships but problematic for 1:many relationships, and the previous error message didn't explain what went wrong or how to fix it.

**What's New:**

When a duplicate key error occurs in a live query collection that uses both custom `getKey` and joins, the error message now:

- Explains that joined queries can produce multiple rows with the same key
- Suggests using a composite key in your `getKey` function
- Provides concrete examples of solutions
- Helps distinguish between correctly structured 1:1 joins vs problematic 1:many joins

**Example:**

```typescript
// ✅ Valid - 1:1 relationship with unique keys
const userProfiles = createLiveQueryCollection({
  query: (q) =>
    q
      .from({ profile: profiles })
      .join({ user: users }, ({ profile, user }) =>
        eq(profile.userId, user.id)
      ),
  getKey: (profile) => profile.id, // Each profile has unique ID
})
```

```typescript
// ⚠️ Problematic - 1:many relationship with duplicate keys
const userComments = createLiveQueryCollection({
  query: (q) =>
    q
      .from({ user: users })
      .join({ comment: comments }, ({ user, comment }) =>
        eq(user.id, comment.userId)
      ),
  getKey: (item) => item.userId, // Multiple comments share same userId!
})

// Enhanced error message:
// "Cannot insert document with key "user1" from sync because it already exists.
// This collection uses a custom getKey with joined queries. Joined queries can
// produce multiple rows with the same key when relationships are not 1:1.
// Consider: (1) using a composite key in your getKey function (e.g., `${item.key1}-${item.key2}`),
// (2) ensuring your join produces unique rows per key, or (3) removing the
// custom getKey to use the default composite key behavior."
```
