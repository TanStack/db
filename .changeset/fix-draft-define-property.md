---
'@tanstack/db': patch
---

Make `Object.defineProperty` inside an update callback report what assignment would. Defining a field back to its original value is no longer a change, an enumerable getter reports its value, and assigning a field the callback gave only a getter throws as it would on a plain object. Deleting a non-enumerable field the callback had written is no longer reported as a deletion, matching a plain delete.
