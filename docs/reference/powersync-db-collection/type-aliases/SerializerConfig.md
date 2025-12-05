---
id: SerializerConfig
title: SerializerConfig
---

# Type Alias: SerializerConfig\<TOutput, TSQLite\>

```ts
type SerializerConfig<TOutput, TSQLite> = object;
```

Defined in: [definitions.ts:61](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L61)

## Type Parameters

### TOutput

`TOutput` *extends* `Record`\<`string`, `unknown`\>

### TSQLite

`TSQLite` *extends* `Record`\<`string`, `unknown`\>

## Properties

### onDeserializationError()

```ts
onDeserializationError: (error) => void;
```

Defined in: [definitions.ts:94](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L94)

Application logic should ensure that incoming synced data is always valid.
Failing to deserialize and apply incoming changes results in data inconsistency - which is a fatal error.
Use this callback to react to deserialization errors.

#### Parameters

##### error

`StandardSchemaV1.FailureResult`

#### Returns

`void`

***

### serializer?

```ts
optional serializer: CustomSQLiteSerializer<TOutput, TSQLite>;
```

Defined in: [definitions.ts:87](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L87)

Optional partial serializer object for customizing how individual columns are serialized for SQLite.

This should be a partial map of column keys to serialization functions, following the
[CustomSQLiteSerializer](./CustomSQLiteSerializer.md) type. Each function receives the column value and returns a value
compatible with SQLite storage.

If not provided for a column, the default behavior is used:
  - `TEXT`: Strings are stored as-is; Dates are converted to ISO strings; other types are JSON-stringified.
  - `INTEGER`/`REAL`: Numbers are stored as-is; booleans are mapped to 1/0.

Use this option to override serialization for specific columns, such as formatting dates, handling enums,
or serializing complex objects.

Example:
```typescript
serializer: {
  createdAt: (date) => date.getTime(), // Store as timestamp
  meta: (meta) => JSON.stringify(meta), // Custom object serialization
}
```
