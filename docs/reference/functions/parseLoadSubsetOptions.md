---
id: parseLoadSubsetOptions
title: parseLoadSubsetOptions
---

# Function: parseLoadSubsetOptions()

```ts
function parseLoadSubsetOptions(options): object;
```

Defined in: packages/db/src/query/expression-helpers.ts:499

Convenience function to get all LoadSubsetOptions in a pre-parsed format.
Good starting point for simple use cases.

## Parameters

### options

The LoadSubsetOptions from ctx.meta

\{
`limit?`: `number`;
`orderBy?`: [`OrderBy`](../@tanstack/namespaces/IR/type-aliases/OrderBy.md);
`where?`: `BasicExpression`\<`boolean`\>;
\} | `null` | `undefined`

## Returns

`object`

Pre-parsed filters, sorts, and limit

### filters

```ts
filters: SimpleComparison[];
```

### limit?

```ts
optional limit: number;
```

### sorts

```ts
sorts: ParsedOrderBy[];
```

## Example

```typescript
queryFn: async (ctx) => {
  const parsed = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions)

  // Convert to your API format
  return api.getProducts({
    ...Object.fromEntries(
      parsed.filters.map(f => [`${f.field.join('.')}_${f.operator}`, f.value])
    ),
    sort: parsed.sorts.map(s => `${s.field.join('.')}:${s.direction}`).join(','),
    limit: parsed.limit
  })
}
```
