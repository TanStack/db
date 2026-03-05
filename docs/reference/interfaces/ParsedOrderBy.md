---
id: ParsedOrderBy
title: ParsedOrderBy
---

# Interface: ParsedOrderBy

Defined in: packages/db/src/query/expression-helpers.ts:82

Result of parsing an ORDER BY expression

## Properties

### direction

```ts
direction: "asc" | "desc";
```

Defined in: packages/db/src/query/expression-helpers.ts:84

***

### field

```ts
field: FieldPath;
```

Defined in: packages/db/src/query/expression-helpers.ts:83

***

### locale?

```ts
optional locale: string;
```

Defined in: packages/db/src/query/expression-helpers.ts:89

Locale for locale-aware string sorting (e.g., 'en-US')

***

### localeOptions?

```ts
optional localeOptions: object;
```

Defined in: packages/db/src/query/expression-helpers.ts:91

Additional options for locale-aware sorting

***

### nulls

```ts
nulls: "first" | "last";
```

Defined in: packages/db/src/query/expression-helpers.ts:85

***

### stringSort?

```ts
optional stringSort: "lexical" | "locale";
```

Defined in: packages/db/src/query/expression-helpers.ts:87

String sorting method: 'lexical' (default) or 'locale' (locale-aware)
