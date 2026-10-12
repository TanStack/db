---
id: VirtualOrigin
title: VirtualOrigin
---

```ts
type VirtualOrigin = "local" | "remote";
```

Defined in: [packages/db/src/virtual-props.ts:38](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L38)

Collection attribution for a row's current value.

- `'local'`: An optimistic row, or a source write attributed through a
  same-key local mutation
- `'remote'`: A source write without that local attribution

Synced Collections infer attribution from key and timing, without a source
client ID. With one persisting local mutation and no truncate, the first queued
same-key source transaction published at successful mutation settlement
consumes local attribution. Its surviving row is `'local'`; later source
transactions are `'remote'`. A failed mutation gives those queued
writes no local attribution. A truncate can publish while a mutation remains
active, leaving its same-key row `'local'` even if the mutation later fails.
An unconsumed active mutation on a key omitted by the truncate retains
attribution for its first later same-key source transaction, even in that
drain. A truncate's write consumes attribution for its key, so a later
same-key transaction in that drain is `'remote'` without a new local owner.
A source write on a still-pending manual mutation's key applies immediately
and can keep `'local'` attribution if that mutation rolls back.
When two same-key mutations both persist before a source transaction is
queued, with no truncate, a successful one retains one local attribution
for the key even if its sibling fails; two failures retain none.
An independent peer write can be labeled `'local'`, and a later confirmation
from this client can be labeled `'remote'`. Local-only Collections always use
`'local'`.
