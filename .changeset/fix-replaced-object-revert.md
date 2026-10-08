---
'@tanstack/db': patch
---

Report no change for a field that an update replaces with a new object and then restores to its original value through a nested write. Before, `update` reported the field as changed, for example after `draft.f = {}` and then `draft.f.a = 0` on a row whose `f` was `{ a: 0 }`. A native mutator method, such as `push` or `reverse`, still counts as a change without a revert check.
