---
"@tanstack/db": patch
---

Fixed bug where orderBy would fail when a collection alias had the same name as one of its schema fields. For example, .from({ email: emailCollection }).orderBy(({ email }) => email.createdAt) now works correctly even when the collection has an email field in its schema.
