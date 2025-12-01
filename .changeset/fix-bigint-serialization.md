---
"@tanstack/electric-db-collection": patch
---

fix: Add BigInt support to pg-serializer and fix error message for non-JSON-serializable values

- Added support for serializing BigInt values to strings in the `serialize` function
- Fixed the error message when encountering unsupported types to handle values that cannot be serialized by `JSON.stringify` (like BigInt), preventing a secondary error from masking the original issue
