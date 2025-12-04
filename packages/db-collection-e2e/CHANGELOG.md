# @tanstack/db-collection-e2e

## 0.0.14

### Patch Changes

- Updated dependencies [[`c4b9399`](https://github.com/TanStack/db/commit/c4b93997432743d974749683059bf68a082d3e5b), [`a1a484e`](https://github.com/TanStack/db/commit/a1a484ec4d2331d702ab9c4b7e5b02622c76b3dd), [`f458e05`](https://github.com/TanStack/db/commit/f458e05bb6f5b577ba1d1032a48b46cf860f3c9d)]:
  - @tanstack/db@0.5.11
  - @tanstack/query-db-collection@1.0.6
  - @tanstack/electric-db-collection@0.2.12

## 0.0.13

### Patch Changes

- Updated dependencies [[`1d19d22`](https://github.com/TanStack/db/commit/1d19d2219cbbaef6483845df1c3b078077e4e3bd), [`aebd0fa`](https://github.com/TanStack/db/commit/aebd0fa43345ea28dcdb3f446cdd393de1d1e4b7), [`b3e4e80`](https://github.com/TanStack/db/commit/b3e4e80c4b73d96c15391ac25efb518c7ae7ccbb)]:
  - @tanstack/electric-db-collection@0.2.11
  - @tanstack/db@0.5.10
  - @tanstack/query-db-collection@1.0.5

## 0.0.12

### Patch Changes

- Updated dependencies [[`5f474f1`](https://github.com/TanStack/db/commit/5f474f1eabd57e144ba05b0f33d848f7efc8fb07)]:
  - @tanstack/db@0.5.9
  - @tanstack/electric-db-collection@0.2.10
  - @tanstack/query-db-collection@1.0.5

## 0.0.11

### Patch Changes

- Updated dependencies [[`03842c6`](https://github.com/TanStack/db/commit/03842c633eb990448d26d80025d26184c8de58f2)]:
  - @tanstack/electric-db-collection@0.2.9

## 0.0.10

### Patch Changes

- Updated dependencies [[`954c8fe`](https://github.com/TanStack/db/commit/954c8fed5ed92a348ac8b6d8333bc69c955f4f60), [`51c73aa`](https://github.com/TanStack/db/commit/51c73aaa2b27b27966edb98fb6664beb44eac1ac)]:
  - @tanstack/db@0.5.8
  - @tanstack/electric-db-collection@0.2.8
  - @tanstack/query-db-collection@1.0.5

## 0.0.9

### Patch Changes

- Updated dependencies [[`295cb45`](https://github.com/TanStack/db/commit/295cb45797572b232650eddd3d62ffa937fa2fd7)]:
  - @tanstack/db@0.5.7
  - @tanstack/electric-db-collection@0.2.7
  - @tanstack/query-db-collection@1.0.5

## 0.0.8

### Patch Changes

- Updated dependencies [[`a540d7c`](https://github.com/TanStack/db/commit/a540d7c34042d69cf1f81d1219df5f3f3d57e200), [`c8a2c16`](https://github.com/TanStack/db/commit/c8a2c16aa528427d5ddd55cda4ee59a5cb369b5f)]:
  - @tanstack/query-db-collection@1.0.5
  - @tanstack/db@0.5.6
  - @tanstack/electric-db-collection@0.2.6

## 0.0.7

### Patch Changes

- Updated dependencies [[`077fc1a`](https://github.com/TanStack/db/commit/077fc1a418ca090d7533115888c09f3f609e36b2)]:
  - @tanstack/query-db-collection@1.0.4
  - @tanstack/db@0.5.5
  - @tanstack/electric-db-collection@0.2.5

## 0.0.6

### Patch Changes

- Fix progressive mode to use fetchSnapshot and atomic swap ([#852](https://github.com/TanStack/db/pull/852))

  Progressive mode was broken because `requestSnapshot()` injected snapshots into the stream in causally correct position, which didn't work properly with the `full` mode stream. This release fixes progressive mode by:

  **Core Changes:**
  - Use `fetchSnapshot()` during initial sync to fetch and apply snapshots immediately in sync transactions
  - Buffer all stream messages during initial sync (renamed flag to `isBufferingInitialSync`)
  - Perform atomic swap on first `up-to-date`: truncate snapshot data → apply buffered messages → mark ready
  - Track txids/snapshots only after atomic swap (enables correct optimistic transaction confirmation)

  **Test Infrastructure:**
  - Added `ELECTRIC_TEST_HOOKS` symbol for test control (hidden from public API)
  - Added `progressiveTestControl.releaseInitialSync()` to E2E test config for explicit transition control
  - Created comprehensive progressive mode E2E test suite (8 tests):
    - Explicit snapshot phase and atomic swap validation
    - Txid tracking behavior (Electric-only)
    - Multiple concurrent snapshots with deduplication
    - Incremental updates after swap
    - Predicate handling and resilience tests

  **Bug Fixes:**
  - Fixed type errors in test files
  - All 166 unit tests + 95 E2E tests passing

- Updated dependencies [[`f66f2cf`](https://github.com/TanStack/db/commit/f66f2cf944bbcc1a34ad7e340de2e78f5e27e666), [`e657a7d`](https://github.com/TanStack/db/commit/e657a7dad71dff6fb3dd24c2824f5b86d9f92cd5), [`f15b2a7`](https://github.com/TanStack/db/commit/f15b2a7081a2a21bd23ba3657fac44fc9c2f39a8), [`acb3e4f`](https://github.com/TanStack/db/commit/acb3e4f1441e6872ca577e74d92ae2d77deb5938), [`464805d`](https://github.com/TanStack/db/commit/464805d96bad6d0fd741e48fbfc98e90dc58bebe), [`2c2e4db`](https://github.com/TanStack/db/commit/2c2e4dbd781d278347d73373f66d3c51c6388116), [`15c772f`](https://github.com/TanStack/db/commit/15c772f5e42e49000a2d775fd8e4cfda3418243f)]:
  - @tanstack/query-db-collection@1.0.3
  - @tanstack/electric-db-collection@0.2.4
  - @tanstack/db@0.5.4

## 0.0.5

### Patch Changes

- Updated dependencies [[`a90f95e`](https://github.com/TanStack/db/commit/a90f95eaeb7cc334955ae5e8ffb98940fce1ecf1), [`846a830`](https://github.com/TanStack/db/commit/846a8309a243197245f4400a5d53cef5cec6d5d9), [`8e26dcf`](https://github.com/TanStack/db/commit/8e26dcfde600e4a18cd51fbe524560d60ab98d70)]:
  - @tanstack/query-db-collection@1.0.2
  - @tanstack/db@0.5.3
  - @tanstack/electric-db-collection@0.2.3

## 0.0.4

### Patch Changes

- Updated dependencies [[`99a3716`](https://github.com/TanStack/db/commit/99a371630b9f4632db86c43357c64701ecb53b0e)]:
  - @tanstack/db@0.5.2
  - @tanstack/electric-db-collection@0.2.2
  - @tanstack/query-db-collection@1.0.1

## 0.0.3

### Patch Changes

- Updated dependencies [[`a83a818`](https://github.com/TanStack/db/commit/a83a8189514d22ca2fcdf34b9cb97206d3c03c38), [`a83a818`](https://github.com/TanStack/db/commit/a83a8189514d22ca2fcdf34b9cb97206d3c03c38)]:
  - @tanstack/query-db-collection@1.0.1
  - @tanstack/db@0.5.1
  - @tanstack/electric-db-collection@0.2.1

## 0.0.2

### Patch Changes

- Updated dependencies [[`1afb027`](https://github.com/TanStack/db/commit/1afb027dbf3e34292a418fc549f799c4e0ce8922), [`243a35a`](https://github.com/TanStack/db/commit/243a35a632ee0aca20c3ee12ee2ac2929d8be11d), [`f9d11fc`](https://github.com/TanStack/db/commit/f9d11fc3d7297c61feb3c6876cb2f436edbb5b34), [`58f119a`](https://github.com/TanStack/db/commit/58f119ac4f1b05dbfff8617f59f53973abdb1920), [`7aedf12`](https://github.com/TanStack/db/commit/7aedf12996a67ef64010bca0d78d51c919dd384f), [`28f81b5`](https://github.com/TanStack/db/commit/28f81b5165d0a9566f99c2b6cf0ad09533e1a2cb), [`28f81b5`](https://github.com/TanStack/db/commit/28f81b5165d0a9566f99c2b6cf0ad09533e1a2cb), [`8f746db`](https://github.com/TanStack/db/commit/8f746db61ff160eae9834e0b9d83c40ef315ae12), [`7aceffa`](https://github.com/TanStack/db/commit/7aceffa46e746cff3dee51230dd2f9e09cb24137), [`f6ac7ea`](https://github.com/TanStack/db/commit/f6ac7eac50ae1334ddb173786a68c9fc732848f9), [`01093a7`](https://github.com/TanStack/db/commit/01093a762cf2f5f308edec7f466d1c3dabb5ea9f)]:
  - @tanstack/electric-db-collection@0.2.0
  - @tanstack/db@0.5.0
  - @tanstack/query-db-collection@1.0.0
