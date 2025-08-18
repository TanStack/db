# @tanstack/db-ivm

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
