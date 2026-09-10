---
id: ParsedOrderBy
title: ParsedOrderBy
---

# Interface: ParsedOrderBy

Defined in: [packages/db/src/query/expression-helpers.ts:82](https://github.com/TanStack/db/blob/main/packages/db/src/query/expression-helpers.ts#L82)

Result of parsing an ORDER BY expression

## Properties

### direction

```ts
direction: "asc" | "desc";
```

Defined in: [packages/db/src/query/expression-helpers.ts:84](https://github.com/TanStack/db/blob/main/packages/db/src/query/expression-helpers.ts#L84)

***

### field

```ts
field: FieldPath;
```

Defined in: [packages/db/src/query/expression-helpers.ts:83](https://github.com/TanStack/db/blob/main/packages/db/src/query/expression-helpers.ts#L83)

***

### locale?

```ts
optional locale: string;
```

Defined in: [packages/db/src/query/expression-helpers.ts:89](https://github.com/TanStack/db/blob/main/packages/db/src/query/expression-helpers.ts#L89)

Locale for locale-aware string sorting (e.g., 'en-US')

***

### localeOptions?

```ts
optional localeOptions: object;
```

Defined in: [packages/db/src/query/expression-helpers.ts:91](https://github.com/TanStack/db/blob/main/packages/db/src/query/expression-helpers.ts#L91)

Additional options for locale-aware sorting

***

### nulls

```ts
nulls: "first" | "last";
```

Defined in: [packages/db/src/query/expression-helpers.ts:85](https://github.com/TanStack/db/blob/main/packages/db/src/query/expression-helpers.ts#L85)

***

### stringSort?

```ts
optional stringSort: "lexical" | "locale";
```

Defined in: [packages/db/src/query/expression-helpers.ts:87](https://github.com/TanStack/db/blob/main/packages/db/src/query/expression-helpers.ts#L87)

String sorting method: 'lexical' (default) or 'locale' (locale-aware)
