---
'@tanstack/db': patch
---

Treat `-0` and `0` as distinct row values. A synced update, a replay that replaces a subscription's rows, and an optimistic update that change a field only from `-0` to `0` (or back) now publish a change; before, the Collection could store the new value while subscribers kept the old one. A draft write of `0` over `-0` is now recorded as a change instead of being dropped. A transaction that deletes a row and reinserts it with only a zero's sign changed now sends that update instead of dropping it, and an ordered Effect now delivers an update whose projected value changes only by a zero's sign. A sync insert of a held key whose row differs only by a zero's sign is now a duplicate key, not an equal re-insert. The same holds inside typed arrays. An ordered Effect also delivers an update whose value is a class instance, which can change in private state its enumerable fields do not show.
