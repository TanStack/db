---
id: ParseWhereOptions
title: ParseWhereOptions
---

# Interface: ParseWhereOptions\<T\>

Defined in: packages/db/src/query/expression-helpers.ts:53

Options for customizing how WHERE expressions are parsed

## Type Parameters

### T

`T` = `any`

## Properties

### handlers

```ts
handlers: object & object;
```

Defined in: packages/db/src/query/expression-helpers.ts:67

Handler functions for different operators.
Each handler receives the parsed field path(s) and value(s) and returns your custom format.

Supported operators from TanStack DB:
- Comparison: eq, gt, gte, lt, lte, in, like, ilike
- Logical: and, or, not
- Null checking: isNull, isUndefined
- String functions: upper, lower, length, concat
- Numeric: add
- Utility: coalesce
- Aggregates: count, avg, sum, min, max

#### Type Declaration

##### add()?

```ts
optional add: (...args) => T;
```

###### Parameters

###### args

...`any`[]

###### Returns

`T`

##### and()?

```ts
optional and: (...args) => T;
```

###### Parameters

###### args

...`any`[]

###### Returns

`T`

##### avg()?

```ts
optional avg: (...args) => T;
```

###### Parameters

###### args

...`any`[]

###### Returns

`T`

##### coalesce()?

```ts
optional coalesce: (...args) => T;
```

###### Parameters

###### args

...`any`[]

###### Returns

`T`

##### concat()?

```ts
optional concat: (...args) => T;
```

###### Parameters

###### args

...`any`[]

###### Returns

`T`

##### count()?

```ts
optional count: (...args) => T;
```

###### Parameters

###### args

...`any`[]

###### Returns

`T`

##### eq()?

```ts
optional eq: (...args) => T;
```

###### Parameters

###### args

...`any`[]

###### Returns

`T`

##### gt()?

```ts
optional gt: (...args) => T;
```

###### Parameters

###### args

...`any`[]

###### Returns

`T`

##### gte()?

```ts
optional gte: (...args) => T;
```

###### Parameters

###### args

...`any`[]

###### Returns

`T`

##### ilike()?

```ts
optional ilike: (...args) => T;
```

###### Parameters

###### args

...`any`[]

###### Returns

`T`

##### in()?

```ts
optional in: (...args) => T;
```

###### Parameters

###### args

...`any`[]

###### Returns

`T`

##### isNull()?

```ts
optional isNull: (...args) => T;
```

###### Parameters

###### args

...`any`[]

###### Returns

`T`

##### isUndefined()?

```ts
optional isUndefined: (...args) => T;
```

###### Parameters

###### args

...`any`[]

###### Returns

`T`

##### length()?

```ts
optional length: (...args) => T;
```

###### Parameters

###### args

...`any`[]

###### Returns

`T`

##### like()?

```ts
optional like: (...args) => T;
```

###### Parameters

###### args

...`any`[]

###### Returns

`T`

##### lower()?

```ts
optional lower: (...args) => T;
```

###### Parameters

###### args

...`any`[]

###### Returns

`T`

##### lt()?

```ts
optional lt: (...args) => T;
```

###### Parameters

###### args

...`any`[]

###### Returns

`T`

##### lte()?

```ts
optional lte: (...args) => T;
```

###### Parameters

###### args

...`any`[]

###### Returns

`T`

##### max()?

```ts
optional max: (...args) => T;
```

###### Parameters

###### args

...`any`[]

###### Returns

`T`

##### min()?

```ts
optional min: (...args) => T;
```

###### Parameters

###### args

...`any`[]

###### Returns

`T`

##### not()?

```ts
optional not: (...args) => T;
```

###### Parameters

###### args

...`any`[]

###### Returns

`T`

##### or()?

```ts
optional or: (...args) => T;
```

###### Parameters

###### args

...`any`[]

###### Returns

`T`

##### sum()?

```ts
optional sum: (...args) => T;
```

###### Parameters

###### args

...`any`[]

###### Returns

`T`

##### upper()?

```ts
optional upper: (...args) => T;
```

###### Parameters

###### args

...`any`[]

###### Returns

`T`

***

### onUnknownOperator()?

```ts
optional onUnknownOperator: (operator, args) => T;
```

Defined in: packages/db/src/query/expression-helpers.ts:76

Optional handler for when an unknown operator is encountered.
If not provided, unknown operators throw an error.

#### Parameters

##### operator

`string`

##### args

`any`[]

#### Returns

`T`
