---
"@tanstack/db": patch
---

Automatically restart collections from cleaned-up state when operations are called

Collections in a `cleaned-up` state now automatically restart when operations like `insert()`, `update()`, or `delete()` are called on them. This matches the behavior of other collection access patterns and provides a better developer experience by avoiding unnecessary errors.
