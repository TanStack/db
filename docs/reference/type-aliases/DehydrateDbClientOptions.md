---
id: DehydrateDbClientOptions
title: DehydrateDbClientOptions
---

```ts
type DehydrateDbClientOptions = object;
```

Defined in: [packages/db/src/client.ts:158](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L158)

## Properties

### shouldDehydrateCollection()?

```ts
optional shouldDehydrateCollection: (collection) => boolean;
```

Defined in: [packages/db/src/client.ts:159](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L159)

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

Defined in: [packages/db/src/client.ts:160](https://github.com/TanStack/db/blob/main/packages/db/src/client.ts#L160)

#### Parameters

##### query

[`DbClientLiveQuery`](DbClientLiveQuery.md)

#### Returns

`boolean`
