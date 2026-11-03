---
'@tanstack/trailbase-db-collection': patch
---

Fix three write bugs.

- Removing a field in an update (for example `draft.note = undefined`) now sends `null`, so TrailBase clears the column. Before, the update omitted the field, and TrailBase kept the old value.
- Writes now reach TrailBase in the order the application made them. A write starts only after the earlier write on the same collection is confirmed or rejected.
- A write is now confirmed only by a change event that arrives after the write began. Before, an earlier event for the same record could confirm a later write, so its optimistic value dropped and the old value showed until the new event arrived. This change also removes the adapter's periodic cleanup timer.
