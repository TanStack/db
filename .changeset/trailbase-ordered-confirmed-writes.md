---
'@tanstack/trailbase-db-collection': patch
---

Fix four write bugs.

- Removing a field in an update (for example `draft.note = undefined`) now sends `null`, so TrailBase clears the column. Before, the update omitted the field, and TrailBase kept the old value. The field's `serialize` function is not called for a removal.
- Writes now reach TrailBase in the order the application made them. A write starts only after TrailBase has answered the earlier write on the same collection. It does not wait for the earlier write's change event.
- A transaction's update and delete requests now go out one at a time, in mutation order. Before, they went out together, so after one was rejected the next write could start while another request was still unanswered. A rejection now ends the transaction, and its later requests are not sent.
- A write is no longer confirmed by an earlier write's change event. Before, an earlier event for the same record could confirm a later write, so its optimistic value dropped and the earlier value showed until the later event arrived. The adapter now numbers this client's answered writes and the change events for each record. A change another client makes to the same record while a write waits still counts as an event. This change also removes the adapter's periodic cleanup timer.
