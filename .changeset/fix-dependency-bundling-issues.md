---
"@tanstack/offline-transactions": patch
"@tanstack/query-db-collection": patch
---

Fix dependency bundling issues by moving @tanstack/db to peerDependencies

**What Changed:**

Moved `@tanstack/db` from regular dependencies to peerDependencies in:

- `@tanstack/offline-transactions`
- `@tanstack/query-db-collection`

Removed `@opentelemetry/api` dependency from `@tanstack/offline-transactions`.

**Why:**

These extension packages incorrectly declared `@tanstack/db` as both a regular dependency AND a peerDependency simultaneously. This caused lock files to develop conflicting versions, resulting in multiple instances of `@tanstack/db` being installed in consuming applications.

The fix removes `@tanstack/db` from regular dependencies and keeps it only as a peerDependency. This ensures only one version of `@tanstack/db` is installed in the dependency tree, preventing version conflicts.

For local development, `@tanstack/db` remains in devDependencies so the packages can be built and tested independently.
