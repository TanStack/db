---
"@tanstack/db": patch
---

fix(db): treat objects with `Symbol.toStringTag` as leaf values in `IsPlainObject`

Temporal types (e.g. `Temporal.PlainDate`, `Temporal.ZonedDateTime`) have `Symbol.toStringTag` set to a string. Previously, `IsPlainObject` would return `true` for these types because they are objects and not in the `JsBuiltIns` union. This caused the `Ref<T>` mapped type to recursively walk Temporal methods, mangling them to `{}`.

The fix adds a `T extends { readonly [Symbol.toStringTag]: string }` check before returning `true`, causing all class instances with `Symbol.toStringTag` (Temporal types, etc.) to be treated as leaf values with their types fully preserved.

Fixes #1372
