---
'@tanstack/db': patch
---

Update a grouped count without re-reading the group when the group's members contribute identical inputs. Before, each change to a `groupBy` group or to a count inside an include re-read every member of the group, because each member's contribution carried its row key. For example, an include that counts the comments of an issue re-read all of that issue's comments on each new comment. A `sum`, `avg`, `min`, or `max` over distinct values still visits one contribution for each distinct exact input.

A `groupBy` value now comes from the member with the smallest exact value, when several members are equal under query equality but differ exactly. A primitive comes before a Date, a binary array, or a Temporal value; another number comes before `-0`; a `Buffer` comes before a `Uint8Array` with the same bytes. Before, the member with the smallest row key supplied the value. For example, a group that holds `new Date(0)` and `0` now projects `0`, and a group that holds `-0` and `0` now projects `0`. The projected value is always an instance that a current member holds. Values that are not equal under query equality are in different groups and do not change.
