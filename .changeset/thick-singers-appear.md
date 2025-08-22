---
"@tanstack/db": patch
---

Fix handling of Temporal objects in proxy's deepClone and deepEqual functions

- Temporal objects (like Temporal.ZonedDateTime) are now properly preserved during cloning instead of being converted to empty objects
- Added detection for all Temporal API object types via Symbol.toStringTag
- Temporal objects are returned directly from deepClone since they're immutable
- Added proper equality checking for Temporal objects using their built-in equals() method
- Prevents unnecessary proxy creation for immutable Temporal objects
