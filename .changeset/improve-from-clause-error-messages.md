---
"@tanstack/db": patch
---

Improved error messages when invalid source types are passed to `.from()` or `.join()` methods. When users mistakenly pass a string, null, array, or other invalid type instead of an object with a collection, they now receive a clear, actionable error message with an example of the correct usage (e.g., `.from({ todos: todosCollection })`).
