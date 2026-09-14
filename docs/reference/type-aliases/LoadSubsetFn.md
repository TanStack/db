---
id: LoadSubsetFn
title: LoadSubsetFn
---

# Type Alias: LoadSubsetFn()

```ts
type LoadSubsetFn = (options) => true | Promise<void>;
```

Defined in: [packages/db/src/types.ts:360](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L360)

Loads one subset and transfers its ongoing resource ownership only after
returning `true` or a promise. An implementation that throws synchronously
must release any partially acquired resource before throwing. A successful
implementation must await or return every applied receipt from the sync
`commit()` calls that establish the loaded subset. A result describes only
the exact `options` passed to this call.

## Parameters

### options

[`LoadSubsetOptions`](LoadSubsetOptions.md)

## Returns

`true` \| `Promise`\<`void`\>
