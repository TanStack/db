---
"@tanstack/db": patch
---

fix: export types used in public API signatures for declaration emit compatibility

Types like `SchemaFromSource`, `MergeContextWithJoinType`, `WithResult`, `ResultTypeFromSelect`, and others
are used in the public method signatures of `BaseQueryBuilder` (e.g. `from()`, `join()`, `select()`) but
were not re-exported from the package's public API. This caused TypeScript error TS2742 when consumers used
`declaration: true` in their tsconfig, as TypeScript could not name the inferred types in generated `.d.ts` files.

Fixes #1012
