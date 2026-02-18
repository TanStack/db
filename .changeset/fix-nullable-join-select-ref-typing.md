---
'@tanstack/db': patch
---

fix(db): use `Ref<T, Nullable>` brand instead of `Ref<T> | undefined` for nullable join refs in declarative select

The declarative `select()` callback receives proxy objects that record property accesses. These proxies are always truthy at build time, but nullable join sides (left/right/full) were typed as `Ref<T> | undefined`, misleading users into using `?.` and `??` operators that have no effect at runtime. Nullable join refs are now typed as `Ref<T, true>`, which allows direct property access without optional chaining while correctly producing `T | undefined` in the result type.
