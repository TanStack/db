---
id: hasVirtualProps
title: hasVirtualProps
---

```ts
function hasVirtualProps(value): value is VirtualRowProps<string | number>;
```

Defined in: [packages/db/src/virtual-props.ts:194](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L194)

Checks if a value has virtual properties attached. Legacy rows with the
original four properties still match; only rows published by this version
are guaranteed to carry `$hasPendingWrites`.

## Parameters

### value

`unknown`

The value to check

## Returns

value is VirtualRowProps\<string \| number\>

true if the value has virtual properties

## Example

```typescript
if (hasVirtualProps(row) && row.$hasPendingWrites !== undefined) {
  console.log('Pending local writes:', row.$hasPendingWrites)
}
```
