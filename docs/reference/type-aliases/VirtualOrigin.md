---
id: VirtualOrigin
title: VirtualOrigin
---

# Type Alias: VirtualOrigin

```ts
type VirtualOrigin = "local" | "remote";
```

Defined in: [packages/db/src/virtual-props.ts:22](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L22)

Origin of the last confirmed change to a row, from the current client's perspective.

- `'local'`: The change originated from this client (e.g., a mutation made here)
- `'remote'`: The change was received via sync from another client/server

Note: This reflects the client's perspective, not the original creator.
User A creates order → $origin = 'local' on User A's client
Order syncs to server
User B receives order → $origin = 'remote' on User B's client
