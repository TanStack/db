---
id: VirtualOrigin
title: VirtualOrigin
---

```ts
type VirtualOrigin = "local" | "remote";
```

Defined in: [packages/db/src/virtual-props.ts:36](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L36)

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
A source write on a still-pending manual mutation's key applies immediately
and can keep `'local'` attribution if that mutation rolls back.
When two same-key mutations both persist before a source transaction is
queued, with no truncate, a successful one retains one local attribution
for the key even if its sibling fails; two failures retain none. A later
same-key transaction in a truncate drain is
`'remote'` after the truncate transaction consumes that attribution.
An independent peer write can be labeled `'local'`, and a later confirmation
from this client can be labeled `'remote'`. Local-only Collections always use
`'local'`.
