---
'@tanstack/db': patch
'@tanstack/db-ivm': patch
'@tanstack/offline-transactions': patch
---

Preserve fractional top-k replacements regardless of delta order, including left-join updates, and honor B-tree lookup fallbacks after node splits. Preserve own JSON data properties such as `__proto__` during mutation detachment and offline transaction serialization.

Cancel structurally equal mapped top-k deltas before applying replacements. Escape Date-marker-shaped user objects in new offline records while retaining read support for the original record format.

Offline storage compatibility: new records use `valueEncoding: 2`. Older clients
cannot decode escaped marker-shaped objects correctly, so do not mix old and
new clients against the same pending outbox or downgrade while new records
remain. New clients still read the original unversioned format. Unknown
encodings and corrupt records are reported through warnings and left in
storage, not silently discarded; recovery policy is tracked in RFC #1659.

Reject malformed escaped-object markers rather than inventing empty mutation
data. Avoid redundant transfer work for zero-width fractional top-k windows
and avoid descriptor writes for ordinary keys during draft copying.
