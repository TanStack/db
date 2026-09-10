---
id: getQueryPatterns
title: getQueryPatterns
---

# Function: getQueryPatterns()

```ts
function getQueryPatterns(): Map<string, {
  avgTimeMs: number;
  fieldPath: string[];
  queryCount: number;
  totalTimeMs: number;
}>;
```

Defined in: [packages/db/src/indexes/index-registry.ts:164](https://github.com/TanStack/db/blob/main/packages/db/src/indexes/index-registry.ts#L164)

Get query patterns (useful for debugging/testing)

## Returns

`Map`\<`string`, \{
  `avgTimeMs`: `number`;
  `fieldPath`: `string`[];
  `queryCount`: `number`;
  `totalTimeMs`: `number`;
\}\>
