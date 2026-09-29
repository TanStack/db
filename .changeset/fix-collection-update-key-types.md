---
'@tanstack/db': minor
---

Require `Collection.update` keys to match the collection's declared key type.
Calls that pass possibly undefined keys (including unchecked indexed access) or
plain strings to branded-key collections must narrow or assert those values to
the declared key type before calling `update`.
