# @tanstack/db-ivm

## 0.1.6

### Patch Changes

- optimise key loading into query graph ([#526](https://github.com/TanStack/db/pull/526))

## 0.1.5

### Patch Changes

- Fix bug where different numbers would hash to the same value. This caused distinct not to work properly. ([#525](https://github.com/TanStack/db/pull/525))

## 0.1.4

### Patch Changes

- Check typeof Buffer before instanceof to avoid ReferenceError in browsers ([#519](https://github.com/TanStack/db/pull/519))

## 0.1.3

### Patch Changes

- fix count aggregate function (evaluate only not null field values like SQL count) ([#453](https://github.com/TanStack/db/pull/453))

- Hybrid index implementation to track values and their multiplicities ([#489](https://github.com/TanStack/db/pull/489))

- Replace JSON.stringify based hash function by structural hashing function. ([#491](https://github.com/TanStack/db/pull/491))

## 0.1.2

### Patch Changes

- Optimize order by to lazily load ordered data if a range index is available on the field that is being ordered on. ([#410](https://github.com/TanStack/db/pull/410))

- Optimize joins to use index on the join key when available. ([#335](https://github.com/TanStack/db/pull/335))

## 0.1.1

### Patch Changes

- Fix bug with orderBy that resulted in query results having less rows than the configured limit. ([#405](https://github.com/TanStack/db/pull/405))

## 0.1.0

### Minor Changes

- 0.1 release - first beta 🎉 ([#332](https://github.com/TanStack/db/pull/332))

### Patch Changes

- We have moved development of the differential dataflow implementation from @electric-sql/d2mini to a new @tanstack/db-ivm package inside the tanstack db monorepo to make development simpler. ([#330](https://github.com/TanStack/db/pull/330))
