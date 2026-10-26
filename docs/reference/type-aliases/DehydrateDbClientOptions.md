---
id: DehydrateDbClientOptions
title: DehydrateDbClientOptions
---

```ts
type DehydrateDbClientOptions = object;
```

Defined in: [packages/db/src/client.ts:178](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L178)

## Properties

### shouldDehydrateCollection()?

```ts
optional shouldDehydrateCollection: (collection) => boolean;
```

Defined in: [packages/db/src/client.ts:179](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L179)

#### Parameters

##### collection

[`Collection`](../interfaces/Collection.md)

#### Returns

`boolean`

***

### shouldDehydrateLiveQuery()?

```ts
optional shouldDehydrateLiveQuery: (query) => boolean;
```

Defined in: [packages/db/src/client.ts:180](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L180)

#### Parameters

##### query

[`DbClientLiveQuery`](DbClientLiveQuery.md)

#### Returns

`boolean`
