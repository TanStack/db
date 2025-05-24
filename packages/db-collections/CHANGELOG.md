# @tanstack/db-collections

## 0.0.6

### Patch Changes

- Updated dependencies [[`8ce449e`](https://github.com/TanStack/db/commit/8ce449ed6d070e9e591d1b74b0db5fed7a3fc92f)]:
  - @tanstack/db@0.0.4

## 0.0.5

### Patch Changes

- Replace `queryCollection.invalidate()` with `queryCollection.refetch()`. ([#109](https://github.com/TanStack/db/pull/109))

  This means that we actually wait for the collection to be updated before
  discarding local optimistic state.

## 0.0.4

### Patch Changes

- Added staleTime support for QueryCollection ([#104](https://github.com/TanStack/db/pull/104))

## 0.0.3

### Patch Changes

- Updated dependencies [[`b29420b`](https://github.com/TanStack/db/commit/b29420bcdae30dfeffeef63a8753b83306a54e5a)]:
  - @tanstack/db@0.0.3

## 0.0.2

### Patch Changes

- Added QueryCollection ([#78](https://github.com/TanStack/db/pull/78))

- Updated dependencies [[`4c82edb`](https://github.com/TanStack/db/commit/4c82edb9547f26c9de44f5bf43d4385c38920672)]:
  - @tanstack/db@0.0.2
