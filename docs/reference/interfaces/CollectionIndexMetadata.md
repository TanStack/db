---
id: CollectionIndexMetadata
title: CollectionIndexMetadata
---

Defined in: [packages/db/src/collection/events.ts:91](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L91)

## Properties

### expression

```ts
expression: BasicExpression;
```

Defined in: [packages/db/src/collection/events.ts:103](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L103)

***

### indexId

```ts
indexId: number;
```

Defined in: [packages/db/src/collection/events.ts:101](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L101)

***

### name?

```ts
optional name: string;
```

Defined in: [packages/db/src/collection/events.ts:102](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L102)

***

### options?

```ts
optional options: CollectionIndexSerializableValue;
```

Defined in: [packages/db/src/collection/events.ts:105](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L105)

***

### resolver

```ts
resolver: CollectionIndexResolverMetadata;
```

Defined in: [packages/db/src/collection/events.ts:104](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L104)

***

### signature

```ts
signature: string;
```

Defined in: [packages/db/src/collection/events.ts:100](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L100)

Stable signature derived from expression + serializable options.
Non-serializable option fields are intentionally omitted.

***

### signatureVersion

```ts
signatureVersion: 1;
```

Defined in: [packages/db/src/collection/events.ts:95](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L95)

Version for the signature serialization contract.
