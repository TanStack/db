---
"@tanstack/db": patch
---

• Add proper tracking for array mutating methods (push, pop, shift, unshift, splice, sort, reverse, fill, copyWithin)
• Fix existing array tests that were misleadingly named but didn't actually call the methods they claimed to test
• Add comprehensive test coverage for all supported array mutating methods
