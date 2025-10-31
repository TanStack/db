---
"@tanstack/db": patch
---

Improve error messages for custom getKey with joined queries

Enhanced `DuplicateKeySyncError` to provide better guidance when custom `getKey` is used with joined queries and produces duplicate keys during sync.

**The Problem:**
When using custom `getKey` with joins, it's possible to create duplicate keys if the join produces multiple rows. For 1:1 relationships this works fine, but for 1:many relationships it causes confusing duplicate key errors.

**The Solution:**
Instead of blocking all custom `getKey` with joins upfront, we now:

- Allow custom `getKey` with joins (enabling valid 1:1 use cases)
- Detect when duplicate keys occur during sync
- Provide enhanced error message with actionable guidance

**Valid use case (now supported):**

```typescript
// ✅ Works fine - each profile has one user (1:1 relationship)
const userProfiles = createLiveQueryCollection({
  query: (q) =>
    q
      .from({ profile: profiles })
      .join({ user: users }, ({ profile, user }) =>
        eq(profile.userId, user.id)
      ),
  getKey: (profile) => profile.id, // Unique keys - no problem!
})
```

**Error case with better messaging:**

```typescript
// ⚠️ Multiple comments per user - produces duplicate keys
const userComments = createLiveQueryCollection({
  query: (q) =>
    q
      .from({ user: users })
      .join({ comment: comments }, ({ user, comment }) =>
        eq(user.id, comment.userId)
      ),
  getKey: (item) => item.userId, // Same userId for multiple rows!
})

// Now throws helpful error:
// "Cannot insert document with key "user1" from sync because it already exists.
// This collection uses a custom getKey with joined queries. Joined queries can
// produce multiple rows with the same key when relationships are not 1:1.
// Consider: (1) using a composite key (e.g., `${item.key1}-${item.key2}`),
// (2) ensuring your join produces unique rows per key, or (3) removing the
// custom getKey to use the default composite key behavior."
```
