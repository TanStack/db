---
"@tanstack/db": patch
---

Materialize includes into parent rows before they commit so emitted change events already carry their included values. The includes flush ran only after the parent live query collection committed, patching stored rows in place without emitting; any consumer that copies rows at emit time — most commonly another live query layered on the collection, the shape framework adapters produce for component-level queries — captured the pre-patch row with its included fields unset. A parent-only update (no child changes) never triggered the follow-up re-emit, so those consumers kept empty includes until an unrelated child change recomputed the row. Fixes #1635.
