---
'@tanstack/db': patch
---

Fix `.select()` collapsing discriminated-union fields to the intersection of common keys (#1511). `Ref<T>` now distributes over `T` so `keyof (A | B | C)` no longer reduces the union to its common keys, and `ExtractRef<T>` now distinguishes a real branded `Ref` (where the underlying user type `U` can be returned directly) from a spread-produced inline object (which still needs to be projected through `ResultTypeFromSelect`). This preserves discriminated unions both when the field is selected at the top level and when the field is nested inside another selected object. The real-`Ref` detection uses a strict structural equivalence against the canonical `Ref<U>` shape, so spread-derived objects that keep the same keys but change a field's type (e.g. `{ ...u, code: u.slug }`) or drop an optional key (e.g. `const { nickname, ...rest } = u`) are projected through `ResultTypeFromSelect` instead of being collapsed back to `U`.
