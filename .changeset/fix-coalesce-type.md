---
"@tanstack/db": patch
---

fix(db): preserve null in coalesce() return type when no guaranteed non-null arg is present

`coalesce()` was typed as returning `BasicExpression<any>`, losing all type information. The signature now infers types from all arguments via tuple generics, returns the union of non-null arg types, and only removes nullability when at least one argument is statically guaranteed non-null.
