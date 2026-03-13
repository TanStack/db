---
'@tanstack/db-ivm': patch
---

Fix Temporal objects (PlainDate, ZonedDateTime, etc.) producing identical hashes in the IVM hash function. Temporal objects have no enumerable own properties, so Object.keys() returns [] and all instances were hashed identically. This caused join live queries to silently swallow updates when only a Temporal field changed. Temporal objects are now hashed by their type tag and string representation.
