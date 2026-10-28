---
id: DehydrateDbClientOptions
title: DehydrateDbClientOptions
---

```ts
type DehydrateDbClientOptions = object;
```

Defined in: [packages/db/src/client.ts:187](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L187)

## Properties

### shouldDehydrateCollection()?

```ts
optional shouldDehydrateCollection: (collection) => boolean;
```

Defined in: [packages/db/src/client.ts:188](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L188)

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

Defined in: [packages/db/src/client.ts:189](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L189)

#### Parameters

##### query

[`DbClientLiveQuery`](DbClientLiveQuery.md)

#### Returns

`boolean`
