---
"@tanstack/db": patch
---

Add non-optimistic mutations support

- Add `optimistic` option to insert, update, and delete operations
- Default `optimistic: true` maintains backward compatibility
- When `optimistic: false`, mutations only apply after server confirmation
- Enables better control for server-validated operations and confirmation workflows
