---
id: CustomSQLiteSerializer
title: CustomSQLiteSerializer
---

# Type Alias: CustomSQLiteSerializer\<TOutput, TSQLite\>

```ts
type CustomSQLiteSerializer<TOutput, TSQLite> = Partial<{ [Key in keyof TOutput]: (value: TOutput[Key]) => Key extends keyof TSQLite ? TSQLite[Key] : never }>;
```

Defined in: [definitions.ts:52](https://github.com/TanStack/db/blob/main/packages/powersync-db-collection/src/definitions.ts#L52)

A mapping type for custom serialization of object properties to SQLite-compatible values.

This type allows you to override, for keys in the input object (`TOutput`), a function that transforms
the value to the corresponding SQLite type (`TSQLite`). Keys not specified will use the default SQLite serialization.

## Generics
- `TOutput`: The input object type, representing the row data to be serialized.
- `TSQLite`: The target SQLite-compatible type for each property, typically inferred from the table schema.

## Usage
Use this type to define a map of serialization functions for specific keys when you need custom handling
(e.g., converting complex objects, formatting dates, or handling enums).

Example:
```ts
const serializer: CustomSQLiteSerializer<MyRowType, MySQLiteType> = {
  createdAt: (date) => date.toISOString(),
  status: (status) => status ? 1 : 0,
  meta: (meta) => JSON.stringify(meta),
};
```

## Behavior
- Each key maps to a function that receives the value and returns the SQLite-compatible value.
- Used by `serializeForSQLite` to override default serialization for specific columns.

## Type Parameters

### TOutput

`TOutput` *extends* `Record`\<`string`, `unknown`\>

### TSQLite

`TSQLite` *extends* `Record`\<`string`, `unknown`\>
