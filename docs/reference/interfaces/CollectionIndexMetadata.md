---
id: CollectionIndexMetadata
title: CollectionIndexMetadata
---

Defined in: [packages/db/src/collection/events.ts:81](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L81)

## Properties

### expression

```ts
expression: BasicExpression;
```

Defined in: [packages/db/src/collection/events.ts:93](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L93)

***

### indexId

```ts
indexId: number;
```

Defined in: [packages/db/src/collection/events.ts:91](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L91)

***

### name?

```ts
optional name: string;
```

Defined in: [packages/db/src/collection/events.ts:92](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L92)

***

### options?

```ts
optional options: CollectionIndexSerializableValue;
```

Defined in: [packages/db/src/collection/events.ts:95](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L95)

***

### resolver

```ts
resolver: CollectionIndexResolverMetadata;
```

Defined in: [packages/db/src/collection/events.ts:94](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L94)

***

### signature

```ts
signature: string;
```

Defined in: [packages/db/src/collection/events.ts:90](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L90)

Stable signature derived from expression + serializable options.
Non-serializable option fields are intentionally omitted.

***

### signatureVersion

```ts
signatureVersion: 1;
```

Defined in: [packages/db/src/collection/events.ts:85](https://github.com/TanStack/db/blob/main/packages/db/src/collection/events.ts#L85)

Version for the signature serialization contract.
