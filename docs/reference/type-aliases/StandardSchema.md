---
id: StandardSchema
title: StandardSchema
---

# Type Alias: StandardSchema\<T\>

```ts
type StandardSchema<T> = StandardSchemaV1 & object;
```

Defined in: [packages/db/src/types.ts:392](https://github.com/TanStack/db/blob/main/packages/db/src/types.ts#L392)

The Standard Schema interface.
This follows the standard-schema specification: https://github.com/standard-schema/standard-schema

## Type Declaration

### ~standard

```ts
~standard: object;
```

#### ~standard.types?

```ts
optional types: object;
```

#### ~standard.types.input

```ts
input: T;
```

#### ~standard.types.output

```ts
output: T;
```

## Type Parameters

### T

`T`
