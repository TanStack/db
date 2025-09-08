---
"@tanstack/db": minor
---

## Enhanced Ref System with Nested Optional Properties

Comprehensive refactor of the ref system to properly support nested structures and optionality, aligning the type system with JavaScript's optional chaining behavior.

### ✨ New Features

- **Nested Optional Properties**: Full support for deeply nested optional objects (`employees.profile?.bio`, `orders.customer?.address?.street`)
- **Enhanced Type Safety**: Optional types now correctly typed as `RefProxy<T> | undefined` with optionality outside the ref
- **New Query Functions**: Added `isUndefined`, `isNull` for proper null/undefined checks
- **Improved JOIN Handling**: Fixed optionality in JOIN operations and multiple GROUP BY support

### ⚠️ Breaking Changes

**IMPORTANT**: Code that previously ignored optionality now requires proper optional chaining syntax.

```typescript
// Before (worked but type-unsafe)
employees.profile.bio // ❌ Now throws type error

// After (correct and type-safe)
employees.profile?.bio // ✅ Required syntax
```

### Migration

Add `?.` when accessing potentially undefined nested properties
