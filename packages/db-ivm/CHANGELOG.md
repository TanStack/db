# @tanstack/db-ivm

## 0.1.13

### Patch Changes

- Fix Uint8Array/Buffer comparison to work by content instead of reference. This enables proper equality checks for binary IDs like ULIDs in WHERE clauses using the `eq` function. ([#779](https://github.com/TanStack/db/pull/779))

- Fix bug with setWindow on ordered queries that have no limit. ([#763](https://github.com/TanStack/db/pull/763))

## 0.1.12

### Patch Changes

- Fix bug with setWindow on ordered queries that have no limit. ([#701](https://github.com/TanStack/db/pull/701))

## 0.1.11

### Patch Changes

- Add `utils.setWindow()` method to live query collections to dynamically change limit and offset on ordered queries. ([#663](https://github.com/TanStack/db/pull/663))

  You can now change the pagination window of an ordered live query without recreating the collection:

  ```ts
  const users = createLiveQueryCollection((q) =>
    q
      .from({ user: usersCollection })
      .orderBy(({ user }) => user.name, 'asc')
      .limit(10)
      .offset(0),
  )

  users.utils.setWindow({ offset: 10, limit: 10 })
  ```

## 0.1.10

### Patch Changes

- Redesign of the join operators with direct algorithms for major performance improvements by replacing composition-based joins (inner+anti) with implementation using mass tracking. Delivers significant performance gains while maintaining full correctness for all join types (inner, left, right, full, anti). ([#571](https://github.com/TanStack/db/pull/571))

## 0.1.9

### Patch Changes

- Add support for Date objects to min/max aggregates and range queries when using an index. ([#428](https://github.com/TanStack/db/pull/428))

## 0.1.8

### Patch Changes

- Fix a bug with distinct operator ([#564](https://github.com/TanStack/db/pull/564))

- Change the ivm indexes to use a three level `key->prefix->hash->value` structure, only falling back to structural hashing when there are multiple values for a single prefix. This removes all hashing during the initial run of a query delivering a 2-3x speedup. ([#549](https://github.com/TanStack/db/pull/549))

## 0.1.7

### Patch Changes

- Fix memory leak that results in linear memory growth with incremental changes over time. Thanks to @sorenbs for finding and fixing this. ([#550](https://github.com/TanStack/db/pull/550))

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
