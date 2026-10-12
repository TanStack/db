---
'@tanstack/db-ivm': patch
'@tanstack/db': patch
---

Aggregate queries hydrate and update faster. `groupBy` merges equal contributions to a group, and it used to find them by hashing every contribution. Each contribution now leads with an identity string built from its group key and its pre-aggregate values, and the reduce index merges contributions with equal identities without hashing them. D2 value identity (`equalHashValues`) defines the identity: two values get the same identity string exactly when D2 treats them as equal. Primitives, arrays, plain and class-instance objects, Dates, RegExps, Maps, Sets and Uint8Arrays get an identity. A contribution that holds anything else, a value nested more than four levels deep, or an object with an enumerable symbol key still goes through the structural hash. A grouped count or min over 10,000 rows hydrates about 2× faster.
