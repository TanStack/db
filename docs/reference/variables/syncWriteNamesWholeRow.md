---
id: syncWriteNamesWholeRow
title: syncWriteNamesWholeRow
---

```ts
const syncWriteNamesWholeRow: unique symbol;
```

Defined in: [packages/db/src/collection/sync.ts:51](https://github.com/TanStack/db/blob/main/packages/db/src/collection/sync.ts#L51)

**`Internal`**

Internal marker on a sync write: an update that names the whole row, as an
insert does. The persisted wrapper hands an insert it already judged this
way. It is not part of the public sync API.
