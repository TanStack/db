Based on my investigation of the codebase, I can provide a detailed answer:

## Short Answer

**No, querying by object fields within arrays is not currently supported.** The query builder does not support complex array operations like `.some()` or `.filter()`.

## Explanation

The `inArray(value, array)` function works differently than what you're trying to achieve. It checks if a **primitive value** exists within an array field:

```typescript
// ✅ This works - checking if a string is in an array of strings
.where(({ item }) => inArray('JavaScript', item.skills))

// ✅ This also works - checking if a number is in an array
.where(({ item }) => inArray(item.id, [1, 2, 3]))
```

However, **querying where an array of objects contains an object with a specific property value** would require `.some()` style operations:

```typescript
// ❌ NOT SUPPORTED - this is what you're trying to do
// "Find items where a.b contains any object with queryMe === 'foo'"
.where(({ item }) => item.a.b.some(obj => obj.queryMe === 'foo'))
```

This limitation is documented in the codebase (from `packages/db/tests/query/where.test.ts`):
> "Complex array operations like `.some()` and `.filter()` are not supported in query builder. This would require implementation of array-specific query functions."

## Workarounds

Depending on your use case, you have a few options:

1. **Denormalize your data** - If you frequently query by `queryMe`, consider storing those values in a flat array alongside your nested structure:
   ```typescript
   {
     a: {
       b: [{ queryMe: 'foo' }, { queryMe: 'bar' }],
       queryMeValues: ['foo', 'bar']  // denormalized for querying
     }
   }
   // Then you can query:
   .where(({ item }) => inArray('foo', item.a?.queryMeValues))
   ```

2. **Filter in memory** - Query a broader set of data and filter client-side:
   ```typescript
   const allItems = myCollection.state.values()
   const filtered = [...allItems].filter(item =>
     item.a?.b?.some(obj => obj.queryMe === 'foo')
   )
   ```

3. **Use a separate collection** - If the nested objects are significant entities, consider storing them in their own collection with a reference.

## Feature Request

If this is a common need for TanStack/db users, it might be worth opening a feature request for array query operators like `arrayContains`, `arraySome`, or similar functions that would enable queries like:

```typescript
// Potential future API (not currently available)
.where(({ item }) => arraySome(item.a?.b, (obj) => eq(obj.queryMe, 'foo')))
```
