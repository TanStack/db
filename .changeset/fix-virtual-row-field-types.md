---
'@tanstack/db': minor
---

Keep virtual row fields on inferred collection and query row roots without
exposing them on nested user objects or projected child values.
Default `Ref<T>` and `SingleRowRefProxy<T>` annotations now support reusable
helpers for both root and nested refs; helpers that require row metadata should
set their third generic parameter to `true`. Preserve discriminated unions when
removing virtual row fields.
