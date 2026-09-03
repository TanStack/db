---
id: LoadSubsetFn
title: LoadSubsetFn
---

# Type Alias: LoadSubsetFn()

```ts
type LoadSubsetFn = (options) => true | Promise<void>;
```

Defined in: [packages/db/src/types.ts:346](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L346)

Loads one subset and transfers its ongoing resource ownership only after
returning `true` or a promise. An implementation that throws synchronously
must release any partially acquired resource before throwing. A successful
implementation must await or return every applied receipt from the sync
`commit()` calls that establish the loaded subset.

## Parameters

### options

[`LoadSubsetOptions`](LoadSubsetOptions.md)

## Returns

`true` \| `Promise`\<`void`\>
