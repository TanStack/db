# @tanstack/db-react-native-sqlite-persisted-collection

React Native and Expo SQLite persistence wrappers for TanStack DB, built on the shared
`@tanstack/db-sqlite-persisted-collection-core` adapter.

## Entrypoints

- `@tanstack/db-react-native-sqlite-persisted-collection` (shared APIs)
- `@tanstack/db-react-native-sqlite-persisted-collection/react-native`
- `@tanstack/db-react-native-sqlite-persisted-collection/expo`

## Core APIs

- `createOpSQLiteDriver`
- `createMobileSQLitePersistenceAdapter`
- `createMobileSQLitePersistence`
- `createReactNativeSQLitePersistenceAdapter`
- `createReactNativeSQLitePersistence`
- `createExpoSQLitePersistenceAdapter`
- `createExpoSQLitePersistence`

## Notes

- Provide either an existing `op-sqlite` database object or an `openDatabase` factory.
- The package defaults to `SingleProcessCoordinator`, matching typical RN/Expo runtime semantics.
- Shared contract and conformance suites are wired in this package to validate behavior parity with node/electron wrappers.
