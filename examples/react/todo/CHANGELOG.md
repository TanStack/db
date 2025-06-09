# examples/react/todo

## 0.0.9

### Patch Changes

- Collections must have a getId function & use an id for update/delete operators ([#134](https://github.com/TanStack/db/pull/134))

- Switch to Collection options factories instead of extending the Collection class ([#145](https://github.com/TanStack/db/pull/145))

  This refactors `ElectricCollection` and `QueryCollection` into factory functions (`electricCollectionOptions` and `queryCollectionOptions`) that return standard `CollectionConfig` objects and utility functions. Also adds a `createCollection` function to standardize collection instantiation.

- Updated dependencies [[`1fbb844`](https://github.com/TanStack/db/commit/1fbb8447d8425d37cb9ab4f078ffab999b28b06c), [`ee5d026`](https://github.com/TanStack/db/commit/ee5d026715962dd0232fcaca513a8fac9189dce2), [`e4feb0c`](https://github.com/TanStack/db/commit/e4feb0c214835675b47f0aa18a72d004a423df03)]:
  - @tanstack/db-collections@0.0.7
  - @tanstack/react-db@0.0.5

## 0.0.8

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-collections@0.0.6
  - @tanstack/react-db@0.0.4

## 0.0.7

### Patch Changes

- Updated dependencies [[`0bbf4c4`](https://github.com/TanStack/db/commit/0bbf4c46e01b382a70a437f05dfc09c9ff749a15)]:
  - @tanstack/db-collections@0.0.5

## 0.0.6

### Patch Changes

- Updated dependencies [[`2d0fcf1`](https://github.com/TanStack/db/commit/2d0fcf16a61a3fcd6a7220b5501640cc0f67218f)]:
  - @tanstack/db-collections@0.0.4

## 0.0.5

### Patch Changes

- Updated dependencies []:
  - @tanstack/db-collections@0.0.3
  - @tanstack/react-db@0.0.3

## 0.0.4

### Patch Changes

- Updated dependencies [[`4c82edb`](https://github.com/TanStack/db/commit/4c82edb9547f26c9de44f5bf43d4385c38920672), [`4c82edb`](https://github.com/TanStack/db/commit/4c82edb9547f26c9de44f5bf43d4385c38920672)]:
  - @tanstack/react-db@0.0.2
  - @tanstack/db-collections@0.0.2

## 0.0.3

### Patch Changes

- Updated dependencies [[`b42479c`](https://github.com/TanStack/db/commit/b42479cf95f9a820b36e01684b13a9179973f3d8)]:
  - @tanstack/react-db@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [[`9bb6e89`](https://github.com/TanStack/db/commit/9bb6e8909cebdcd7c03091bfc12dd37f5ab2e1ea)]:
  - @tanstack/react-db@0.0.2
