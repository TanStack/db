---
"@tanstack/db-ivm": patch
"@tanstack/db": patch
---

Add `utils.setWindow()` method to live query collections to dynamically change limit and offset on ordered queries.

You can now change the pagination window of an ordered live query without recreating the collection:

```ts
const users = createLiveQueryCollection((q) =>
  q
    .from({ user: usersCollection })
    .orderBy(({ user }) => user.name, "asc")
    .limit(10)
    .offset(0)
)

users.utils.setWindow({ offset: 10, limit: 10 })
```
