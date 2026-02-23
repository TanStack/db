---
id: ResultTypeFromSelect
title: ResultTypeFromSelect
---

# Type Alias: ResultTypeFromSelect\<TSelectObject\>

```ts
type ResultTypeFromSelect<TSelectObject> = WithoutRefBrand<Prettify<{ [K in keyof TSelectObject]: NeedsExtraction<TSelectObject[K]> extends true ? ExtractExpressionType<TSelectObject[K]> : TSelectObject[K] extends Ref<infer _T> ? ExtractRef<TSelectObject[K]> : TSelectObject[K] extends RefLeaf<infer T> ? T : TSelectObject[K] extends RefLeaf<infer T> | undefined ? T | undefined : TSelectObject[K] extends RefLeaf<infer T> | null ? T | null : TSelectObject[K] extends Ref<(...)> | undefined ? ExtractRef<(...)> | undefined : (...)[(...)] extends (...) | (...) ? (...) | (...) : (...) extends (...) ? (...) : (...) }>>;
```

Defined in: packages/db/src/query/builder/types.ts:226

ResultTypeFromSelect - Infers the result type from a select object

This complex type transforms the input to `select()` into the actual TypeScript
type that the query will return. It handles all the different kinds of values
that can appear in a select clause:

**Ref/RefProxy Extraction**:
- `RefProxy<T>` → `T`: Extracts the underlying type
- `Ref<T> | undefined` → `T | undefined`: Preserves optionality
- `Ref<T> | null` → `T | null`: Preserves nullability

**Expression Types**:
- `BasicExpression<T>` → `T`: Function results like `upper()` → `string`
- `Aggregate<T>` → `T`: Aggregation results like `count()` → `number`

**JavaScript Literals** (pass through as-is):
- `string` → `string`: String literals remain strings
- `number` → `number`: Numeric literals remain numbers
- `boolean` → `boolean`: Boolean literals remain booleans
- `null` → `null`: Explicit null remains null
- `undefined` → `undefined`: Direct undefined values

**Nested Objects** (recursive):
- Plain objects are recursively processed to handle nested projections
- RefProxy objects are detected and their types extracted

Example transformation:
```typescript
// Input:
{ id: Ref<number>, name: Ref<string>, status: 'active', count: 42, profile: { bio: Ref<string> } }

// Output:
{ id: number, name: string, status: 'active', count: 42, profile: { bio: string } }
```

## Type Parameters

### TSelectObject

`TSelectObject`
