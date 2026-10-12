---
'@tanstack/db-ivm': patch
'@tanstack/db': patch
---

Aggregate queries hydrate and update faster. `groupBy` merges equal contributions to a group, and it used to find them by hashing every contribution. Each contribution now leads with an identity built from its pre-aggregate values, and the reduce index merges contributions with equal identities without hashing them. Two contributions get equal identities exactly when they hash equal. Primitive values, query group values and row metadata have such identities. A contribution that holds another object still goes through the structural hash. A grouped count over a 10,000-row join hydrates about 37% faster, and grouped incremental updates are about 22% faster.

`Index` takes a `prefixIdentity` option and `reduce` takes `{ prefixIdentity }`. A basic `groupBy` aggregate may declare `identity` for an object input.
