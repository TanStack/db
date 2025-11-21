---
"@tanstack/db": patch
---

Migrated paced mutations implementation from `@tanstack/pacer` to `@tanstack/pacer-lite`. The lite version provides the same core functionality with minimal overhead and no external dependencies, making it more suitable for library use. This is an internal implementation change with no impact on the public API - all paced mutation strategies (debounce, throttle, queue) continue to work exactly as before.
