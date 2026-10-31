---
id: hasVirtualProps
title: hasVirtualProps
---

```ts
function hasVirtualProps(value): value is VirtualRowProps<string | number>;
```

Defined in: [packages/db/src/virtual-props.ts:167](https://github.com/TanStack/db/blob/main/packages/db/src/virtual-props.ts#L167)

Checks if a value has all virtual properties attached.

## Parameters

### value

`unknown`

The value to check

## Returns

value is VirtualRowProps\<string \| number\>

true if the value has virtual properties

## Example

```typescript
if (hasVirtualProps(row)) {
  console.log('Pending local writes:', row.$hasPendingWrites)
}
```
