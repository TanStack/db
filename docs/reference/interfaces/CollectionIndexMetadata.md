---
id: CollectionIndexMetadata
title: CollectionIndexMetadata
---

# Interface: CollectionIndexMetadata

Defined in: [packages/db/src/collection/events.ts:70](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L70)

## Properties

### expression

```ts
expression: BasicExpression;
```

Defined in: [packages/db/src/collection/events.ts:82](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L82)

***

### indexId

```ts
indexId: number;
```

Defined in: [packages/db/src/collection/events.ts:80](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L80)

***

### name?

```ts
optional name: string;
```

Defined in: [packages/db/src/collection/events.ts:81](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L81)

***

### options?

```ts
optional options: CollectionIndexSerializableValue;
```

Defined in: [packages/db/src/collection/events.ts:84](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L84)

***

### resolver

```ts
resolver: CollectionIndexResolverMetadata;
```

Defined in: [packages/db/src/collection/events.ts:83](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L83)

***

### signature

```ts
signature: string;
```

Defined in: [packages/db/src/collection/events.ts:79](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L79)

Stable signature derived from expression + serializable options.
Non-serializable option fields are intentionally omitted.

***

### signatureVersion

```ts
signatureVersion: 1;
```

Defined in: [packages/db/src/collection/events.ts:74](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L74)

Version for the signature serialization contract.
