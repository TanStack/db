---
'@tanstack/db': minor
---

Compare instances of value classes, classes whose instances define `toJSON()` such as the `surrealdb` SDK's `RecordId`, by their serialized value instead of by reference. `eq`, `inArray`, join conditions, `groupBy`, indexes and ordering now match a distinct instance with an equal `toJSON()` result, so filtering or joining on record IDs works in any table. Query identity follows the same relation: equal captures are one query, so `useLiveQuery` needs no `queryKey` for them, and `getStableValueHash` (and therefore a `queryKey`) accepts such instances instead of throwing `UnhashableQueryIRError`. A value class instance never equals a plain value equal to its serialization. Dates, Temporal values, binary data, Maps and Sets (including subclasses that define `toJSON()`) keep their own rules, and plain objects, arrays and classes without `toJSON()` still compare by reference.
