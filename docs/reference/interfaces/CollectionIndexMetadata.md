---
id: CollectionIndexMetadata
title: CollectionIndexMetadata
---

Defined in: [packages/db/src/collection/events.ts:71](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L71)

## Properties

### expression

```ts
expression: BasicExpression;
```

Defined in: [packages/db/src/collection/events.ts:83](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L83)

***

### indexId

```ts
indexId: number;
```

Defined in: [packages/db/src/collection/events.ts:81](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L81)

***

### name?

```ts
optional name: string;
```

Defined in: [packages/db/src/collection/events.ts:82](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L82)

***

### options?

```ts
optional options: CollectionIndexSerializableValue;
```

Defined in: [packages/db/src/collection/events.ts:85](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L85)

***

### resolver

```ts
resolver: CollectionIndexResolverMetadata;
```

Defined in: [packages/db/src/collection/events.ts:84](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L84)

***

### signature

```ts
signature: string;
```

Defined in: [packages/db/src/collection/events.ts:80](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L80)

Stable signature derived from expression + serializable options.
Non-serializable option fields are intentionally omitted.

***

### signatureVersion

```ts
signatureVersion: 1;
```

Defined in: [packages/db/src/collection/events.ts:75](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L75)

Version for the signature serialization contract.
