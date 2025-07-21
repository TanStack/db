---
"@tanstack/trailbase-db-collection": patch
"@tanstack/electric-db-collection": patch
"@tanstack/query-db-collection": patch
"@tanstack/db": patch
---

feat: Replace string-based errors with named error classes for better error handling

This comprehensive update replaces all string-based error throws throughout the TanStack DB codebase with named error classes, providing better type safety and developer experience.

## New Features

- **Root `TanStackDBError` class** - all errors inherit from a common base for unified error handling
- **Named error classes** organized by package and functional area
- **Type-safe error handling** using `instanceof` checks instead of string matching
- **Package-specific error definitions** - each adapter has its own error classes
- **Better IDE support** with autocomplete for error types

## Package Structure

### Core Package (`@tanstack/db`)
Contains generic errors used across the ecosystem:
- Collection configuration, state, and operation errors
- Transaction lifecycle and mutation errors  
- Query building, compilation, and execution errors
- Storage and serialization errors

### Adapter Packages
Each adapter now exports its own specific error classes:
- **`@tanstack/electric-db-collection`**: Electric-specific errors
- **`@tanstack/trailbase-db-collection`**: TrailBase-specific errors
- **`@tanstack/query-db-collection`**: Query collection specific errors

## Breaking Changes

- Error handling code using string matching will need to be updated to use `instanceof` checks
- Some error messages may have slight formatting changes
- Adapter-specific errors now need to be imported from their respective packages

## Migration Guide

### Core DB Errors
**Before:**
```ts
try {
  collection.insert(data)
} catch (error) {
  if (error.message.includes("already exists")) {
    // Handle duplicate key error
  }
}
```

**After:**
```ts
import { DuplicateKeyError } from "@tanstack/db"

try {
  collection.insert(data)
} catch (error) {
  if (error instanceof DuplicateKeyError) {
    // Type-safe error handling
  }
}
```

### Adapter-Specific Errors
**Before:**
```ts
// Electric collection errors were imported from @tanstack/db
import { ElectricInsertHandlerMustReturnTxIdError } from "@tanstack/db"
```

**After:**
```ts
// Now import from the specific adapter package
import { ElectricInsertHandlerMustReturnTxIdError } from "@tanstack/electric-db-collection"
```

### Unified Error Handling
**New:**
```ts
import { TanStackDBError } from "@tanstack/db"

try {
  // Any TanStack DB operation
} catch (error) {
  if (error instanceof TanStackDBError) {
    // Handle all TanStack DB errors uniformly
    console.log('TanStack DB error:', error.message)
  }
}
```

## Benefits

- **Type Safety**: All errors now have specific types that can be caught with `instanceof`
- **Unified Error Handling**: Root `TanStackDBError` class allows catching all library errors with a single check
- **Better Package Separation**: Each adapter manages its own error types
- **Developer Experience**: Better IDE support with autocomplete for error types  
- **Maintainability**: Error definitions are co-located with their usage
- **Consistency**: Uniform error handling patterns across the entire codebase

All error classes maintain the same error messages and behavior while providing better structure and package separation.
