---
id: ParsedOrderBy
title: ParsedOrderBy
---

Defined in: [packages/db/src/query/expression-helpers.ts:83](https://github.com/TanStack/db/blob/main/packages/db/src/query/expression-helpers.ts#L83)

Result of parsing an ORDER BY expression

## Properties

### compare()?

```ts
optional compare: (a, b) => number;
```

Defined in: [packages/db/src/query/expression-helpers.ts:94](https://github.com/TanStack/db/blob/main/packages/db/src/query/expression-helpers.ts#L94)

Exact local comparator used by custom string sorting.

#### Parameters

##### a

`string`

##### b

`string`

#### Returns

`number`

***

### direction

```ts
direction: "asc" | "desc";
```

Defined in: [packages/db/src/query/expression-helpers.ts:85](https://github.com/TanStack/db/blob/main/packages/db/src/query/expression-helpers.ts#L85)

***

### field

```ts
field: FieldPath;
```

Defined in: [packages/db/src/query/expression-helpers.ts:84](https://github.com/TanStack/db/blob/main/packages/db/src/query/expression-helpers.ts#L84)

***

### locale?

```ts
optional locale: string;
```

Defined in: [packages/db/src/query/expression-helpers.ts:90](https://github.com/TanStack/db/blob/main/packages/db/src/query/expression-helpers.ts#L90)

Locale for locale-aware string sorting (e.g., 'en-US')

***

### localeOptions?

```ts
optional localeOptions: object;
```

Defined in: [packages/db/src/query/expression-helpers.ts:92](https://github.com/TanStack/db/blob/main/packages/db/src/query/expression-helpers.ts#L92)

Additional options for locale-aware sorting

***

### nulls

```ts
nulls: "first" | "last";
```

Defined in: [packages/db/src/query/expression-helpers.ts:86](https://github.com/TanStack/db/blob/main/packages/db/src/query/expression-helpers.ts#L86)

***

### stringSort?

```ts
optional stringSort: "lexical" | "locale" | "custom";
```

Defined in: [packages/db/src/query/expression-helpers.ts:88](https://github.com/TanStack/db/blob/main/packages/db/src/query/expression-helpers.ts#L88)

String sorting method.
