---
id: DehydrateDbClientOptions
title: DehydrateDbClientOptions
---

# Type Alias: DehydrateDbClientOptions

```ts
type DehydrateDbClientOptions = object;
```

Defined in: [packages/db/src/client.ts:155](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L155)

## Properties

### shouldDehydrateCollection()?

```ts
optional shouldDehydrateCollection: (collection) => boolean;
```

Defined in: [packages/db/src/client.ts:156](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L156)

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

Defined in: [packages/db/src/client.ts:157](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L157)

#### Parameters

##### query

[`DbClientLiveQuery`](DbClientLiveQuery.md)

#### Returns

`boolean`
