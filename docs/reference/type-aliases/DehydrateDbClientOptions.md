---
id: DehydrateDbClientOptions
title: DehydrateDbClientOptions
---

```ts
type DehydrateDbClientOptions = object;
```

Defined in: [packages/db/src/client.ts:194](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L194)

## Properties

### shouldDehydrateCollection()?

```ts
optional shouldDehydrateCollection: (collection) => boolean;
```

Defined in: [packages/db/src/client.ts:195](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L195)

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

Defined in: [packages/db/src/client.ts:196](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L196)

#### Parameters

##### query

[`DbClientLiveQuery`](DbClientLiveQuery.md)

#### Returns

`boolean`
