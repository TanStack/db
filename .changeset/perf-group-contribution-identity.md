---
'@tanstack/db-ivm': patch
'@tanstack/db': patch
---

Aggregate queries hydrate and update faster. `groupBy` merges equal contributions to a group, and it used to find them by hashing every contribution. Each contribution now leads with an identity string built from its group key and its pre-aggregate values, and the reduce index merges contributions with equal identities without hashing them. The structural hash defines the identity: primitives, and arrays and ordinary objects built from them, get one, and two values get the same identity exactly when the hash treats them as equal. A contribution that holds anything else, such as a Date or a Map, still goes through the structural hash. A grouped count or min over 10,000 rows hydrates about 2× faster.

A basic `groupBy` aggregate may declare `identity` for an object input. It must return the same result, a string or undefined, for two inputs that hash equal, and different strings for inputs that hash differently.
