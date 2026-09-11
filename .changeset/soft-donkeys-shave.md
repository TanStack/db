---
'@tanstack/db': patch
---

Fix concurrent optimistic updates to the same row overwriting each other's fields.

Each pending update was stored as a whole-row snapshot taken at `mutate()` time, so whichever transaction applied last set every field — including fields it never touched. The clearest symptom: rolling back one of several in-flight transactions left its change visible, restored from a sibling transaction's snapshot.

Updates now apply only the top-level fields they actually changed. Inserts are unaffected — they still apply the whole row, because an insert's `changes` omit schema defaults.
