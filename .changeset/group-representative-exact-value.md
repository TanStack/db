---
'@tanstack/db': patch
---

Update a grouped aggregate in work that does not depend on the group's size. Before, each change to a `groupBy` group or to an aggregate inside an include re-read every member of the group, because each member's contribution carried its row key. For example, an include that counts the comments of an issue re-read all of that issue's comments on each new comment.

A `groupBy` value now comes from the member with the smallest exact value, when several members are equal under query equality but differ exactly. A number comes before a Date, a binary array, or a Temporal value; an ordinary number comes before `-0`, and `-0` before `NaN`; binary arrays are ordered by type name, so a `Buffer` comes before a `Uint8Array` with the same bytes. Before, the member with the smallest row key supplied the value. For example, a group that holds `new Date(0)` and `0` now projects `0`, and a group that holds `-0` and `0` now projects `0`. Values that are not equal under query equality are in different groups and do not change.
