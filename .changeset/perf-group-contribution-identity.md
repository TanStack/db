---
'@tanstack/db-ivm': patch
'@tanstack/db': patch
---

Aggregate queries hydrate and update faster. `groupBy` merges equal contributions to a group, and it used to find them by hashing every contribution. Each contribution now leads with an identity built from its group key and its pre-aggregate values, and the reduce index merges contributions with equal identities without hashing them. Primitives, dense arrays of primitives, query group values, row metadata and `avg` inputs have identities, and two of them get equal identities exactly when they are equal under the structural hash's value rules. A contribution that holds any other object, or whose group key has another value, still goes through the structural hash. A grouped count or min over 10,000 rows hydrates about 2× faster.

`reduce` takes `{ prefixIdentity }`: its input values lead with a string or number that determines them, so equal leading values merge without a hash. A basic `groupBy` aggregate may declare `identity` for an object input. It must give the same result, a string or undefined, for any two inputs that hash equal.
